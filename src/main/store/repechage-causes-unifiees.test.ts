import { describe, expect, it } from 'vitest'
import { CAUSES_REESSAYABLES, estRepechable } from './repechage-automatique'

/**
 * LE TROU ENTRE LE BOUTON ET LE BALAYAGE.
 *
 * Deux mécaniques republient un travail refusé, et elles avaient divergé :
 *
 *  - le BOUTON « Reprendre » accepte quatre causes — `merge-failed`, `ignored-deliverables`,
 *    `base-dirty`, `base-in-progress` ;
 *  - la boucle INTRA-SESSION (`scheduleRecoveryRetry`) ne réarme que `cleanup-pending` et
 *    `base-in-progress` ;
 *  - le BALAYAGE inter-session (`estRepechable`) ne connaissait que `merge-failed` et
 *    `ignored-deliverables`.
 *
 * Conséquence, lue dans le code et non supposée : **`base-dirty` n'était repris par AUCUNE des deux
 * boucles**. Il n'existait que derrière un clic. Or `delai-de-reprise.ts` chiffre sa fréquence —
 * « 216 refus base-in-progress contre 86 base-dirty, parce que l'utilisateur travaille en continu
 * dans la base ». Quatre-vingt-six travaux finis attendaient donc un geste humain que rien ne
 * réclamait.
 *
 * Le module `repechage-automatique.ts` avait pourtant écrit l'exigence noir sur blanc : « Toute
 * divergence entre le bouton et le balayage serait un piège : l'un repêcherait ce que l'autre
 * refuse. » Le prédicat était recopié à la main, donc il a dérivé. On le fait maintenant DÉCOULER
 * d'une définition unique, celle que le bouton lit aussi.
 *
 * Ce n'est PAS un réessai aveugle : contrairement à un fichier ignoré qui reste là quoi qu'on
 * fasse, une base sale ou occupée redevient propre d'elle-même dès que l'utilisateur committe ou
 * que son opération git se termine. Rejouer plus tard change donc réellement l'état qui bloque.
 */
describe('repêchage — une seule définition des causes réessayables', () => {
  const bloque = (attentionReason: string): { runId: string; publication: string; attentionReason: string } => ({
    runId: `run-${attentionReason}`,
    publication: 'blocked',
    attentionReason
  })

  it('reprend `base-dirty` — la cause qu’aucune boucle automatique ne couvrait', () => {
    expect(estRepechable(bloque('base-dirty'))).toBe(true)
  })

  it('reprend `base-in-progress` — le refus le plus fréquent (216 mesurés)', () => {
    expect(estRepechable(bloque('base-in-progress'))).toBe(true)
  })

  it('reprend toujours les deux causes historiques', () => {
    expect(estRepechable(bloque('merge-failed'))).toBe(true)
    expect(estRepechable(bloque('ignored-deliverables'))).toBe(true)
  })

  it('le balayage et le bouton lisent la MÊME liste — plus de recopie qui dérive', () => {
    for (const cause of CAUSES_REESSAYABLES) {
      expect(estRepechable(bloque(cause))).toBe(true)
    }
    expect([...CAUSES_REESSAYABLES].sort()).toEqual([
      'base-dirty',
      'base-in-progress',
      'ignored-deliverables',
      'merge-failed'
    ])
  })

  it('DISCRIMINANT — un conflit de contenu n’est JAMAIS repêché tout seul', () => {
    // Arbitrer un conflit, c'est décider à la place de l'utilisateur. La boucle ne franchit que des
    // portes réversibles ; celle-ci ne l'est pas.
    expect(estRepechable(bloque('conflict'))).toBe(false)
  })

  it('DISCRIMINANT — un travail jugé ROUGE reste refusé, quelle que soit la cause', () => {
    // La seule garde qui a toujours compté : `red` a été jugé, et négativement.
    for (const cause of CAUSES_REESSAYABLES) {
      expect(estRepechable({ ...bloque(cause), verdict: 'red' })).toBe(false)
    }
  })

  it('DISCRIMINANT — une cause inconnue n’ouvre pas la porte par défaut', () => {
    expect(estRepechable(bloque('cause-jamais-vue'))).toBe(false)
  })
})
