import { describe, it, expect } from 'vitest'
import { deciderDuPassage } from './boucle-reparation'
import { objectionsDuJuge, verdictAvecObjectionsPortees } from '../juge/objections-juge'
import { lireVerdictJuge } from './orchestrator'
import {
  defaultQuorumThreshold,
  issueDuPanel,
  motifPanneDesJuges,
  seuilDuPanel,
  verdictDuPanel,
  type IssueDuPanel
} from './quorum'

describe('defaultQuorumThreshold', () => {
  it('majorité simple ⌈N/2⌉, minimum 1', () => {
    expect(defaultQuorumThreshold(0)).toBe(1)
    expect(defaultQuorumThreshold(1)).toBe(1)
    expect(defaultQuorumThreshold(2)).toBe(1)
    expect(defaultQuorumThreshold(3)).toBe(2)
    expect(defaultQuorumThreshold(4)).toBe(2)
    expect(defaultQuorumThreshold(5)).toBe(3)
  })
})

describe('seuilDuPanel — calculé sur les juges PRÉVUS (conv-1420)', () => {
  it('majorité des prévus sans quorum composé', () => {
    expect(seuilDuPanel(3)).toBe(2)
    expect(seuilDuPanel(2)).toBe(1)
  })

  it('le quorum du graphe prime, borné au nombre de juges prévus', () => {
    expect(seuilDuPanel(3, 2)).toBe(2)
    expect(seuilDuPanel(3, 3)).toBe(3)
    expect(seuilDuPanel(2, 5)).toBe(2)
  })

  it('un quorum nul ou négatif ne descend jamais sous 1', () => {
    expect(seuilDuPanel(3, 0)).toBe(2)
    expect(seuilDuPanel(3, -1)).toBe(1)
  })
})

describe('issueDuPanel — 3 juges prévus, seuil 2', () => {
  const issue = (valides: number, refus: number): IssueDuPanel =>
    issueDuPanel({ prevus: 3, valides, refus })

  it.each([
    [3, 0, 'atteint', 0],
    [2, 1, 'atteint', 0],
    [2, 0, 'atteint', 1],
    [1, 2, 'refuse', 0],
    [1, 1, 'refuse', 1],
    [0, 3, 'refuse', 0],
    [0, 2, 'refuse', 1],
    [0, 1, 'refuse', 2],
    [1, 0, 'incomplet', 2],
    [0, 0, 'aucun', 3]
  ] as const)('%i VALIDE, %i refus → %s, %i absent(s)', (valides, refus, kind, absents) => {
    expect(issue(valides, refus)).toMatchObject({ kind, absents, seuil: 2, prevus: 3, valides })
  })

  it('le quorum composé compte : 2 VALIDE ne suffisent plus à un seuil de 3', () => {
    expect(issueDuPanel({ prevus: 3, valides: 2, refus: 0, quorumDuGraphe: 3 }).kind).toBe(
      'incomplet'
    )
    expect(issueDuPanel({ prevus: 3, valides: 3, refus: 0, quorumDuGraphe: 3 }).kind).toBe(
      'atteint'
    )
  })

  it('2 juges prévus, seuil 1 : 1 VALIDE et 1 absent passent', () => {
    expect(issueDuPanel({ prevus: 2, valides: 1, refus: 0 })).toMatchObject({
      kind: 'atteint',
      absents: 1
    })
  })
})

describe('verdictDuPanel — ce que lisent le contrôle final et l’utilisateur', () => {
  const texte = (valides: number, refus: number, raisons: string[] = []): string =>
    verdictDuPanel(issueDuPanel({ prevus: 3, valides, refus }), {
      verdictValide: 'VALIDE',
      raisons
    })

  it('sans absent, le verdict des membres passe tel quel', () => {
    expect(texte(3, 0)).toBe('VALIDE')
  })

  it('un absent devient une puce OK, jamais un refus ni une objection', () => {
    const verdict = texte(2, 0)
    expect(verdict).toBe("VALIDE\n\nOBJECTIONS:\n- OK: hors run — 1 juge sur 3 n'a pas répondu")
    expect(verdict).not.toMatch(/d[ée]faut/i)
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(verdict))).toBe(true)
    expect(objectionsDuJuge(verdict)).toEqual([])
  })

  it('la puce rejoint les objections déjà portées par les membres', () => {
    const verdict = verdictDuPanel(issueDuPanel({ prevus: 3, valides: 2, refus: 0 }), {
      verdictValide: 'VALIDE\n\nOBJECTIONS:\n- MINEUR: libellé trompeur',
      raisons: []
    })
    expect(verdict).toBe(
      "VALIDE\n\nOBJECTIONS:\n- MINEUR: libellé trompeur\n- OK: hors run — 1 juge sur 3 n'a pas répondu"
    )
    expect(objectionsDuJuge(verdict)).toEqual(['libellé trompeur'])
  })

  it('un refus garde ses raisons et nomme les absents', () => {
    const verdict = texte(1, 1, ['DEFAUT: raison'])
    expect(verdict).toBe(
      "DEFAUT: quorum non atteint (1/3 VALIDE, seuil 2) ; 1 juge sur 3 n'a pas répondu — DEFAUT: raison"
    )
    expect(lireVerdictJuge(verdict)).toBe(false)
  })

  it('jumeau : un refus sans absent garde sa forme d’avant', () => {
    expect(texte(1, 2, ['DEFAUT: raison'])).toBe(
      'DEFAUT: quorum non atteint (1/3 VALIDE, seuil 2) — DEFAUT: raison'
    )
  })

  it('verdict incomplet : refusé, sans objection à réparer', () => {
    const verdict = texte(1, 0)
    expect(verdict).toBe(
      "DEFAUT: verdict incomplet — 2 juges sur 3 n'ont pas répondu (1/3 VALIDE, seuil 2)"
    )
    expect(lireVerdictJuge(verdict)).toBe(false)
    expect(objectionsDuJuge(verdict)).toEqual([])
  })

  it('aucun juge : le texte existant est gardé', () => {
    expect(texte(0, 0)).toBe('DEFAUT: aucun juge n’a répondu (tous en échec)')
  })
})

describe('motifPanneDesJuges — seule une panne arrête la réparation', () => {
  const motif = (valides: number, refus: number): string | undefined =>
    motifPanneDesJuges(issueDuPanel({ prevus: 3, valides, refus }))

  it('nomme le verdict incomplet et le cas sans aucun juge', () => {
    expect(motif(1, 0)).toContain('verdict incomplet')
    expect(motif(1, 0)).toContain("2 juges sur 3 n'ont pas répondu")
    expect(motif(0, 0)).toContain('aucun juge')
  })

  it('jumeaux : un quorum atteint ou un refus nommé ne sont pas des pannes', () => {
    expect(motif(2, 0)).toBeUndefined()
    expect(motif(1, 1)).toBeUndefined()
    expect(motif(0, 2)).toBeUndefined()
  })
})

describe('deciderDuPassage — panne des juges', () => {
  const passage = (panneDesJuges?: string): string | undefined =>
    deciderDuPassage({
      attempt: 0,
      reparationsAccordees: 3,
      plafondDur: 8,
      motifsCourants: ['motif'],
      etat: { motifsPrecedents: [], refusIdentiquesConsecutifs: 0 },
      jusquAuVert: true,
      ...(panneDesJuges ? { panneDesJuges } : {})
    }).arret

  it('arrête la boucle, même jusqu’au vert', () => {
    expect(passage('panne')).toBe('panne')
  })

  it('jumeau : sans panne, jusqu’au vert continue', () => {
    expect(passage()).toBeUndefined()
  })
})
