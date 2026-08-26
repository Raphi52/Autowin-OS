import { describe, expect, it } from 'vitest'
import { classifierRefusDeReprise, type RefusDeReprise } from './resume-refusal'

/**
 * CE FICHIER A PERDU SES ASSERTIONS TEXTUELLES, ET C'EST LE POINT.
 *
 * Il decoupait le `catch` de reprise dans `src/main/index.ts` par `indexOf`, puis cherchait
 * `os.forgetResumableOrchestration(resumableRun.runId)` dans chaque branche. Son propre en-tete
 * declarait la limite — « il prouve le CABLAGE, pas l'execution » — et la justifiait ainsi :
 * « le `catch` vit au milieu de `src/main/index.ts` [...] qu'aucun test n'importe. Extraire le
 * handler serait un refactor hors perimetre. »
 *
 * Ce refactor a ete fait : la relance vit dans `relaunch-resumable-run.ts`, dependances injectees.
 * Chaque classe de refus y est donc REELLEMENT jouee — voir
 * `relaunch-resumable-run.test.ts` > « un refus definitif tarit le checkpoint au lieu de le
 * rejouer » : le checkpoint oublie, le tour conclu une seule fois, le statut diffuse, et le cas
 * temoin d'un echec NON classe qui, lui, garde le checkpoint.
 *
 * Reste ici ce qui n'a jamais eu besoin de lire du texte : ce que le classificateur PRODUIT.
 */
describe('classes de refus definitif produites par le classificateur', () => {
  it('les classes produites sont exactement celles que la relance sait tarir', () => {
    const produites = new Set(
      [
        'Reprise du worktree refusée pour run-x : publication complete déjà engagée.',
        'Reprise du worktree impossible pour run-x : copie durable absente ou incomplète.',
        'Reprise du worktree refusée : Le SHA de départ durable est invalide.'
      ].map((m) => classifierRefusDeReprise(m))
    )
    expect(produites).toEqual(
      new Set<RefusDeReprise>([
        'publication-acquise',
        'copie-durable-absente',
        'contexte-de-reprise-invalide'
      ])
    )
  })

  it('un echec ordinaire n est classe dans aucun refus definitif', () => {
    expect(classifierRefusDeReprise('provider injoignable, socket fermee')).toBeUndefined()
  })
})
