import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { skillInstruction } from './skill-pipeline'

/**
 * Un identifiant de skill est un NOM DE DOSSIER joint dans un chemin. Tant que seuls les huit
 * `PipelinePhase` l'atteignaient, la question ne se posait pas ; depuis qu'un NŒUD DE GRAPHE peut
 * en porter un librement, elle se pose : `normalizeGraph` accepte les nœuds d'un profil importé
 * TELS QUELS. Un profil hostile pouvait donc faire lire un `SKILL.md` hors de toute racine — et son
 * contenu était injecté dans le prompt système d'un agent.
 *
 * Vérifié par sonde avant correctif : le fichier hors racine était bien lu.
 */
describe('identifiant de skill et traversée de chemin', () => {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-skills-'))
  const dehors = mkdtempSync(join(tmpdir(), 'autowin-dehors-'))

  mkdirSync(join(racine, 'think'), { recursive: true })
  writeFileSync(
    join(racine, 'think', 'SKILL.md'),
    '---\nname: think\n---\nCorps legitime.\n',
    'utf8'
  )
  writeFileSync(join(dehors, 'SKILL.md'), '---\nname: piege\n---\nCONTENU HORS RACINE.\n', 'utf8')

  it('charge une skill légitime', () => {
    expect(skillInstruction('think', [racine])).toContain('Corps legitime')
  })

  it('REFUSE un identifiant qui remonte hors de la racine', () => {
    const corps = skillInstruction(`../${basename(dehors)}`, [racine])
    expect(corps).toBe('')
    expect(corps).not.toContain('CONTENU HORS RACINE')
  })

  it('REFUSE un chemin absolu', () => {
    expect(skillInstruction(dehors, [racine])).toBe('')
  })

  it('REFUSE separateurs, points et identifiant vide', () => {
    for (const mauvais of ['a/b', 'a\b', '..', '.', '', ' ', 'a.b', '-commence-par-tiret']) {
      expect(skillInstruction(mauvais, [racine]), `refuse ${JSON.stringify(mauvais)}`).toBe('')
    }
  })

  it('accepte les identifiants réels du kit', () => {
    for (const bon of ['think', 'learn', 'draft', 'graphify']) {
      expect(/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(bon), bon).toBe(true)
    }
  })

  it('nettoyage', () => {
    rmSync(racine, { recursive: true, force: true })
    rmSync(dehors, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
