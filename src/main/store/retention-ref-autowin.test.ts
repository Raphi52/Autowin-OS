import { describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * LA RETENTION DES REFS `refs/autowin/*` — decision seule, aucune suppression.
 *
 * Contexte mesure le 2026-09-08 : 207 refs invisibles de `git branch`, donc absentes des 89
 * branches recensees et de toute politique de retention. Elles ne sont PAS toutes du travail, et
 * c'est ce qui rend une purge uniforme dangereuse.
 *
 * Entrees qui feraient echouer ces tests si la regle etait fausse :
 *  - un marqueur `trie/` declare supprimable : on rejouerait un tri deja fait a la main, le travail
 *    annote ressortirait dans le bandeau ;
 *  - une sauvegarde `rescue/` gardee pour toujours : le stock ne se viderait jamais ;
 *  - une famille INCONNUE traitee comme une annotation jetable : un futur namespace serait purge
 *    par surprise.
 */
const JOUR = 24 * 60 * 60 * 1_000
const VIEUX = { apporteQuelqueChose: true, shaConsigne: true, ageMs: 90 * JOUR }

describe('familleDeRefAutowin', () => {
  it('lit la famille des trois namespaces reels du depot', () => {
    expect(WorktreeManager.familleDeRefAutowin('refs/autowin/trie/run-1')).toBe('trie')
    expect(WorktreeManager.familleDeRefAutowin('refs/autowin/rescue/run-1')).toBe('rescue')
    expect(WorktreeManager.familleDeRefAutowin('refs/autowin/integration/run-1')).toBe(
      'integration'
    )
  })

  it('rend undefined sur ce qui n’est pas une ref autowin — une branche n’est pas une ref', () => {
    expect(WorktreeManager.familleDeRefAutowin('refs/heads/autowin/recovery/run-1')).toBeUndefined()
    expect(WorktreeManager.familleDeRefAutowin('refs/autowin/trie')).toBeUndefined()
    expect(WorktreeManager.familleDeRefAutowin('')).toBeUndefined()
  })
})

describe('decisionRetentionRefAutowin', () => {
  it('un marqueur `trie` ne PERIME JAMAIS — il annote, il ne porte pas de travail', () => {
    expect(WorktreeManager.decisionRetentionRefAutowin({ famille: 'trie', ...VIEUX })).toBe('garder')
    // Meme sans apport : le supprimer ferait ressortir un travail deja trie a la main.
    expect(
      WorktreeManager.decisionRetentionRefAutowin({
        famille: 'trie',
        apporteQuelqueChose: false,
        shaConsigne: true,
        ageMs: 90 * JOUR
      })
    ).toBe('garder')
  })

  it('une sauvegarde `rescue` suit la meme regle qu’une branche de secours', () => {
    expect(WorktreeManager.decisionRetentionRefAutowin({ famille: 'rescue', ...VIEUX })).toBe(
      'supprimable-perime'
    )
    expect(
      WorktreeManager.decisionRetentionRefAutowin({
        famille: 'rescue',
        apporteQuelqueChose: true,
        shaConsigne: true,
        ageMs: 3 * JOUR
      })
    ).toBe('garder')
    // Le SHA non consigne l'emporte sur l'age, ici aussi.
    expect(
      WorktreeManager.decisionRetentionRefAutowin({
        famille: 'rescue',
        apporteQuelqueChose: true,
        shaConsigne: false,
        ageMs: 90 * JOUR
      })
    ).toBe('garder')
  })

  it('une adresse `integration` est du travail joignable, pas une annotation', () => {
    expect(WorktreeManager.decisionRetentionRefAutowin({ famille: 'integration', ...VIEUX })).toBe(
      'supprimable-perime'
    )
  })

  it('FAIL-CLOSED : une famille INCONNUE est traitee comme du travail, jamais comme un marqueur', () => {
    expect(WorktreeManager.decisionRetentionRefAutowin({ famille: 'namespace-futur', ...VIEUX })).toBe(
      'supprimable-perime'
    )
    expect(
      WorktreeManager.decisionRetentionRefAutowin({
        famille: 'namespace-futur',
        apporteQuelqueChose: true,
        shaConsigne: false,
        ageMs: 90 * JOUR
      })
    ).toBe('garder')
  })
})
