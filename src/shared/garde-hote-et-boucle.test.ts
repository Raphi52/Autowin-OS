import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refusArretHote, refusBoucle } from './garde-hote-et-boucle'
import { scriptHookGardes } from './garde-git-destructeur'

describe('refusArretHote — ne tue pas l’app hôte', () => {
  it.each([
    'taskkill /IM electron.exe /F',
    'taskkill /F /IM node.exe',
    'taskkill /f /im "Autowin OS.exe"',
    'Stop-Process -Name electron -Force',
    'spps -n node',
    'Get-Process electron | Stop-Process',
    'gps node | kill',
    'pkill -f electron',
    'killall node',
    "wmic process where name='electron.exe' delete",
    'Start-Process powershell -ArgumentList "-c taskkill /IM electron.exe /F"'
  ])('refuse %s', (c) => expect(refusArretHote(c)).toMatch(/restart_app/))

  it.each([
    'git status',
    'Get-Process',
    'Get-Process electron',
    'taskkill /PID 4242 /F',
    'Stop-Process -Id 4242',
    'node scripts/ui-capture.mjs',
    'taskkill /IM notepad.exe',
    'npm test'
  ])('laisse passer %s', (c) => expect(refusArretHote(c)).toBeUndefined())
})

describe('refusBoucle — même appel 3 fois d’affilée', () => {
  it('laisse passer le 1er et le 2e, refuse le 3e', () => {
    expect(refusBoucle([], 'a')).toBeUndefined()
    expect(refusBoucle(['a'], 'a')).toBeUndefined()
    expect(refusBoucle(['a', 'a'], 'a')).toMatch(/3e fois/)
  })
  it('un appel différent intercalé casse la série', () => {
    expect(refusBoucle(['a', 'b', 'a'], 'a')).toBeUndefined()
    expect(refusBoucle(['a', 'a', 'b'], 'a')).toBeUndefined()
  })
})

describe('script de hook réel', () => {
  const script = join(mkdtempSync(join(tmpdir(), 'garde-boucle-')), 'garde.mjs')
  writeFileSync(script, scriptHookGardes(() => undefined), 'utf8')
  const hook = (e: unknown): string =>
    spawnSync(process.execPath, [script], { input: JSON.stringify(e), encoding: 'utf8' }).stdout
  const refuse = (s: string): boolean => s !== '' && JSON.parse(s).hookSpecificOutput.permissionDecision === 'deny'

  it('refuse un arrêt d’Electron par nom', () => {
    expect(refuse(hook({ tool_name: 'PowerShell', tool_input: { command: 'taskkill /IM electron.exe /F' } }))).toBe(true)
  })
  it('refuse le 3e Read identique d’affilée dans la même session, pas dans une autre', () => {
    const e = { session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } }
    expect(hook(e)).toBe('')
    expect(hook(e)).toBe('')
    expect(refuse(hook(e))).toBe(true)
    expect(hook({ ...e, session_id: 's2' })).toBe('')
  })
})
