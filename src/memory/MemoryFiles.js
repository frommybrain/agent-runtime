import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { bannedIn, bannedWords, filterRecord, isMessageFrame } from '../util/record.js'

// memory.md, skills.md, tools.md.
// consolidation writes go through backup + restore (v0.3.1), LLMs are liars

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
    'at', 'by', 'from', 'it', 'its', 'this', 'that', 'and', 'or', 'but',
    'not', 'no', 'i', 'my', 'me', 'we', 'our', 'you', 'your', 'they',
    'them', 'their', 'he', 'she', 'his', 'her', 'so', 'if', 'then',
    'than', 'too', 'very', 'just', 'about', 'up', 'out', 'some', 'also',
])

export class MemoryFiles {
    constructor(config, logger) {
        this.dataDir = config.dataDir
        this.agentId = config.agentId
        this.logger = logger
        this._lastToolsHash = null  // skip redundant tools.md writes
        // read cache. avoids re-reading static files every tick
        this._cache = { memory: null, skills: null, tools: null }
        // fixation guard (see filterRecord): max bullets one content word can
        // own. doesn't need to know what the fixation is about
        this._subjectCeiling = config.memorySubjectCeiling ?? 4
        // max bullets sharing a PAIR of content words. the word cap alone let
        // one fixation sit right at the cap under four nouns (glint, spark,
        // glow, firefly)
        this._ideaCeiling = config.memoryIdeaCeiling ?? 2
        // max bullets casting an object as a message from elsewhere. its been
        // through four hosts (shrine token, glow, green stone, payphone), fresh
        // stems every time, but the frame never changes
        this._frameCeiling = config.memoryFrameCeiling ?? 2
        this._banned = []
    }

    // ban list comes from the persona so the runtime stays generic.
    // called at startup and on persona hot-swap
    setPersona(persona) {
        this._banned = bannedWords(persona)
    }

    async init() {
        await mkdir(this.dataDir, { recursive: true })

        await this._ensureFile('memory.md', `# ${this.agentId}'s Memory\n\n## Relationships\n\n## Learned Facts\n\n## Important Memories\n`)
        await this._ensureFile('skills.md', `# ${this.agentId}'s Skills\n`)
        await this._ensureFile('tools.md', `# Available Actions\n\n# Discovered Objects\n`)

        // header goes stale if the agent id changes (pip -> victor)
        await this._fixHeader('memory.md', `# ${this.agentId}'s Memory`)
        await this._fixHeader('skills.md', `# ${this.agentId}'s Skills`)
    }

    async readMemory() {
        if (this._cache.memory !== null) return this._cache.memory
        const content = await this._read('memory.md')
        this._cache.memory = content
        return content
    }

    async readSkills() {
        if (this._cache.skills !== null) return this._cache.skills
        const content = await this._read('skills.md')
        this._cache.skills = content
        return content
    }

    async readTools() {
        if (this._cache.tools !== null) return this._cache.tools
        const content = await this._read('tools.md')
        this._cache.tools = content
        return content
    }

    // the gate is here, not in the callers. memory.md gets the full rewrite at
    // sleep and single bullets from "remember" all day, both land here.
    // only bullets are filtered so the headers survive and it still validates
    async writeMemory(content) {
        const { text, banned, crowded } = filterRecord(content, {
            banned: this._banned,
            subjectCeiling: this._subjectCeiling,
            ideaCeiling: this._ideaCeiling,
            frameCeiling: this._frameCeiling,
            logger: this.logger,
            what: 'Memory guard',
        })
        if (banned || crowded) {
            this.logger.info(`Memory guard: dropped ${banned} banned, ${crowded} over the subject cap`)
        }
        await this._write('memory.md', text)
        this._cache.memory = text
    }

    async writeSkills(content) {
        const { text, banned, crowded } = filterRecord(content, {
            banned: this._banned,
            subjectCeiling: this._subjectCeiling,
            ideaCeiling: this._ideaCeiling,
            logger: this.logger,
            what: 'Skills guard',
        })
        if (banned || crowded) {
            this.logger.info(`Skills guard: dropped ${banned} banned, ${crowded} over the subject cap`)
        }
        await this._write('skills.md', text)
        this._cache.skills = text
    }

    async writeTools(content) {
        await this._write('tools.md', content)
        this._cache.tools = content
    }

    // waking-hours path, one bullet at a time
    async appendToMemory(section, content) {
        // hard cap or the LLM writes essays in here
        if (content.length > 150) {
            content = content.slice(0, 150)
            this.logger.debug(`Memory entry truncated to 150 chars`)
        }

        // writeMemory would drop it anyway, this just saves the read-modify-write
        // and stops the debug line below claiming an append that never landed
        const hits = bannedIn(content, this._banned)
        if (hits.length > 0) {
            this.logger.debug(`Memory guard: refused "${hits[0]}" in "${content.slice(0, 60)}"`)
            return
        }

        const current = await this.readMemory()

        // exact substring, ignoring the [salient] tag
        const bare = content.replace(/\s*\[salient\]\s*$/, '').trim().toLowerCase()
        if (current.toLowerCase().includes(bare)) {
            this.logger.debug(`Memory dedup - skipping "${content}" (exact match)`)
            return
        }

        // fuzzy, on keywords
        const keywords = this._extractKeywords(bare)
        if (keywords.length >= 2) {
            const existingLines = current.split('\n').filter(l => l.startsWith('- '))
            for (const line of existingLines) {
                const lineKeywords = this._extractKeywords(line.slice(2).toLowerCase())
                if (this._keywordsSimilar(keywords, lineKeywords)) {
                    this.logger.debug(`Memory dedup - skipping "${content}" (similar to "${line.slice(2).trim()}")`)
                    return
                }
            }
        }

        // frame cap has to be checked before insert. appends go at the top of
        // the section, so writeMemory would keep the new one and rotate an old
        // one out and the fixation holds both slots forever with new wording.
        // refused here, the slots fill once and the rest bounce
        if (this._frameCeiling > 0 && isMessageFrame(content)) {
            const held = current.split('\n').filter(l => /^\s*[-*] /.test(l) && isMessageFrame(l)).length
            if (held >= this._frameCeiling) {
                this.logger.info(`Memory guard: refused a message-frame line, ${held} already held ("${content.slice(0, 60)}")`)
                return
            }
        }

        const marker = `## ${section}`
        const idx = current.indexOf(marker)
        if (idx === -1) {
            // no such section yet, add it at the end
            const updated = current.trimEnd() + `\n\n## ${section}\n- ${content}\n`
            await this.writeMemory(updated)
        } else {
            const afterMarker = idx + marker.length
            const updated = current.slice(0, afterMarker) + `\n- ${content}` + current.slice(afterMarker)
            await this.writeMemory(updated)
        }
        this.logger.debug(`Memory appended to [${section}]: ${content}`)
    }

    // content words for the fuzzy dedup
    _extractKeywords(text) {
        return text
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    }

    // is `a` redundant next to `b` (the one that stays)? either heavy overlap,
    // or `a` is the shorter one and nearly all inside `b`, like "the cold
    // shrine" vs "the cold shrine pulses at dusk and I wait". containment is
    // one way on purpose, it only ever drops the vaguer entry.
    // both need 2+ shared words so tiny entries don't match by accident.
    // no topic lists in here, other agents use this too
    _keywordsSimilar(a, b) {
        if (a.length < 2 || b.length < 2) return false
        const overlap = a.filter(k => b.includes(k)).length
        if (overlap < 2) return false
        const simMax = overlap / Math.max(a.length, b.length)
        if (simMax >= 0.7) return true
        // containment, only when a is the shorter (or equal)
        const simMin = overlap / Math.min(a.length, b.length)
        return simMin >= 0.8 && a.length <= b.length
    }

    // runs before consolidation. the LLM cant be trusted to merge dupes,
    // it just keeps everything
    async deduplicateMemory() {
        const content = await this.readMemory()
        const lines = content.split('\n')
        const seen = []  // { keywords, line }
        const output = []
        let removed = 0

        for (const line of lines) {
            if (!line.startsWith('- ')) {
                output.push(line)
                continue
            }

            const text = line.slice(2).replace(/\s*\[salient\]\s*$/, '').trim().toLowerCase()
            const keywords = this._extractKeywords(text)

            let isDuplicate = false
            if (keywords.length >= 2) {
                for (const existing of seen) {
                    if (this._keywordsSimilar(keywords, existing.keywords)) {
                        isDuplicate = true
                        removed++
                        break
                    }
                }
            }

            if (!isDuplicate) {
                seen.push({ keywords, line })
                output.push(line)
            }
        }

        if (removed > 0) {
            await this.writeMemory(output.join('\n'))
            this.logger.info(`Memory dedup: removed ${removed} near-duplicate entries`)
        }
        return removed
    }

    // tools.md is rebuilt from each observation
    async updateToolsFromObservation(observation) {
        const tools = await this.readTools()
        let changed = false
        let updated = tools

        if (observation.available_actions) {
            const actionsSection = this._buildActionsSection(observation.available_actions)
            if (updated.includes('# Available Actions')) {
                const start = updated.indexOf('# Available Actions')
                const nextSection = updated.indexOf('\n# ', start + 1)
                const end = nextSection === -1 ? undefined : nextSection
                updated = updated.slice(0, start) + actionsSection + (end ? updated.slice(end) : '')
            } else {
                updated = actionsSection + '\n' + updated
            }
            changed = true
        }

        // only whats nearby RIGHT NOW. stale objects = hallucination
        const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
        // name first, id as a handle. this used to print the id and type only,
        // so the only word he had for the rock by the pond was
        // artifact_greenstone and he said it out loud ("Greenstone glints...").
        // no coords either, the bridge only sends distance, never pos
        const objectsSection = '# Nearby Objects (GROUND TRUTH, if something is not listed here, it is not present)\n' + (
            nearbyObjects.length > 0
                ? nearbyObjects.map(obj => {
                    const where = obj.away || (Number.isFinite(obj.distance) ? `${Math.round(obj.distance)}m away` : '')
                    const what = obj.name || obj.id
                    return `- ${what}${where ? `, ${where}` : ''}${obj.interactive ? ', interactive' : ''} [id ${obj.id}]`
                }).join('\n') + '\n'
                : '(nothing nearby, the area is empty)\n'
        )
        const objMarker = updated.match(/# (?:Discovered|Nearby) Objects[^\n]*/)
        if (objMarker) {
            const start = updated.indexOf(objMarker[0])
            updated = updated.slice(0, start) + objectsSection
        } else {
            updated += '\n' + objectsSection
        }
        changed = true

        // skip the write if nothing changed, saves ~10,800 writes a day
        const hash = this._quickHash(updated)
        if (hash !== this._lastToolsHash) {
            this._lastToolsHash = hash
            await this.writeTools(updated)
        }
    }

    // djb2, only for change detection
    _quickHash(str) {
        let hash = 5381
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i)
            hash = hash & hash  // 32bit integer
        }
        return hash
    }

    _buildActionsSection(actions) {
        const lines = actions.map(a => {
            if (typeof a === 'string') return `- ${a}`
            return `- ${a.name}: ${a.description || ''}`
        })
        return `# Available Actions\n${lines.join('\n')}\n`
    }

    // backup / restore around LLM rewrites

    async backup(filename) {
        const src = join(this.dataDir, filename)
        const dst = join(this.dataDir, `${filename}.bak`)
        try {
            await copyFile(src, dst)
        } catch {
            // nothing to back up yet
        }
    }

    async restore(filename) {
        const bak = join(this.dataDir, `${filename}.bak`)
        const dst = join(this.dataDir, filename)
        try {
            await copyFile(bak, dst)
            // cache is stale now
            const key = filename.replace('.md', '')
            if (this._cache[key] !== undefined) this._cache[key] = null
            this.logger.warn(`Restored ${filename} from backup`)
            return true
        } catch {
            this.logger.error(`No backup available for ${filename}`)
            return false
        }
    }

    // does the LLM output look like a memory.md at all
    validateMemoryContent(content) {
        if (!content || content.trim().length < 20) return false
        if (!content.includes('# ')) return false
        // bullets, or at least the empty sections
        const hasEntries = content.includes('- ')
        const hasExpectedSections = content.includes('## ')
        return hasEntries || hasExpectedSections
    }

    validateSkillsContent(content) {
        if (!content || content.trim().length < 10) return false
        if (!content.includes('# ')) return false
        return true
    }

    // put the header back instead of binning the extraction. the prompt asked
    // for a plain bullet list and the validator wanted a "# " header, so the
    // model did as told and failed every time (12 of 12 on 11 Aug). memory
    // never hit it becuase "## Relationships" contains "# ".
    // the prompt asks for the header now too, but that can regress the next
    // time someone tunes the wording. this cant
    normaliseSkills(content) {
        const text = String(content ?? '').trim()
        if (!text) return text
        if (/^#\s/m.test(text)) return text
        if (!/^\s*-\s+/m.test(text)) return text  // not a bullet list, leave it to fail
        this.logger.info('Skills extraction had no header, restoring it')
        return `# ${this.agentId}'s Skills\n\n${text}`
    }

    // backup, validate, write. restore if it doesn't validate
    async safeWriteMemory(content) {
        await this.backup('memory.md')
        if (this.validateMemoryContent(content)) {
            await this.writeMemory(content)
            return true
        }
        this.logger.warn('Memory consolidation output failed validation, restoring backup')
        await this.restore('memory.md')
        return false
    }

    async safeWriteSkills(content) {
        await this.backup('skills.md')
        const repaired = this.normaliseSkills(content)
        if (this.validateSkillsContent(repaired)) {
            await this.writeSkills(repaired)
            return true
        }
        this.logger.warn('Skills extraction output failed validation, restoring backup')
        await this.restore('skills.md')
        return false
    }

    // current thread, the desire layer. the ONE thing he's chasing across
    // days, set at sleep and put in every decision prompt.
    // { text, formedAt, updatedAt } or null when nothing pulls

    async readCurrentThread() {
        const raw = await this._read('current-thread.json')
        if (!raw) return null
        try {
            const t = JSON.parse(raw)
            return t && typeof t.text === 'string' && t.text.trim() ? t : null
        } catch {
            return null
        }
    }

    async writeCurrentThread(thread) {
        if (!thread || !thread.text) {
            await this._write('current-thread.json', 'null')
            return
        }
        // the frame doesn't get to be the thread. "I want to see if the lake's
        // glow reveals something new" got renewed six times on 21 Aug while
        // every guard watched other doors. same detector as the memory gate so
        // the two cant disagree
        if (isMessageFrame(thread.text)) {
            this.logger?.info?.(`Thread refused (message-frame shaped): "${String(thread.text).slice(0, 70)}"`)
            await this._write('current-thread.json', 'null')
            return
        }
        await this._write('current-thread.json', JSON.stringify(thread, null, 2))
    }

    // threads that were forced out (spent or a rut), last few only. the next
    // one gets told "not that", otherwise the replacement is picked from the
    // memory the old thread wrote and it comes straight back reworded
    async readRetiredThreads() {
        const raw = await this._read('retired-threads.json')
        if (!raw) return []
        try {
            const arr = JSON.parse(raw)
            return Array.isArray(arr) ? arr.filter((r) => r && typeof r.text === 'string') : []
        } catch {
            return []
        }
    }

    async recordRetiredThread(text) {
        if (!text || !String(text).trim()) return
        const prior = await this.readRetiredThreads()
        prior.push({ text: String(text).trim().slice(0, 160), at: new Date().toISOString() })
        await this._write('retired-threads.json', JSON.stringify(prior.slice(-4), null, 2))
    }

    // helpers

    async _read(filename) {
        try {
            return await readFile(join(this.dataDir, filename), 'utf-8')
        } catch {
            return ''
        }
    }

    async _write(filename, content) {
        await writeFile(join(this.dataDir, filename), content, 'utf-8')
    }

    async _ensureFile(filename, defaultContent) {
        const path = join(this.dataDir, filename)
        try {
            await readFile(path)
        } catch {
            await writeFile(path, defaultContent, 'utf-8')
            this.logger.info(`Created ${filename}`)
        }
    }

    async _fixHeader(filename, expectedHeader) {
        const content = await this._read(filename)
        if (!content) return
        const firstLine = content.split('\n')[0]
        if (firstLine.startsWith('# ') && firstLine !== expectedHeader) {
            const updated = expectedHeader + content.slice(firstLine.length)
            await this._write(filename, updated)
            this.logger.info(`Fixed header in ${filename}: "${firstLine}" -> "${expectedHeader}"`)
        }
    }
}
