import { describe, expect, it } from 'vitest'
import {
  adopterLeTourPersiste,
  completerAvecHistorique,
  filAffichable,
  type MessageAffichable
} from './fil-affichable'

const u = (content: string): MessageAffichable & { content: string } => ({
  role: 'user',
  content
})
const a = (content: string, done = true): MessageAffichable & { content: string } => ({
  role: 'assistant',
  content,
  done
})

describe('filAffichable', () => {
  it("ne RETRECIT pas le fil : un cache tronque ne cache plus l'historique du store", () => {
    // conv-152 : cache amorce par un tour lance cote main, store complet.
    const store = [u('q1'), a('r1'), u('q2'), a('r2'), u('/kaizen'), a('', false)]
    const cacheTronque = [a('', false)]
    const rendu = filAffichable(cacheTronque, store)
    expect(rendu.map((m) => (m as { content: string }).content)).toEqual([
      'q1',
      'r1',
      'q2',
      'r2',
      '/kaizen',
      ''
    ])
  })

  it('garde la queue VIVANTE du cache, que le store ne connait pas encore', () => {
    const store = [u('q1'), a('r1')]
    const cache = [a('en vol', false)]
    expect(filAffichable(cache, store)).toEqual([u('q1'), a('r1'), a('en vol', false)])
  })

  it('un cache PLEIN gagne sur un store vide (conv-82)', () => {
    const cache = [u('q1'), a('r1')]
    expect(filAffichable(cache, [])).toEqual(cache)
  })

  it('un cache vide est une absence, pas un fil', () => {
    const store = [u('q1'), a('r1')]
    expect(filAffichable([], store)).toEqual(store)
    expect(filAffichable(undefined, store)).toEqual(store)
  })

  it('un cache plus court SANS tour en vol laisse le store faire foi', () => {
    const store = [u('q1'), a('r1'), u('q2'), a('r2')]
    expect(filAffichable([u('q1'), a('r1')], store)).toEqual(store)
  })
})

type Ligne = { role: string; content: string; done?: boolean; messageId?: string }

describe('completerAvecHistorique', () => {
  const h: Ligne[] = [
    { role: 'user', content: 'vieux', messageId: 'b1' },
    { role: 'assistant', content: 'vieille reponse', messageId: 'b2', done: true }
  ]

  it("recolle l'historique meme si le fil live porte deja un message utilisateur (conv-152)", () => {
    const live: Ligne[] = [
      { role: 'assistant', content: 'en vol', done: false },
      { role: 'user', content: 'tape pendant la lecture du store' },
      { role: 'assistant', content: '', done: false }
    ]
    expect(completerAvecHistorique(h, live)).toEqual([...h, ...live])
  })

  it('ne recolle pas DEUX fois : un identifiant persiste deja present suffit', () => {
    const live: Ligne[] = [...h, { role: 'assistant', content: 'en vol', done: false }]
    expect(completerAvecHistorique(h, live)).toBe(live)
  })

  it('un historique vide laisse le fil live intact', () => {
    const live: Ligne[] = [{ role: 'assistant', content: 'en vol', done: false }]
    expect(completerAvecHistorique([], live)).toBe(live)
  })
})

/*
 * REJEU DE conv-1118 (2026-10-23, « j'ai eu 2x le meme bloc ») : un tour lancé côté main (reprise
 * automatique) a posé UNE question, enregistrée UNE fois — et le fil l'a montrée DEUX fois. Le tour
 * a fini 25 ms après son premier événement : quand la lecture du store est revenue, sa copie
 * persistée était déjà CLOSE, donc gardée, et recollée devant l'amorce live du MÊME tour.
 */
type LigneDeTour = Ligne & { turnId?: string }

describe('un même tour ne se peint jamais deux fois (conv-1118)', () => {
  const reprise: LigneDeTour = { role: 'user', content: '[Reprise automatique] …', messageId: 'm5' }
  const persiste: LigneDeTour = {
    role: 'assistant',
    content: 'Ta demande peut se lire de deux façons…',
    messageId: 'm6',
    turnId: 'tour-2655',
    done: true
  }
  const amorce: LigneDeTour = {
    role: 'assistant',
    content: 'Ta demande peut se lire de deux façons…',
    turnId: 'tour-2655',
    done: true
  }

  it("completerAvecHistorique : la copie persistée du tour en vol n'est pas recollée devant son amorce", () => {
    const rendu = completerAvecHistorique([...h(), reprise, persiste], [amorce])
    expect(rendu.filter((m) => m.turnId === 'tour-2655')).toHaveLength(1)
    expect(rendu).toEqual([...h(), reprise, amorce])
  })

  it("filAffichable : la copie persistée CLOSE du tour en vol n'est pas peinte en plus de la queue vivante", () => {
    const enVol: LigneDeTour = { ...amorce, done: false }
    const rendu = filAffichable([enVol], [...h(), reprise, persiste])
    expect(rendu).toEqual([...h(), reprise, enVol])
  })

  it("un AUTRE tour persisté reste recollé : seul le tour de l'amorce est écarté", () => {
    const autre: LigneDeTour = { ...persiste, messageId: 'm4', turnId: 'tour-precedent' }
    expect(completerAvecHistorique([autre, reprise, persiste], [amorce])).toEqual([
      autre,
      reprise,
      amorce
    ])
  })

  function h(): LigneDeTour[] {
    return [{ role: 'user', content: 'vieux', messageId: 'b1' }]
  }
})

// conv-1146 (2026-10-25) : la bulle vide d'une adoption prend pour base le tour persiste du MEME tour.
describe('adopterLeTourPersiste', () => {
  type Bulle = MessageAffichable & { parts: string[]; providerStatus?: string }
  const amorce: Bulle = {
    role: 'assistant',
    done: false,
    turnId: 'T',
    parts: [],
    providerStatus: 'vivant'
  }
  const persiste: Bulle = {
    role: 'assistant',
    done: false,
    turnId: 'T',
    parts: ['réponse', 'orchestrate']
  }

  it('remplace la bulle vide par la copie non close du même tour, en gardant le direct', () => {
    const fil = adopterLeTourPersiste([{ role: 'user', parts: [] }, persiste], [amorce])
    expect(fil).toEqual([{ ...persiste, providerStatus: 'vivant' }])
  })

  it("laisse la bulle d'un AUTRE tour, ou sans tour, à sa place (même tableau)", () => {
    const autre: Bulle = { ...persiste, turnId: 'mort' }
    const sansTour: Bulle = { role: 'assistant', done: false, parts: [] }
    const fil = [amorce, sansTour]
    expect(adopterLeTourPersiste([autre], fil)).toBe(fil)
    expect(adopterLeTourPersiste([{ ...persiste, done: true }], fil)).toBe(fil)
  })
})
