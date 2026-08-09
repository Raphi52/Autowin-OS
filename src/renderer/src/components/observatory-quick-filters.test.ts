import { describe, expect, it } from 'vitest'
import { QUICK_FILTERS, matchesQuickFilter, type QuickFilter } from './observatory-quick-filters'
import type { HarnessTimelineEvent } from './harness-timeline-model'

/**
 * Extrait d'`ObservatoryView.tsx` le 2026-08-07. Deux motifs, pas un :
 *
 *  1. FONCTION PURE ENFERMEE — `matchesQuickFilter` et `QUICK_FILTERS` n'avaient aucune dependance a
 *     React et vivaient pourtant dans un composant de 1492 lignes, donc invérifiables autrement qu'en
 *     montant le DOM entier.
 *  2. DEUX MANQUES REELS que l'extraction rend visibles et testables :
 *     - aucun filtre rapide ne couvrait les CONTROLES (`gate`, `decision`) : un contrôle qualité
 *       n'était atteignable qu'via le sélecteur de type générique ;
 *     - le `return` final attrapait N'IMPORTE QUEL filtre inconnu dans la branche « sous-agents »,
 *       si bien qu'un filtre nouveau se comportait silencieusement comme un filtre existant au lieu
 *       de ne rien matcher — un faux résultat, pas une erreur visible.
 */

const ev = (kind: HarnessTimelineEvent['kind']): HarnessTimelineEvent =>
  ({ kind }) as HarnessTimelineEvent

describe('matchesQuickFilter — comportements deja acquis (non-regression)', () => {
  it('`all` laisse tout passer', () => {
    expect(matchesQuickFilter(ev('gate'), 'all')).toBe(true)
  })

  it('`errors` couvre erreur, réessai et annulation', () => {
    expect(matchesQuickFilter(ev('error'), 'errors')).toBe(true)
    expect(matchesQuickFilter(ev('retry'), 'errors')).toBe(true)
    expect(matchesQuickFilter(ev('cancellation'), 'errors')).toBe(true)
    expect(matchesQuickFilter(ev('message'), 'errors')).toBe(false)
  })

  it('`tools` couvre appel et résultat d’outil', () => {
    expect(matchesQuickFilter(ev('tool-call'), 'tools')).toBe(true)
    expect(matchesQuickFilter(ev('tool-result'), 'tools')).toBe(true)
  })

  it('`agents` couvre délégation et jugement', () => {
    expect(matchesQuickFilter(ev('handoff'), 'agents')).toBe(true)
    expect(matchesQuickFilter(ev('verdict'), 'agents')).toBe(true)
    expect(matchesQuickFilter(ev('gate'), 'agents')).toBe(false)
  })
})

describe('manques comblés', () => {
  it('un filtre CONTROLES existe et couvre gate + decision', () => {
    expect(matchesQuickFilter(ev('gate'), 'controls')).toBe(true)
    expect(matchesQuickFilter(ev('decision'), 'controls')).toBe(true)
    expect(matchesQuickFilter(ev('tool-call'), 'controls')).toBe(false)
  })

  it('un filtre ARTEFACTS existe — les livrables sont désormais tracés, donc filtrables', () => {
    expect(matchesQuickFilter(ev('artifact'), 'artifacts')).toBe(true)
    expect(matchesQuickFilter(ev('model-response'), 'artifacts')).toBe(false)
  })

  it('les deux nouveaux filtres sont OFFERTS dans la barre, pas seulement supportés', () => {
    // Un filtre implémenté mais absent de la barre serait inatteignable : exposé sans être intégré.
    const values = QUICK_FILTERS.map((filter) => filter.value)
    expect(values).toContain('controls')
    expect(values).toContain('artifacts')
  })

  it('chaque filtre offert porte un libellé non vide', () => {
    for (const filter of QUICK_FILTERS) expect(filter.label.trim().length).toBeGreaterThan(0)
  })

  it('un filtre INCONNU ne matche RIEN au lieu de se comporter comme « sous-agents »', () => {
    // C'était le défaut du `return` final : n'importe quelle valeur tombait dans la branche agents.
    expect(matchesQuickFilter(ev('handoff'), 'zzz-inexistant' as QuickFilter)).toBe(false)
  })
})
