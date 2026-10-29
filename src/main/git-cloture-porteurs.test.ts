import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Un tri qui fusionne et pousse le contenu, puis laisse toutes les branches porteuses en place,
 * n'a pas fini POUR L'UTILISATEUR : ce qu'il regarde, c'est le sélecteur de branches.
 * Mesuré le 2026-09-16 — conv-81, saisie `ts` 1789563993034, tour
 * c6746e12-5f10-4d65-99f4-9a18cd1b925f (« /salvage tout sur main ») : les 5 branches locales
 * étaient toutes contenues dans origin/main (par ancêtre ou par patch-id), le main local était
 * 191 commits en retard et HEAD restait sur feat/themes-selecteur-et-voiles.
 *
 * La skill `salvage` a été supprimée le 2026-10-29 (conv-1252) : `/git` porte ce tri et sa clôture.
 * Ce test est le cliquet : la clôture de `/git` DOIT continuer à retirer les porteurs vides, reçu
 * SHA à l'appui, et à revenir sur la branche d'intégration à jour.
 */
const SKILL = readFileSync(join(__dirname, '..', '..', 'skills', 'git', 'SKILL.md'), 'utf8')

const section = (debut: string, fin: string): string =>
  SKILL.slice(SKILL.indexOf(debut), SKILL.indexOf(fin))

describe('clôture de /git — les porteurs vides', () => {
  it('lit bien la skill git (sinon les assertions suivantes ne prouvent rien)', () => {
    expect(SKILL).toContain('### 5. RÉALIGNER')
    expect(SKILL).toContain('### 6. RANGER')
    expect(SKILL).toContain('### 8. PREUVE DE FIN')
  })

  it('mesure le contenu contre le distant, ancêtre ET patch-id', () => {
    const ranger = section('### 6. RANGER', '### 7.')
    expect(ranger).toMatch(/par ancêtre ou par `git cherry`/)
    expect(SKILL).toContain('git cherry <distant>/<branche> "$sha"')
  })

  it('revient sur la branche d’intégration, à jour', () => {
    expect(SKILL).toContain('git merge --ff-only <distant>/<branche>')
  })

  it('ne supprime qu’avec le SHA en reçu, et jamais un porteur unique ou INCONNU', () => {
    const ranger = section('### 6. RANGER', '### 7.')
    expect(ranger).toMatch(/reçu/)
    expect(ranger).toMatch(/SHA|<sha>/)
    expect(ranger).toMatch(/patch unique ou un verdict INCONNU/)
  })

  it('n’envoie plus vers la skill salvage supprimée', () => {
    expect(SKILL).not.toContain('skills/salvage/SKILL.md')
    expect(SKILL).not.toMatch(/(?<![\w/-])`salvage` §/)
  })
})
