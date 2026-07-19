import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ClaudeHookItem {
  id: string
  label: string
  description: string
  enabled: true
  mutable: false
  source: string
  scope: 'global' | 'project'
  event: string
  matcher?: string
}

function redact(command: string): string {
  return command
    .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .slice(0, 2_000)
}

function parseFile(path: string, scope: 'global' | 'project'): ClaudeHookItem[] {
  if (!existsSync(path)) return []
  try {
    const source = realpathSync(path)
    const parsed = JSON.parse(readFileSync(source, 'utf8')) as { hooks?: Record<string, unknown> }
    if (!parsed.hooks || typeof parsed.hooks !== 'object') return []
    const items: ClaudeHookItem[] = []
    for (const [event, rawGroups] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(rawGroups)) continue
      rawGroups.forEach((rawGroup, groupIndex) => {
        if (!rawGroup || typeof rawGroup !== 'object') return
        const group = rawGroup as { matcher?: unknown; hooks?: unknown }
        if (!Array.isArray(group.hooks)) return
        group.hooks.forEach((rawHook, hookIndex) => {
          if (!rawHook || typeof rawHook !== 'object') return
          const hook = rawHook as { type?: unknown; command?: unknown; timeout?: unknown }
          const command = typeof hook.command === 'string' ? redact(hook.command) : ''
          const type = typeof hook.type === 'string' ? hook.type : 'command'
          const matcher = typeof group.matcher === 'string' ? group.matcher : undefined
          items.push({
            id: `claude-${scope}-${event}-${groupIndex}-${hookIndex}`,
            label: event,
            description: command || `${type} hook`,
            enabled: true,
            mutable: false,
            source,
            scope,
            event,
            matcher
          })
        })
      })
    }
    return items
  } catch {
    return []
  }
}

export function listClaudeHooks(projectRoot = process.cwd()): ClaudeHookItem[] {
  const candidates: Array<[string, 'global' | 'project']> = [
    [join(homedir(), '.claude', 'settings.json'), 'global'],
    [join(homedir(), '.claude', 'settings.local.json'), 'global'],
    [join(projectRoot, '.claude', 'settings.json'), 'project'],
    [join(projectRoot, '.claude', 'settings.local.json'), 'project']
  ]
  return candidates.flatMap(([path, scope]) => parseFile(path, scope))
}

export function listCodexHooks(): ClaudeHookItem[] {
  return parseFile(join(homedir(), '.codex', 'hooks.json'), 'global').map((item) => ({
    ...item,
    id: item.id.replace(/^claude-/, 'codex-')
  }))
}
