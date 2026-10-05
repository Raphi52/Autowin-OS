import { describe, expect, it } from 'vitest'
import {
  faitsDuRapport,
  formatOrchestrationOutcome,
  hasAuthoritativeDeliveredClosingBlock
} from './orchestration-outcome'

/**
 * DEFAUT RAPPORTE le 2026-10-05 : « dans Fait ca me met juste la demande a ete traitee — j'aimerais
 * une liste numerotee de ce qui a ete fait ». Le pied d'un travail livre etait UNE ligne generique,
 * alors que le rapport du worker listait deja les faits concrets.
 */
const livre = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'D:/Autowin/.autowin-data/runs/corriger-bouton/RUN.md',
  phaseOutputs: [{ phase: 'build', text: 'ok' }, { phase: 'clean', text: 'ok' }, { phase: 'judge', text: 'ok' }]
}
const rapport = [
  'Correction du bouton.',
  '',
  '✅ Fait',
  '- Bouton « Envoyer » recâblé dans `ChatView.tsx`',
  '- Test `ChatView.envoi.test.tsx` rouge puis vert',
  '📍 Maintenant : livré',
  '⏳ Reste à faire : rien',
  '👉 Recommandé : rien'
].join('\n')

describe('« ✅ Fait » d’un travail livré est une liste numérotée de ce qui a été fait', () => {
  it('reprend les faits concrets du rapport, numérotés, puis la validation en dernier', () => {
    const texte = formatOrchestrationOutcome(true, { ...livre, result: rapport })
    const bloc = texte.slice(texte.lastIndexOf('✅ Fait'))
    expect(bloc).toContain('1. Bouton « Envoyer » recâblé dans `ChatView.tsx`')
    expect(bloc).toContain('2. Test `ChatView.envoi.test.tsx` rouge puis vert')
    expect(bloc).toMatch(/3\. Le résultat demandé a été produit et validé — sujet : « corriger-bouton »\./u)
  })

  it('le bloc enrichi reste reconnu comme celui d’Autowin (sinon il disparaît au rechargement)', () => {
    const texte = formatOrchestrationOutcome(true, { ...livre, result: rapport })
    expect(hasAuthoritativeDeliveredClosingBlock(texte)).toBe(true)
  })

  it('sans bloc du worker, aucun fait n’est inventé', () => {
    expect(faitsDuRapport('Juste un texte libre.')).toEqual([])
  })
})
