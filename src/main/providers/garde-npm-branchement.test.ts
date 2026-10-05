import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gardeNpmDuDepot, reglagesCliAutowin } from './claude'

type Groupe = { matcher: string; hooks: { command: string }[] }
const groupes = (r: Record<string, unknown>): Groupe[] =>
  (r as { hooks: { PreToolUse: Groupe[] } }).hooks.PreToolUse

describe('garde npm des agents Autowin (2026-10-05)', () => {
  it('le script existe bien à côté du mod du dépôt', () => {
    const mod = resolve(__dirname, '..', '..', '..', 'mods', 'autowin')
    const script = gardeNpmDuDepot(mod)
    expect(script).toBeDefined()
    expect(existsSync(script!)).toBe(true)
    expect(script!.split('\\').join('/')).toMatch(/scripts\/garde-npm-modules\.mjs$/)
  })

  it('sans mod ni script : aucun garde inventé', () => {
    expect(gardeNpmDuDepot(undefined)).toBeUndefined()
    expect(gardeNpmDuDepot(join('X:', 'nulle-part', 'mods', 'autowin'), () => false)).toBeUndefined()
  })

  it('branché sur le groupe terminal, en plus du garde existant', () => {
    const shell = groupes(reglagesCliAutowin('G.mjs', 'D:\\depot\\scripts\\garde-npm-modules.mjs'))[0]
    expect(shell.matcher).toMatch(/Bash/)
    expect(shell.matcher).toMatch(/PowerShell/)
    expect(shell.hooks.map((h) => h.command)).toEqual([
      'node "G.mjs"',
      'node "D:/depot/scripts/garde-npm-modules.mjs"'
    ])
  })

  it('sans garde npm, les réglages restent ceux d’avant', () => {
    expect(groupes(reglagesCliAutowin('G.mjs'))[0].hooks).toHaveLength(1)
  })
})
