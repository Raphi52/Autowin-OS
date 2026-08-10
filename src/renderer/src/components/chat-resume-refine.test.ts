import { describe, expect, it } from 'vitest'
import { buildRefineDraft, failureMotif } from './chat-resume-refine'

describe('failureMotif', () => {
  it('nomme le motif propre à chaque statut terminal', () => {
    expect(failureMotif('cancelled')).toContain('annulé')
    expect(failureMotif('interrupted')).toContain('interrompu')
    expect(failureMotif('failed')).toContain('échoué')
  })
  it('annexe l’erreur remontée quand il y en a une', () => {
    expect(failureMotif('failed', '  quota  dépassé ')).toBe(
      'le tour précédent a échoué : quota dépassé'
    )
  })
})

describe('buildRefineDraft', () => {
  it('reprend le prompt d’origine ET le motif, en invitant à préciser', () => {
    const draft = buildRefineDraft('migre la base', 'interrupted')
    expect(draft.startsWith('migre la base')).toBe(true)
    expect(draft).toContain('[reprise] le tour précédent a été interrompu avant la fin')
    expect(draft).toContain('Précise ci-dessous')
  })
  it('est idempotent — recliquer n’empile pas deux blocs', () => {
    const once = buildRefineDraft('migre la base', 'failed')
    expect(buildRefineDraft(once, 'failed')).toBe(once.trim())
  })
})
