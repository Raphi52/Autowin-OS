import { describe, expect, it, vi } from 'vitest'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'
import {
  CANAL_AUTORISER,
  CANAL_DEFINIR,
  CANAL_ETAT,
  registerProdPassphraseIpc,
  type EtatPhraseProd,
  type ProdPassphraseIpcRegistrar,
  type ReponseAutorisation,
  type ReponseDefinition
} from './prod-passphrase-ipc'

/**
 * LE CANAL DE LA PHRASE DE PASSE — ces tests vérifient qu'aucune information exploitable ne sort
 * vers l'écran, et que le garde de provenance est réellement appelé sur CHAQUE canal.
 */
const PHRASE = 'phrase-de-passe-de-reference'
const EMPREINTE = definirPhrase(PHRASE, 4_242)
const DEMANDE = { cible: 'base:RIG_AMIENS', operation: 'sql-write' }

function montage(options: { avecPhrase?: boolean } = {}) {
  // Reproduit la frontière variadique d'Electron pour un registre en mémoire.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = {
    handle: (channel, handler) => handlers.set(channel, handler)
  } satisfies ProdPassphraseIpcRegistrar
  let empreinte = options.avecPhrase === false ? undefined : EMPREINTE
  let coffre = new CoffreAutorisationProd(empreinte)
  const verifierExpediteur = vi.fn()
  registerProdPassphraseIpc(ipc, {
    lireEmpreinte: () => empreinte,
    enregistrerPhrase: (phrase: string) => {
      empreinte = definirPhrase(phrase)
      coffre = new CoffreAutorisationProd(empreinte)
    },
    coffre: () => coffre,
    verifierExpediteur
  })
  return {
    handlers,
    verifierExpediteur,
    empreinteActuelle: () => empreinte
  }
}

describe('état de la phrase', () => {
  it('dit seulement si une phrase existe — jamais le sel ni l’empreinte', () => {
    const { handlers } = montage()
    const etat = handlers.get(CANAL_ETAT)?.({}) as EtatPhraseProd
    expect(etat.definie).toBe(true)
    expect(etat.definieLe).toBe(4_242)
    expect(JSON.stringify(etat)).not.toContain(EMPREINTE.sel)
    expect(JSON.stringify(etat)).not.toContain(EMPREINTE.empreinte)
    expect(JSON.stringify(etat)).not.toContain(PHRASE)
  })

  it('signale l’absence de phrase, avec la longueur minimale à respecter', () => {
    const { handlers } = montage({ avecPhrase: false })
    const etat = handlers.get(CANAL_ETAT)?.({}) as EtatPhraseProd
    expect(etat.definie).toBe(false)
    expect(etat.longueurMinimale).toBeGreaterThan(0)
  })
})

describe('définition de la phrase', () => {
  it('enregistre une phrase valable, qui ouvre ensuite la porte', () => {
    const { handlers } = montage({ avecPhrase: false })
    const reponse = handlers.get(CANAL_DEFINIR)?.({}, 'ma-nouvelle-phrase') as ReponseDefinition
    expect(reponse).toEqual({ ok: true })
    const autorisation = handlers.get(CANAL_AUTORISER)?.(
      {},
      'ma-nouvelle-phrase',
      DEMANDE
    ) as ReponseAutorisation
    expect(autorisation.accorde).toBe(true)
  })

  it('refuse une phrase trop courte, et laisse le réglage inchangé', () => {
    const { handlers, empreinteActuelle } = montage()
    const reponse = handlers.get(CANAL_DEFINIR)?.({}, 'court') as ReponseDefinition
    expect(reponse.ok).toBe(false)
    expect(empreinteActuelle()).toBe(EMPREINTE)
  })

  it('refuse ce qui n’est même pas du texte', () => {
    const { handlers } = montage()
    for (const brut of [undefined, null, 42, { phrase: 'x' }]) {
      expect((handlers.get(CANAL_DEFINIR)?.({}, brut) as ReponseDefinition).ok).toBe(false)
    }
  })
})

describe('autorisation', () => {
  it('rend un jeton opaque, et JAMAIS la phrase', () => {
    const { handlers } = montage()
    const reponse = handlers.get(CANAL_AUTORISER)?.({}, PHRASE, DEMANDE) as ReponseAutorisation
    expect(reponse.accorde).toBe(true)
    const serialisee = JSON.stringify(reponse)
    expect(serialisee).not.toContain(PHRASE)
    expect(serialisee).not.toContain(EMPREINTE.empreinte)
  })

  it('refuse une mauvaise phrase sans rien révéler de la vraie', () => {
    const { handlers } = montage()
    const reponse = handlers.get(CANAL_AUTORISER)?.(
      {},
      'mauvaise-phrase-longue',
      DEMANDE
    ) as ReponseAutorisation
    expect(reponse.accorde).toBe(false)
    if (reponse.accorde) return
    expect(reponse.motif).not.toContain(PHRASE)
  })

  it('refuse quand aucune phrase n’est définie', () => {
    const { handlers } = montage({ avecPhrase: false })
    const reponse = handlers.get(CANAL_AUTORISER)?.({}, PHRASE, DEMANDE) as ReponseAutorisation
    expect(reponse.accorde).toBe(false)
  })

  it('refuse une demande abîmée plutôt que de l’interpréter', () => {
    const { handlers } = montage()
    for (const demande of [undefined, {}, { cible: 'base:X' }, { operation: 'sql-write' }]) {
      const reponse = handlers.get(CANAL_AUTORISER)?.({}, PHRASE, demande) as ReponseAutorisation
      expect(reponse.accorde).toBe(false)
    }
  })

  /** Le jeton reste lié à sa demande : c'est le coffre qui le tient, le canal ne l'élargit pas. */
  it('rend un jeton qui ne vaut que pour la cible demandée', () => {
    const { handlers } = montage()
    const reponse = handlers.get(CANAL_AUTORISER)?.({}, PHRASE, DEMANDE) as ReponseAutorisation
    expect(reponse.accorde).toBe(true)
    if (!reponse.accorde) return
    expect(reponse.expireLe).toBeGreaterThan(Date.now())
  })
})

describe('provenance', () => {
  /** Un canal qui accorde des droits ne doit pas répondre à n'importe quelle fenêtre. */
  it('vérifie l’expéditeur sur CHACUN des trois canaux', () => {
    const { handlers, verifierExpediteur } = montage()
    handlers.get(CANAL_ETAT)?.({})
    handlers.get(CANAL_DEFINIR)?.({}, 'une-phrase-valable')
    handlers.get(CANAL_AUTORISER)?.({}, PHRASE, DEMANDE)
    expect(verifierExpediteur).toHaveBeenCalledTimes(3)
  })

  it('laisse remonter le refus du garde, sans rien exécuter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = new Map<string, (...args: any[]) => any>()
    const enregistrer = vi.fn()
    registerProdPassphraseIpc(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      {
        lireEmpreinte: () => EMPREINTE,
        enregistrerPhrase: enregistrer,
        coffre: () => new CoffreAutorisationProd(EMPREINTE),
        verifierExpediteur: () => {
          throw new Error('fenêtre inconnue')
        }
      }
    )
    expect(() => handlers.get(CANAL_DEFINIR)?.({}, 'une-phrase-valable')).toThrow(
      'fenêtre inconnue'
    )
    expect(enregistrer).not.toHaveBeenCalled()
  })
})

/**
 * CHANGER LA PHRASE. Sans preuve de la phrase EN COURS, la protection se désactiverait en la
 * réécrivant par-dessus : quiconque atteint l'écran de réglages s'ouvrirait la production.
 */
describe('changement de la phrase', () => {
  it('REFUSE le changement sans la phrase actuelle, et ne touche à rien', () => {
    const { handlers, empreinteActuelle } = montage()
    const avant = empreinteActuelle()
    const reponse = handlers.get(CANAL_DEFINIR)?.(
      {},
      'une-autre-phrase-longue'
    ) as ReponseDefinition
    expect(reponse.ok).toBe(false)
    expect(empreinteActuelle()).toBe(avant)
  })

  it('REFUSE une phrase actuelle fausse', () => {
    const { handlers, empreinteActuelle } = montage()
    const avant = empreinteActuelle()
    const reponse = handlers.get(CANAL_DEFINIR)?.(
      {},
      'une-autre-phrase-longue',
      'pas-la-bonne-du-tout'
    ) as ReponseDefinition
    expect(reponse.ok).toBe(false)
    if (reponse.ok) return
    expect(reponse.erreur).toContain('actuelle')
    expect(empreinteActuelle()).toBe(avant)
  })

  it('ACCEPTE le changement avec la phrase actuelle exacte', () => {
    const { handlers, empreinteActuelle } = montage()
    const avant = empreinteActuelle()
    const reponse = handlers.get(CANAL_DEFINIR)?.(
      {},
      'une-autre-phrase-longue',
      PHRASE
    ) as ReponseDefinition
    expect(reponse.ok).toBe(true)
    expect(empreinteActuelle()).not.toBe(avant)
  })

  it('n’exige rien au PREMIER réglage : il n’y a encore rien à protéger', () => {
    const { handlers, empreinteActuelle } = montage({ avecPhrase: false })
    const reponse = handlers.get(CANAL_DEFINIR)?.({}, 'toute-premiere-phrase') as ReponseDefinition
    expect(reponse.ok).toBe(true)
    expect(empreinteActuelle()).not.toBeUndefined()
  })

  it('refuse une phrase trop courte MÊME avec la phrase actuelle exacte', () => {
    const { handlers, empreinteActuelle } = montage()
    const avant = empreinteActuelle()
    const reponse = handlers.get(CANAL_DEFINIR)?.({}, 'court', PHRASE) as ReponseDefinition
    expect(reponse.ok).toBe(false)
    expect(empreinteActuelle()).toBe(avant)
  })
})
