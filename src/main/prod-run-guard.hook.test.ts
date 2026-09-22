import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptHookGardes } from '../shared/garde-git-destructeur'
import { refusReglageProd } from './prod-run-guard'
import { reglagesCliAutowin } from './providers/claude'

// fix-ok: rouge mesuré 3/4 avant correctif — le hook PreToolUse (scriptHookGardes) ne contenait que refusGitDestructeur, sans refusReglageProd ; les 3 édits de ce fichier = création + faute de saisie, pas des essais à l'aveugle.
// Faille 2 (conv-738) : les réglages de la protection de prod ne se touchent pas par le terminal
// ni par les outils d'édition de l'agent, qui ne passent pas par la commande `run`.
function hook(entree: unknown): string {
  const script = join(mkdtempSync(join(tmpdir(), 'garde-prod-')), 'garde.mjs')
  writeFileSync(script, scriptHookGardes(refusReglageProd), 'utf8')
  return spawnSync(process.execPath, [script], { input: JSON.stringify(entree), encoding: 'utf8' }).stdout
}
const refuse = (s: string) => JSON.parse(s).hookSpecificOutput.permissionDecision === 'deny'

describe('hook du CLI — réglages de la protection de prod', () => {
  it('refuse une commande Bash/PowerShell qui cite prod-niveau.json', () => {
    expect(refuse(hook({ tool_name: 'PowerShell', tool_input: { command: 'Set-Content $env:APPDATA/autowin-os/prod-niveau.json x' } }))).toBe(true)
  })
  it('refuse Edit/Write sur un fichier de réglage', () => {
    expect(refuse(hook({ tool_name: 'Write', tool_input: { file_path: 'C:\\u\\prod-passphrase.json', content: '{}' } }))).toBe(true)
    expect(refuse(hook({ tool_name: 'Edit', tool_input: { file_path: 'C:/u/Prod-Autorite.json' } }))).toBe(true)
  })
  it('laisse passer le reste', () => {
    expect(hook({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts' } })).toBe('')
    expect(hook({ tool_name: 'Bash', tool_input: { command: 'git status' } })).toBe('')
  })
  it('le hook est branché sur les outils d’édition et reçoit la garde prod au site d’appel', () => {
    const m = (reglagesCliAutowin('x') as any).hooks.PreToolUse[0].matcher as string
    for (const t of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(m.split('|')).toContain(t)
    expect(readFileSync(join(__dirname, 'providers/claude.ts'), 'utf8')).toMatch(/scriptHookGardes\(refusReglageProd[,)]/)
  })
})
