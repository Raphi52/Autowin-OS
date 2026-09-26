import { describe, expect, it } from 'vitest'
import {
  CoffreAutorisationProd,
  DUREE_JETON_MS,
  DUREE_VERROU_MS,
  TENTATIVES_AVANT_VERROU,
  definirPhrase,
  phraseCorrespond
} from './prod-passphrase'

/**
 * MOT DE PASSE DE PRODUCTION — ces tests fixent la seule propriété qui compte : le modèle ne peut
 * pas s'autoriser lui-même. Tout ce qui suit décrit des façons précises de contourner la porte, et
 * vérifie qu'aucune ne marche.
 *
 * `scrypt` est volontairement lent (paramètres OWASP). On dérive donc UNE fois une empreinte de
 * référence partagée par les tests, plutôt qu'à chaque cas.
 */
const PHRASE = 'phrase-de-passe-de-reference'
const EMPREINTE = definirPhrase(PHRASE, 1_000)
const T0 = 10_000
const DEMANDE = { cible: 'base:RIG_AMIENS', operation: 'sql-write' }

describe('empreinte de la phrase', () => {
  it('ne conserve nulle part la phrase en clair', () => {
    const serialisee = JSON.stringify(EMPREINTE)
    expect(serialisee).not.toContain(PHRASE)
    expect(serialisee).not.toContain('phrase-de-passe')
  })

  it('reconnaît la bonne phrase et rejette une phrase voisine', () => {
    expect(phraseCorrespond(PHRASE, EMPREINTE)).toBe(true)
    expect(phraseCorrespond(`${PHRASE}x`, EMPREINTE)).toBe(false)
    expect(phraseCorrespond(PHRASE.toUpperCase(), EMPREINTE)).toBe(false)
    expect(phraseCorrespond('', EMPREINTE)).toBe(false)
  })

  it('rejette tout quand aucune empreinte n’existe', () => {
    expect(phraseCorrespond(PHRASE, undefined)).toBe(false)
  })

  it('refuse de définir une phrase trop courte', () => {
    expect(() => definirPhrase('court')).toThrow()
  })

  it('utilise un sel différent à chaque définition — deux empreintes ne sont pas comparables', () => {
    const autre = definirPhrase(PHRASE, 1_000)
    expect(autre.sel).not.toBe(EMPREINTE.sel)
    expect(autre.empreinte).not.toBe(EMPREINTE.empreinte)
    expect(phraseCorrespond(PHRASE, autre)).toBe(true)
  })
})

describe('ouverture de la porte', () => {
  it('accorde un jeton lié à la cible ET à l’opération demandées', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const resultat = coffre.ouvrir(PHRASE, DEMANDE, T0)
    expect(resultat.accorde).toBe(true)
    if (!resultat.accorde) return
    expect(resultat.jeton.cible).toBe(DEMANDE.cible)
    expect(resultat.jeton.operation).toBe(DEMANDE.operation)
    expect(resultat.jeton.expireLe).toBe(T0 + DUREE_JETON_MS)
  })

  it('refuse une mauvaise phrase, sans rien dire de la vraie', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const resultat = coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0)
    expect(resultat.accorde).toBe(false)
    if (resultat.accorde) return
    expect(resultat.motif).not.toContain(PHRASE)
  })

  /** Sans phrase définie, la porte ne s'ouvre pas — l'absence de réglage n'est pas une permission. */
  it('refuse tout quand aucune phrase n’est définie', () => {
    const coffre = new CoffreAutorisationProd(undefined)
    expect(coffre.phraseAbsente).toBe(true)
    expect(coffre.ouvrir(PHRASE, DEMANDE, T0).accorde).toBe(false)
  })

  it('refuse une demande sans cible ou sans opération', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    expect(coffre.ouvrir(PHRASE, { cible: '  ', operation: 'sql-write' }, T0).accorde).toBe(false)
    expect(coffre.ouvrir(PHRASE, { cible: 'base:X', operation: '' }, T0).accorde).toBe(false)
  })
})

describe('bornes du jeton', () => {
  it('ne sert QU’UNE fois — un rejeu est refusé', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const ouverture = coffre.ouvrir(PHRASE, DEMANDE, T0)
    if (!ouverture.accorde) throw new Error('ouverture attendue')
    expect(coffre.consommer(ouverture.jeton.valeur, DEMANDE, T0 + 10)).toEqual({ autorise: true })
    const rejeu = coffre.consommer(ouverture.jeton.valeur, DEMANDE, T0 + 20)
    expect(rejeu.autorise).toBe(false)
  })

  it('expire après sa durée de vie', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const ouverture = coffre.ouvrir(PHRASE, DEMANDE, T0)
    if (!ouverture.accorde) throw new Error('ouverture attendue')
    const tard = coffre.consommer(ouverture.jeton.valeur, DEMANDE, T0 + DUREE_JETON_MS)
    expect(tard.autorise).toBe(false)
    if (tard.autorise) return
    expect(tard.motif).toContain('expirée')
  })

  /** Le détournement le plus probable : obtenir l'accord pour un geste anodin, l'employer ailleurs. */
  it('ne vaut PAS pour une autre cible ni une autre opération', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const ouverture = coffre.ouvrir(PHRASE, DEMANDE, T0)
    if (!ouverture.accorde) throw new Error('ouverture attendue')
    const autreCible = coffre.consommer(
      ouverture.jeton.valeur,
      { cible: 'base:RIG_LILLE', operation: 'sql-write' },
      T0 + 10
    )
    expect(autreCible.autorise).toBe(false)

    const seconde = coffre.ouvrir(PHRASE, DEMANDE, T0)
    if (!seconde.accorde) throw new Error('ouverture attendue')
    const autreOperation = coffre.consommer(
      seconde.jeton.valeur,
      { cible: DEMANDE.cible, operation: 'suppression' },
      T0 + 10
    )
    expect(autreOperation.autorise).toBe(false)
  })

  /** Un jeton présenté de travers est BRÛLÉ : sinon on pourrait tâtonner sans coût. */
  it('brûle le jeton même quand il est présenté pour autre chose', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    const ouverture = coffre.ouvrir(PHRASE, DEMANDE, T0)
    if (!ouverture.accorde) throw new Error('ouverture attendue')
    coffre.consommer(
      ouverture.jeton.valeur,
      { cible: 'base:AUTRE', operation: 'sql-write' },
      T0 + 5
    )
    expect(coffre.consommer(ouverture.jeton.valeur, DEMANDE, T0 + 6).autorise).toBe(false)
  })

  it('refuse une valeur de jeton inventée', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    expect(coffre.consommer('jeton-invente', DEMANDE, T0).autorise).toBe(false)
    expect(coffre.consommer('', DEMANDE, T0).autorise).toBe(false)
  })
})

describe('freinage des tentatives', () => {
  it('verrouille la porte après trop d’échecs, même avec la bonne phrase ensuite', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    for (let essai = 0; essai < TENTATIVES_AVANT_VERROU; essai += 1) {
      expect(coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0).accorde).toBe(false)
    }
    const bloque = coffre.ouvrir(PHRASE, DEMANDE, T0 + 1)
    expect(bloque.accorde).toBe(false)
    if (bloque.accorde) return
    expect(bloque.verrouilleJusqua).toBe(T0 + DUREE_VERROU_MS)
  })

  it('rouvre après la fin du verrou', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    for (let essai = 0; essai < TENTATIVES_AVANT_VERROU; essai += 1) {
      coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0)
    }
    expect(coffre.ouvrir(PHRASE, DEMANDE, T0 + DUREE_VERROU_MS + 1).accorde).toBe(true)
  })

  it('remet le compteur à zéro après une ouverture réussie', () => {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0)
    coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0)
    expect(coffre.ouvrir(PHRASE, DEMANDE, T0).accorde).toBe(true)
    for (let essai = 0; essai < TENTATIVES_AVANT_VERROU - 1; essai += 1) {
      const refus = coffre.ouvrir('mauvaise-phrase-longue', DEMANDE, T0)
      expect(refus.accorde).toBe(false)
      if (!refus.accorde) expect(refus.verrouilleJusqua).toBeUndefined()
    }
  })
})
