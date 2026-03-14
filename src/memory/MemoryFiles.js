import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Manages the three persistent knowledge files: memory.md, skills.md, tools.md

export class MemoryFiles {
    constructor(config, logger) {
        this.dataDir = config.dataDir
        this.agentId = config.agentId
        this.logger = logger
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
        return this._read('memory.md')
    }

    async readSkills() {
        return this._read('skills.md')
    }

    async readTools() {
        return this._read('tools.md')
    }

    // --- Write (full replace, used by sleep consolidation) ---

    async writeMemory(content) {
        await this._write('memory.md', content)
    }

    async writeSkills(content) {
        await this._write('skills.md', content)
    }

    async writeTools(content) {
        await this._write('tools.md', content)
    }

    // --- Append (used during waking hours for incremental updates) ---

    async appendToMemory(section, content) {
        const current = await this.readMemory()

        // Dedup: skip if this content (minus [salient] tag) already exists
        const bare = content.replace(/\s*\[salient\]\s*$/, '').trim().toLowerCase()
        if (current.toLowerCase().includes(bare)) {
            this.logger.debug(`Memory dedup — skipping "${content}" (already exists)`)
            return
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
        const objectsSection = '# Nearby Objects\n' + (
            nearbyObjects.length > 0
                ? nearbyObjects.map(obj =>
                    `- ${obj.id}: ${obj.type}${obj.interactive ? ', interactive' : ''}, at (${obj.pos?.x?.toFixed(0) ?? '?'}, ${obj.pos?.z?.toFixed(0) ?? '?'})`
                ).join('\n') + '\n'
                : '(nothing nearby)\n'
        )
        // Replace or append the objects section
        const objMarker = updated.match(/# (?:Discovered|Nearby) Objects/)
        if (objMarker) {
            const start = updated.indexOf(objMarker[0])
            updated = updated.slice(0, start) + objectsSection
        } else {
            updated += '\n' + objectsSection
        }
        changed = true

        if (changed) {
            await this.writeTools(updated)
        }
    }

    _buildActionsSection(actions) {
        const lines = actions.map(a => {
            if (typeof a === 'string') return `- ${a}`
            return `- ${a.name}: ${a.description || ''}`
        })
        return `# Available Actions\n${lines.join('\n')}\n`
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
