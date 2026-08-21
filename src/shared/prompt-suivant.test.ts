import { describe, expect, it } from 'vitest'
import { extrairePromptSuivant, retirerLignePromptSuivant } from './prompt-suivant'

const LIGNE = 'AUTOWIN_PROMPT_V1: Lance le terrain sur le build du pari.'

describe('extraction du prompt suivant', () => {
  it('lit le prompt émis en fin de tour', () => {
    expect(extrairePromptSuivant(`travail fait\n${LIGNE}`)).toBe(
      'Lance le terrain sur le build du pari.'
    )
  })

  it('rend null quand aucun prompt n’a été émis', () => {
    expect(extrairePromptSuivant('👉 **Recommandé** — passer en terrain')).toBeNull()
  })

  it('retient le DERNIER prompt si le modèle en émet deux', () => {
    expect(
      extrairePromptSuivant('AUTOWIN_PROMPT_V1: le premier\nAUTOWIN_PROMPT_V1: le second')
    ).toBe('le second')
  })

  it('IGNORE un marqueur cité dans un bloc de code — un exemple n’est pas une consigne', () => {
    const texte = 'Format :\n```\nAUTOWIN_PROMPT_V1: ceci est un exemple\n```\nfin'
    expect(extrairePromptSuivant(texte)).toBeNull()
  })

  it('refuse un prompt vide ou réduit à de la ponctuation', () => {
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1:    ')).toBeNull()
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: —')).toBeNull()
  })

  it('borne un prompt délirant plutôt que de remplir le composer d’un pavé', () => {
    const long = 'a'.repeat(1200)
    const lu = extrairePromptSuivant(`AUTOWIN_PROMPT_V1: ${long}`)
    expect(lu).not.toBeNull()
    expect((lu as string).length).toBeLessThanOrEqual(600)
  })

  it('retire le gras et les accents graves du markdown, un composer n’est pas du markdown', () => {
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: relance **`npm test`** ici')).toBe(
      'relance npm test ici'
    )
  })

  it('ne jette pas sur une entrée absente', () => {
    expect(extrairePromptSuivant(undefined)).toBeNull()
    expect(extrairePromptSuivant('')).toBeNull()
  })
})

describe('retrait de la ligne technique de l’affichage', () => {
  it('retire la ligne et rien d’autre', () => {
    expect(retirerLignePromptSuivant(`avant\n${LIGNE}\napres`)).toBe('avant\napres')
  })

  it('retire aussi une ligne PARTIELLE pendant le streaming — pas de clignotement', () => {
    expect(retirerLignePromptSuivant('texte\nAUTOWIN_PROMPT_V1: Lance le ter')).toBe('texte')
  })

  it('retire même le marqueur seul, encore sans ses deux-points', () => {
    expect(retirerLignePromptSuivant('texte\nAUTOWIN_PROMPT_V')).toBe('texte')
  })

  it('laisse intact un texte qui n’en porte pas', () => {
    expect(retirerLignePromptSuivant('rien a retirer')).toBe('rien a retirer')
  })

  it('PRÉSERVE la ligne citée dans un bloc de code : c’est de la documentation, pas du bruit', () => {
    const texte = 'Format :\n```\nAUTOWIN_PROMPT_V1: exemple\n```\nfin'
    expect(retirerLignePromptSuivant(texte)).toBe(texte)
  })

  it('ne laisse pas une ligne vide en fin de texte à la place de la ligne retirée', () => {
    expect(retirerLignePromptSuivant(`fin du travail\n${LIGNE}`)).toBe('fin du travail')
  })
})
