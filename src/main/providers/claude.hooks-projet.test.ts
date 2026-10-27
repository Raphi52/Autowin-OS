import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avecHooksTourDuProjet, hooksTourDuProjet, reglagesCliAutowin } from './claude'

/**
 * Le CLI tourne avec `--setting-sources ""` : les hooks du `.claude/settings.json` du projet ne
 * jouaient jamais (RIG-V3 : temps Claude jamais compté sous Autowin). On reprend les SEULS hooks de
 * début et de fin de tour du projet ; tout le reste de ses réglages reste ignoré.
 */
function projet(reglages: unknown): string {
  const dossier = mkdtempSync(join(tmpdir(), 'hooks-projet-'))
  mkdirSync(join(dossier, '.claude'))
  writeFileSync(join(dossier, '.claude', 'settings.json'), JSON.stringify(reglages), 'utf8')
  return dossier
}

const debut = [{ matcher: '', hooks: [{ type: 'command', command: 'debut.ps1' }] }]
const fin = [{ matcher: '', hooks: [{ type: 'command', command: 'fin.ps1' }] }]

describe('hooks de tour du projet', () => {
  it('reprend UserPromptSubmit et Stop, et rien d’autre', () => {
    const dossier = projet({
      model: 'x',
      hooks: { SessionStart: debut, UserPromptSubmit: debut, Stop: fin, PreToolUse: fin }
    })
    expect(hooksTourDuProjet(dossier)).toEqual({ UserPromptSubmit: debut, Stop: fin })
  })

  it('rend un objet vide sans fichier, ou sur un fichier illisible', () => {
    expect(hooksTourDuProjet(mkdtempSync(join(tmpdir(), 'vide-')))).toEqual({})
    const casse = mkdtempSync(join(tmpdir(), 'casse-'))
    mkdirSync(join(casse, '.claude'))
    writeFileSync(join(casse, '.claude', 'settings.json'), '{ pas du json', 'utf8')
    expect(hooksTourDuProjet(casse)).toEqual({})
    expect(hooksTourDuProjet(undefined)).toEqual({})
  })

  it('les ajoute aux réglages d’Autowin sans toucher ses gardes', () => {
    const dossier = projet({ hooks: { UserPromptSubmit: debut, Stop: fin, PreToolUse: fin } })
    const reglages = avecHooksTourDuProjet(reglagesCliAutowin('garde.mjs'), dossier) as {
      hooks: Record<string, unknown[]>
    }
    expect(reglages.hooks.UserPromptSubmit).toEqual(debut)
    expect(reglages.hooks.Stop).toEqual(fin)
    expect(reglages.hooks.PreToolUse).toHaveLength(2)
  })
})
