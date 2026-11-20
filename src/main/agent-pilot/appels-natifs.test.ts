import { describe, expect, it, vi } from 'vitest'

vi.mock('../runs/murs-store', () => ({
  chargerMurs: vi.fn(() => []),
  enregistrerMur: vi.fn()
}))

import type { CommandResult } from '../commands/commands'
import { cleDeVideo } from '../media/videos-livrees'
import { appelsNatifsDuTour } from './appels-natifs'
import { etatInitialDuTour, type EtatDuTour } from './etat-du-tour'

/**
 * LES DEUX DRAPEAUX QU'AUCUN TEST NE TENAIT (lot 3).
 *
 * Le lot 3 a réinjecté cinq défauts dans `appels-natifs.ts` : trois étaient attrapés, deux non —
 * `anyActionExecuted` levé par un appel direct, et `anyActionFailed` dans la comptabilité. Les
 * tests existants lisent le TEXTE du pilote ; celui-ci exécute le module. Entrées qui le font
 * échouer : la ligne `etat.anyActionExecuted = true` retirée de `executerAppelNatif`, ou
 * `etat.anyActionFailed = true` retirée de `comptabiliserCommande`.
 */
const snapshot = { runs: [] } as unknown as Parameters<typeof etatInitialDuTour>[0]['snapshot']
const nouvelEtat = (): EtatDuTour =>
  etatInitialDuTour({
    resumeSessionId: undefined,
    compteAuDepart: undefined,
    blocsDuTour: [],
    maxIter: 5,
    conversationId: undefined,
    snapshot
  })

const outils = (etat: EtatDuTour, resultat: CommandResult) =>
  appelsNatifsDuTour({
    etat,
    conversationId: undefined,
    provider: 'claude',
    signal: undefined,
    emit: () => undefined,
    execCommandTolerante: async () => resultat
  })

describe('appels directs du modèle — drapeaux du tour (appels-natifs.ts)', () => {
  it.each([
    ['réussi', { ok: true, data: { contenu: 'x' } } as CommandResult],
    ['en échec', { ok: false, error: 'refusé' } as CommandResult]
  ])('un appel direct %s lève anyActionExecuted', async (_cas, resultat) => {
    const etat = nouvelEtat()
    expect(etat.anyActionExecuted).toBe(false)
    await outils(etat, resultat).executerAppelNatif('get_state', {})
    expect(etat.anyActionExecuted).toBe(true)
  })

  it('la comptabilité lève anyActionFailed sur un échec', () => {
    const etat = nouvelEtat()
    const compte = outils(etat, { ok: true }).comptabiliserCommande(
      'edit_file',
      { path: 'a.ts' },
      { ok: false, error: 'old_string introuvable' },
      'a-1'
    )
    expect(compte.reussie).toBe(false)
    expect(etat.anyActionFailed).toBe(true)
  })

  it('la comptabilité laisse anyActionFailed à faux sur une réussite', () => {
    const etat = nouvelEtat()
    const compte = outils(etat, { ok: true }).comptabiliserCommande(
      'edit_file',
      { path: 'a.ts' },
      { ok: true, data: { applied: true } },
      'a-1'
    )
    expect(compte.reussie).toBe(true)
    expect(etat.anyActionFailed).toBe(false)
  })

  it('un appel direct en échec passe par la même comptabilité', async () => {
    const etat = nouvelEtat()
    await outils(etat, { ok: false, error: 'refusé' }).executerAppelNatif('edit_file', {
      path: 'a.ts'
    })
    expect(etat.anyActionFailed).toBe(true)
  })
})

/**
 * LA VIDÉO D'UN `show_video` APPELÉ EN DIRECT ARRIVE DANS LE FIL.
 *
 * Constat du 2026-11-20 : l'outil répondait « montré », aucun lecteur n'apparaissait. La carte
 * part par `CommandResult.artifacts`, que seul le chemin `<cmd>` publiait. Entrée qui fait échouer
 * ce test : retirer de `executerAppelNatif` l'appel qui publie `r.artifacts`.
 */
describe('appels directs du modèle — cartes rendues par la commande (show_video)', () => {
  const chemin = 'D:\\Travail\\video-client\\demo.mp4'
  const carte = {
    id: 'video-demo-1',
    name: 'demo.mp4',
    mimeType: 'video/mp4',
    kind: 'video' as const,
    size: 30_000_000,
    createdAt: 1,
    path: chemin,
    fps: 30,
    source: { provider: 'autowin', tool: 'show_video', originalPath: chemin }
  }
  const executer = async (etat: EtatDuTour, fois = 1) => {
    const emis: Array<{ kind: string; artifact?: { id: string }; iteration?: number }> = []
    const appels = appelsNatifsDuTour({
      etat,
      conversationId: undefined,
      provider: 'claude',
      signal: undefined,
      emit: (e) => emis.push(e as never),
      execCommandTolerante: async () => ({
        ok: true,
        data: { montre: true, nom: 'demo.mp4' },
        artifacts: [carte]
      })
    })
    for (let n = 0; n < fois; n++) await appels.executerAppelNatif('show_video', { path: chemin })
    return emis.filter((e) => e.kind === 'artifact')
  }

  it('émet la carte vidéo dans le fil, à l’itération en cours', async () => {
    const etat = nouvelEtat()
    etat.iterationNatif = 2
    const cartes = await executer(etat)
    expect(cartes).toEqual([
      expect.objectContaining({ iteration: 2, artifact: expect.objectContaining({ id: carte.id }) })
    ])
  })

  it('la note comme déjà montrée : la fin du tour ne la redouble pas', async () => {
    const etat = nouvelEtat()
    await executer(etat)
    expect(etat.videosDejaMontrees.has(cleDeVideo(chemin))).toBe(true)
    expect(etat.artefactsDejaEmis.has(carte.id)).toBe(true)
  })

  it('une même carte rendue deux fois ne fait qu’un lecteur', async () => {
    expect(await executer(nouvelEtat(), 2)).toHaveLength(1)
  })
})
