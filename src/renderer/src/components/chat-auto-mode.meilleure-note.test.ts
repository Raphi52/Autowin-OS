import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

/**
 * LE MODE AUTO ENVOIE LA SUITE LA MIEUX NOTÉE (conv-1005, 2026-10-16) : quand le modèle propose
 * trois suites notées, c'est la meilleure note qui part — pas la dernière ligne écrite, comme le
 * voulait l'ancien format à une seule ligne.
 */
const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as unknown as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

describe('mode auto — trois suites notées', () => {
  it('envoie la mieux notée, même écrite au milieu', () => {
    const texte = [
      '👉 Recommandé — corriger le libellé',
      'AUTOWIN_PROMPT_V1: [40] Capture la vue chat.',
      'AUTOWIN_PROMPT_V1: [88] Corrige le libellé du bouton Envoyer.',
      'AUTOWIN_PROMPT_V1: [61] Relance les tests du composer.'
    ].join('\n')
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('corrige le bouton Envoyer'), agent(texte)]
    })
    expect(decision).toMatchObject({ action: 'envoyer' })
    const envoye = (decision as { texte: string }).texte
    expect(envoye).toContain('Corrige le libellé du bouton Envoyer.')
    expect(envoye).not.toContain('Capture la vue chat.')
    expect(envoye).not.toContain('Relance les tests du composer.')
  })
})
