import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Un salvage qui fusionne et pousse le contenu, puis laisse toutes les branches porteuses en
 * place, n'a pas fini POUR L'UTILISATEUR : ce qu'il regarde, c'est le sélecteur de branches.
 * Mesuré le 2026-09-16 — conv-81, saisie `ts` 1789563993034, tour
 * c6746e12-5f10-4d65-99f4-9a18cd1b925f (« /salvage tout sur main ») : les 5 branches locales
 * étaient toutes contenues dans origin/main (par ancêtre ou par patch-id), le main local était
 * 191 commits en retard et HEAD restait sur feat/themes-selecteur-et-voiles.
 * Ce test est le cliquet : la clôture de salvage DOIT continuer à exiger le retrait des porteurs
 * vides et le retour sur la branche d'intégration.
 */
const SKILL = readFileSync(join(__dirname, '..', '..', 'skills', 'salvage', 'SKILL.md'), 'utf8')

describe('clôture de salvage — les porteurs vides', () => {
  it('lit bien la skill salvage (sinon les assertions suivantes ne prouvent rien)', () => {
    expect(SKILL).toContain('### 7. PUBLIER')
    expect(SKILL).toContain('### 8. RAPPORTER')
  })

  it('exige de mesurer le contenu contre origin/main, ancêtre ET patch-id', () => {
    expect(SKILL).toContain('git merge-base --is-ancestor "$b" origin/main')
    expect(SKILL).toContain('git cherry origin/main "$b"')
  })

  it('exige de revenir sur la branche d’intégration, à jour', () => {
    expect(SKILL).toContain('git merge --ff-only origin/main')
  })

  it('garde la suppression sous accord humain, avec le SHA en reçu', () => {
    const bloc = SKILL.slice(SKILL.indexOf('porteurs devenus vides'), SKILL.indexOf('### 8.'))
    expect(bloc).toMatch(/geste destructeur/)
    expect(bloc).toMatch(/demande\s+un oui/)
    expect(bloc).toMatch(/SHA/)
  })
})
