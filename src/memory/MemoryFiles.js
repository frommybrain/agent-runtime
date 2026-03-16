import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Manages the three persistent knowledge files: memory.md, skills.md, tools.md
// v0.3.1: backup + restore for consolidation safety

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
        // Read cache — avoids re-reading static files every tick
        this._cache = { memory: null, skills: null, tools: null }
    }

    async init() {
        await mkdir(this.dataDir, { recursive: true })

        // Ensure all three files exist with defaults
        await this._ensureFile('memory.md', `# ${this.agentId}'s Memory\n\n## Relationships\n\n## Learned Facts\n\n## Important Memories\n`)
        await this._ensureFile('skills.md', `# ${this.agentId}'s Skills\n`)
        await this._ensureFile('tools.md', `# Available Actions\n\n# Discovered Objects\n`)

        // Fix header if agent identity changed (e.g. pip → victor)
        await this._fixHeader('memory.md', `# ${this.agentId}'s Memory`)
        await this._fixHeader('skills.md', `# ${this.agentId}'s Skills`)
    }

    // --- Read ---

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

    // --- Write (full replace, used by sleep consolidation) ---

    async writeMemory(content) {
        await this._write('memory.md', content)
        this._cache.memory = content
    }

    async writeSkills(content) {
        await this._write('skills.md', content)
        this._cache.skills = content
    }

    async writeTools(content) {
        await this._write('tools.md', content)
        this._cache.tools = content
    }

    // --- Append (used during waking hours for incremental updates) ---

    async appendToMemory(section, content) {
        // v0.3.1: Hard length cap — prevent LLM from writing essays into memory
        if (content.length > 150) {
            content = content.slice(0, 150)
            this.logger.debug(`Memory entry truncated to 150 chars`)
        }

        const current = await this.readMemory()

        // Dedup: exact substring match (minus [salient] tag)
        const bare = content.replace(/\s*\[salient\]\s*$/, '').trim().toLowerCase()
        if (current.toLowerCase().includes(bare)) {
            this.logger.debug(`Memory dedup — skipping "${content}" (exact match)`)
            return
        }

        // Fuzzy dedup: extract key words and check if a similar entry exists
        const keywords = this._extractKeywords(bare)
        if (keywords.length >= 2) {
            const existingLines = current.split('\n').filter(l => l.startsWith('- '))
            for (const line of existingLines) {
                const lineKeywords = this._extractKeywords(line.slice(2).toLowerCase())
                const overlap = keywords.filter(k => lineKeywords.includes(k)).length
                const similarity = overlap / Math.max(keywords.length, lineKeywords.length)
                if (similarity >= 0.7) {
                    this.logger.debug(`Memory dedup — skipping "${content}" (similar to "${line.slice(2).trim()}")`)
                    return
                }
            }
        }

        const marker = `## ${section}`
        const idx = current.indexOf(marker)
        if (idx === -1) {
            // Section doesn't exist, append at end
            const updated = current.trimEnd() + `\n\n## ${section}\n- ${content}\n`
            await this.writeMemory(updated)
        } else {
            // Insert after section heading
            const afterMarker = idx + marker.length
            const updated = current.slice(0, afterMarker) + `\n- ${content}` + current.slice(afterMarker)
            await this.writeMemory(updated)
        }
        this.logger.debug(`Memory appended to [${section}]: ${content}`)
    }

    // Extract meaningful keywords (strip stop words) for fuzzy dedup
    _extractKeywords(text) {
        return text
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    }

    // --- Pre-consolidation dedup ---
    // Strips near-duplicate entries from memory.md before the LLM sees it.
    // The LLM can't be trusted to merge duplicates — it keeps everything.

    async deduplicateMemory() {
        const content = await this.readMemory()
        const lines = content.split('\n')
        const seen = []  // { keywords: string[], line: string }
        const output = []
        let removed = 0

        for (const line of lines) {
            if (!line.startsWith('- ')) {
                output.push(line)
                continue
            }

            const text = line.slice(2).replace(/\s*\[salient\]\s*$/, '').trim().toLowerCase()
            const keywords = this._extractKeywords(text)

            // Check against already-seen entries
            let isDuplicate = false
            if (keywords.length >= 2) {
                for (const existing of seen) {
                    const overlap = keywords.filter(k => existing.keywords.includes(k)).length
                    const similarity = overlap / Math.max(keywords.length, existing.keywords.length)
                    if (similarity >= 0.7) {
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

    // --- Tools auto-update from observations ---

    async updateToolsFromObservation(observation) {
        const tools = await this.readTools()
        let changed = false
        let updated = tools

        // Update available actions
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

        // Rebuild discovered objects from current observation — only show what's
        // actually nearby RIGHT NOW. Stale objects cause hallucination.
        const nearbyObjects = observation.nearbyObjects || observation.nearby_objects || []
        const objectsSection = '# Nearby Objects (GROUND TRUTH — if something is not listed here, it is not present)\n' + (
            nearbyObjects.length > 0
                ? nearbyObjects.map(obj =>
                    `- ${obj.id}: ${obj.type}${obj.interactive ? ', interactive' : ''}, at (${obj.pos?.x?.toFixed(0) ?? '?'}, ${obj.pos?.z?.toFixed(0) ?? '?'})`
                ).join('\n') + '\n'
                : '(nothing nearby — the area is empty)\n'
        )
        // Replace or append the objects section
        const objMarker = updated.match(/# (?:Discovered|Nearby) Objects[^\n]*/)
        if (objMarker) {
            const start = updated.indexOf(objMarker[0])
            updated = updated.slice(0, start) + objectsSection
        } else {
            updated += '\n' + objectsSection
        }
        changed = true

        // Only write if content actually changed (saves ~10,800 disk writes/day)
        const hash = this._quickHash(updated)
        if (hash !== this._lastToolsHash) {
            this._lastToolsHash = hash
            await this.writeTools(updated)
        }
    }

    // Fast string hash for change detection (djb2)
    _quickHash(str) {
        let hash = 5381
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i)
            hash = hash & hash  // Convert to 32bit integer
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

    // --- Backup / Restore (for consolidation safety) ---

    // Create a .bak copy before destructive LLM overwrites
    async backup(filename) {
        const src = join(this.dataDir, filename)
        const dst = join(this.dataDir, `${filename}.bak`)
        try {
            await copyFile(src, dst)
        } catch {
            // Source doesn't exist yet — nothing to back up
        }
    }

    // Restore from backup if the current file is corrupted
    async restore(filename) {
        const bak = join(this.dataDir, `${filename}.bak`)
        const dst = join(this.dataDir, filename)
        try {
            await copyFile(bak, dst)
            // Invalidate cache for restored file
            const key = filename.replace('.md', '')
            if (this._cache[key] !== undefined) this._cache[key] = null
            this.logger.warn(`Restored ${filename} from backup`)
            return true
        } catch {
            this.logger.error(`No backup available for ${filename}`)
            return false
        }
    }

    // Validate that LLM output looks like valid memory.md
    validateMemoryContent(content) {
        if (!content || content.trim().length < 20) return false
        // Must have at least one markdown header
        if (!content.includes('# ')) return false
        // Must have at least one list entry (or be a valid empty structure)
        const hasEntries = content.includes('- ')
        const hasExpectedSections = content.includes('## ')
        return hasEntries || hasExpectedSections
    }

    // Validate that LLM output looks like valid skills.md
    validateSkillsContent(content) {
        if (!content || content.trim().length < 10) return false
        if (!content.includes('# ')) return false
        return true
    }

    // Safe write: backup → validate → write, or restore on failure
    async safeWriteMemory(content) {
        await this.backup('memory.md')
        if (this.validateMemoryContent(content)) {
            await this.writeMemory(content)
            return true
        }
        this.logger.warn('Memory consolidation output failed validation — restoring backup')
        await this.restore('memory.md')
        return false
    }

    async safeWriteSkills(content) {
        await this.backup('skills.md')
        if (this.validateSkillsContent(content)) {
            await this.writeSkills(content)
            return true
        }
        this.logger.warn('Skills extraction output failed validation — restoring backup')
        await this.restore('skills.md')
        return false
    }

    // --- Helpers ---

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
            this.logger.info(`Fixed header in ${filename}: "${firstLine}" → "${expectedHeader}"`)
        }
    }
}
