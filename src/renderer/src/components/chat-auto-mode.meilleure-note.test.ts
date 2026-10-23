import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

/**
 * LE MODE AUTO ENVOIE TOUTES LES SUITES AFFICHÉES (conv-1125, 2026-10-23 : « le mode auto doit
 * lancer toutes les suggestions de préprompt pas une seule »). Avant (conv-1005), seule la mieux
 * notée partait. Désormais toutes celles que le champ montre en boutons partent dans UN message,
 * la mieux notée en tête ; une suite sous le plancher d'affichage (60) n'est pas montrée, donc
 * pas envoyée non plus.
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

const envoye = (texte: string, demande = 'corrige le bouton Envoyer'): string => {
  const decision = deciderRelanceAuto({ ...base, fil: [humain(demande), agent(texte)] })
  expect(decision).toMatchObject({ action: 'envoyer' })
  return (decision as { texte: string }).texte
}

describe('mode auto — toutes les suites affichées partent', () => {
  it('envoie toutes les suites affichées, la mieux notée en tête', () => {
    const texte = envoye(
      [
        '👉 Recommandé — corriger le libellé',
        'AUTOWIN_PROMPT_V1: [40] Capture la vue chat.',
        'AUTOWIN_PROMPT_V1: [88] Corrige le libellé du bouton Envoyer.',
        'AUTOWIN_PROMPT_V1: [61] Relance les tests du composer.'
      ].join('\n')
    )
    expect(texte).toContain('Corrige le libellé du bouton Envoyer.')
    expect(texte).toContain('Relance les tests du composer.')
    // Sous 60, la suite n'est pas affichée : elle ne part pas non plus.
    expect(texte).not.toContain('Capture la vue chat.')
    expect(texte.indexOf('Corrige le libellé')).toBeLessThan(texte.indexOf('Relance les tests'))
  })

  it('une seule suite part telle quelle, sans liste', () => {
    const texte = envoye(
      [
        '👉 Recommandé — corriger',
        'AUTOWIN_PROMPT_V1: [88] Corrige le libellé du bouton Envoyer.'
      ].join('\n')
    )
    expect(texte.startsWith('Corrige le libellé du bouton Envoyer.')).toBe(true)
  })

  it("une suite secondaire qui attend une donnée de l'utilisateur ne part pas avec les autres", () => {
    const texte = envoye(
      [
        '👉 Recommandé — corriger',
        'AUTOWIN_PROMPT_V1: [88] Corrige le libellé du bouton Envoyer.',
        'AUTOWIN_PROMPT_V1: [70] Voici les identifiants du compte de test : reporte-les.',
        'AUTOWIN_PROMPT_V1: [65] Relance les tests du composer.'
      ].join('\n')
    )
    expect(texte).toContain('Corrige le libellé du bouton Envoyer.')
    expect(texte).toContain('Relance les tests du composer.')
    expect(texte).not.toContain('identifiants')
  })

  it('une suite secondaire différée ne part pas maintenant avec les autres', () => {
    const texte = envoye(
      [
        '👉 Recommandé — corriger',
        'AUTOWIN_PROMPT_V1: [88] Corrige le libellé du bouton Envoyer.',
        'AUTOWIN_PROMPT_V1: [70] Relance la mesure demain matin.'
      ].join('\n')
    )
    expect(texte).toContain('Corrige le libellé du bouton Envoyer.')
    expect(texte).not.toContain('demain')
  })
})
