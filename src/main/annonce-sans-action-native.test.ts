import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusEstUneAction } from './chat-turn-messages'

/**
 * FAUSSE ALERTE « tu as ANNONCÉ ce que tu allais faire, sans rien faire ».
 *
 * Mesuré le 2026-09-22 (conv-782) : le tour avait créé `.arena/arenagame/lance-bras.sh` (Write),
 * modifié `skills/arenagame/SKILL.md` (Edit) et joué deux tests (Bash) — et le garde a répondu
 * « aucune commande n'a été exécutée ». Cause : `anyActionExecuted` n'est levé que par un `<cmd>`
 * Autowin ; les outils NATIFS du modèle passent par `chunk.status`, où seule la LECTURE était
 * reconnue (`statusEstUneLecture`). Le garde a donc exigé de refaire un travail déjà fait.
 */
describe('statusEstUneAction — un outil natif qui agit compte comme une action', () => {
  it('Write, Edit, MultiEdit et NotebookEdit sont des actions', () => {
    expect(statusEstUneAction('Write · D:/AutoWinOS/.arena/arenagame/lance-bras.sh')).toBe(true)
    expect(statusEstUneAction('Edit · skills/arenagame/SKILL.md')).toBe(true)
    expect(statusEstUneAction('MultiEdit · a.ts')).toBe(true)
    expect(statusEstUneAction('NotebookEdit · n.ipynb')).toBe(true)
  })

  it('un Bash qui n’est pas une simple lecture est une action', () => {
    expect(statusEstUneAction('Bash · npx vitest run src/main/x.test.ts')).toBe(true)
    expect(statusEstUneAction('Bash · tar -cf a.tar b && rm -rf b')).toBe(true)
  })

  it('CONTRE-EXEMPLE — une lecture n’est pas une action', () => {
    expect(statusEstUneAction('Read · src/main/agent-pilot.ts')).toBe(false)
    expect(statusEstUneAction('Grep · motif')).toBe(false)
    expect(statusEstUneAction('Bash · cat fichier.txt')).toBe(false)
    expect(statusEstUneAction('')).toBe(false)
    expect(statusEstUneAction(undefined)).toBe(false)
  })

  it('le garde « annonce sans action » voit les actions natives', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    expect(source).toMatch(/statusEstUneAction\(chunk\.status\)\)\s*actionNativeCeTour = true/)
    expect(source).toMatch(
      /exigeAgirPasAnnoncer\(\s*latestUserMessage,\s*visibleTextThisTurn,\s*anyActionExecuted \|\| actionNativeCeTour\s*\)/
    )
  })
})
