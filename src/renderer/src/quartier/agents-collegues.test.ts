// @vitest-environment happy-dom
/**
 * LES AGENTS DES COLLÈGUES (conv-1429, lot 4) : ce qui décide de ce que la scène montre.
 * Couleur stable par poste, validation d'une donnée venue d'un autre poste, plafond, mode du bouton.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { PresencesDesCollegues } from '../../../shared/quartier-presence'
import {
  agentCollegue,
  agentsDesCollegues,
  animalDeLAgent,
  animalDuPoste,
  ANIMAUX_COLLEGUES,
  choisirModeVillage,
  CLE_MODE_VILLAGE,
  COLLEGUES_AGENTS_MAX,
  consigneDuCollegue,
  couleurDuPoste,
  estIdCollegue,
  idCollegue,
  lireAgentsCollegues,
  lireModeVillage,
  modeLu,
  oublierAgentsCollegues,
  PALETTE_COLLEGUES,
  poserAgentsCollegues,
  selonLeMode
} from './agents-collegues'
import { consigneDe, type AgentQuartier } from './agents-quartier'

const MAINTENANT = Date.parse('2026-11-02T10:00:00.000Z')
const IL_Y_A_2_MIN = '2026-11-02T09:58:00.000Z'

function presences(
  ...collegues: { poste: string; prenom?: string; agents: number | object[] }[]
): PresencesDesCollegues {
  return {
    collegues: collegues.map((c) => ({
      poste: c.poste,
      nom: c.prenom ?? c.poste,
      prenom: c.prenom ?? c.poste,
      agents:
        typeof c.agents === 'number'
          ? Array.from({ length: c.agents }, (_, i) => ({
              id: `conv-${i + 1}`,
              titre: `Fil ${i + 1}`,
              phase: 'travail' as const,
              metier: 'lire',
              depuis: IL_Y_A_2_MIN
            }))
          : (c.agents as PresencesDesCollegues['collegues'][number]['agents'])
    }))
  }
}

afterEach(() => {
  oublierAgentsCollegues()
  window.localStorage.clear()
})

describe('la couleur d’une personne', () => {
  it('est la même à chaque lecture, quelle que soit la casse du poste', () => {
    expect(couleurDuPoste('arthur.l')).toBe(couleurDuPoste('arthur.l'))
    expect(couleurDuPoste('Arthur.L')).toBe(couleurDuPoste('arthur.l'))
  })

  it('vient toujours de la palette fixe de huit teintes', () => {
    expect(PALETTE_COLLEGUES).toHaveLength(8)
    for (const poste of ['a', 'b', 'claire.d', 'poste-123', 'é', ''])
      expect(PALETTE_COLLEGUES).toContain(couleurDuPoste(poste))
  })

  it('répartit des postes différents sur plusieurs teintes', () => {
    const teintes = new Set(Array.from({ length: 40 }, (_, i) => couleurDuPoste(`poste${i}`)))
    expect(teintes.size).toBeGreaterThanOrEqual(6)
  })

  it('suit l’agent jusque dans la scène', () => {
    const [a] = agentsDesCollegues(presences({ poste: 'claire.d', agents: 1 }), MAINTENANT)
    expect(a.collegue.couleur).toBe(couleurDuPoste('claire.d'))
  })
})

describe('l’animal d’une personne (conv-1446)', () => {
  it('est le renard, le seul animal de la liste pour l’instant', () => {
    expect(ANIMAUX_COLLEGUES).toEqual(['renard'])
    for (const poste of ['a', 'claire.d', 'poste-123', 'é', ''])
      expect(animalDuPoste(poste)).toBe('renard')
  })

  it('est le même à chaque lecture, quelle que soit la casse du poste', () => {
    expect(animalDuPoste('Arthur.L')).toBe(animalDuPoste('arthur.l'))
    const lire = (): string[] =>
      agentsDesCollegues(
        presences({ poste: 'claire.d', agents: 2 }, { poste: 'Bob', agents: 1 }),
        MAINTENANT
      ).map((a) => a.collegue.animal)
    expect(lire()).toEqual(['renard', 'renard', 'renard'])
    expect(lire()).toEqual(lire())
  })

  it('suit l’agent du collègue jusque dans la scène, à côté de son foulard', () => {
    const [a] = agentsDesCollegues(presences({ poste: 'claire.d', agents: 1 }), MAINTENANT)
    expect(a.collegue).toMatchObject({
      animal: animalDuPoste('claire.d'),
      couleur: couleurDuPoste('claire.d')
    })
    expect(animalDeLAgent(a)).toBe('renard')
  })

  it('n’existe pas pour mes agents, qui restent des tanukis', () => {
    const mien: AgentQuartier = {
      id: 'conv-1',
      titre: 'Mon fil',
      phase: 'travail',
      metier: 'lire',
      actions: [],
      depuis: MAINTENANT
    }
    expect('collegue' in mien).toBe(false)
    expect(animalDeLAgent(mien)).toBeNull()
  })
})

describe('des agents distincts des miens', () => {
  it('préfixe l’identifiant par le poste : deux conv-1 ne se confondent pas', () => {
    const liste = agentsDesCollegues(
      presences({ poste: 'claire.d', agents: 1 }, { poste: 'bob', agents: 1 }),
      MAINTENANT
    )
    expect(liste.map((a) => a.id)).toEqual([
      idCollegue('claire.d', 'conv-1'),
      idCollegue('bob', 'conv-1')
    ])
    expect(liste.every((a) => estIdCollegue(a.id))).toBe(true)
    expect(estIdCollegue('conv-1')).toBe(false)
    expect(liste[0].collegue.idFil).toBe('conv-1')
  })

  it('garde le prénom, le titre publié, la phase, le métier et le « depuis »', () => {
    const [a] = agentsDesCollegues(
      presences({ poste: 'claire.d', prenom: 'Claire', agents: 1 }),
      MAINTENANT
    )
    expect(a).toMatchObject({
      titre: 'Fil 1',
      phase: 'travail',
      metier: 'lire',
      depuis: Date.parse(IL_Y_A_2_MIN),
      collegue: { poste: 'claire.d', prenom: 'Claire' }
    })
  })
})

describe('le filtrage d’une donnée venue d’un autre poste', () => {
  it('écarte un agent sans identifiant ou à la phase inconnue, et les doublons', () => {
    const liste = agentsDesCollegues(
      presences({
        poste: 'bob',
        agents: [
          { id: '', phase: 'travail', metier: null, depuis: IL_Y_A_2_MIN },
          { id: 'conv-2', phase: 'danse', metier: null, depuis: IL_Y_A_2_MIN },
          { id: 'conv-3', phase: 'fini', metier: null, depuis: IL_Y_A_2_MIN },
          { id: 'conv-3', phase: 'travail', metier: null, depuis: IL_Y_A_2_MIN },
          { id: 'x'.repeat(200), phase: 'fini', metier: null, depuis: IL_Y_A_2_MIN }
        ]
      }),
      MAINTENANT
    )
    expect(liste.map((a) => a.collegue.idFil)).toEqual(['conv-3'])
  })

  it('ramène un métier inconnu à null et un titre absent à vide (fil privé)', () => {
    const [a] = agentsDesCollegues(
      presences({
        poste: 'bob',
        agents: [{ id: 'conv-1', phase: 'travail', metier: 'pirater', depuis: IL_Y_A_2_MIN }]
      }),
      MAINTENANT
    )
    expect(a.metier).toBeNull()
    expect(a.titre).toBe('')
  })

  it('borne le titre et retire les caractères invisibles', () => {
    const [a] = agentsDesCollegues(
      presences({
        poste: 'bob',
        agents: [
          {
            id: 'conv-1',
            titre: `a\u202eb${'c'.repeat(300)}`,
            phase: 'fini',
            metier: null,
            depuis: IL_Y_A_2_MIN
          }
        ]
      }),
      MAINTENANT
    )
    expect(a.titre.startsWith('abc')).toBe(true)
    expect(a.titre.length).toBeLessThanOrEqual(80)
  })

  it('ne donne jamais un « depuis » dans le futur ni illisible', () => {
    const liste = agentsDesCollegues(
      presences({
        poste: 'bob',
        agents: [
          { id: 'conv-1', phase: 'fini', metier: null, depuis: '2030-01-01T00:00:00.000Z' },
          { id: 'conv-2', phase: 'fini', metier: null, depuis: 'hier' }
        ]
      }),
      MAINTENANT
    )
    expect(liste.map((a) => a.depuis)).toEqual([MAINTENANT, MAINTENANT])
  })

  it('ignore une réponse abîmée sans lever', () => {
    expect(agentsDesCollegues(null, MAINTENANT)).toEqual([])
    expect(
      agentsDesCollegues({ collegues: 'non' } as unknown as PresencesDesCollegues, MAINTENANT)
    ).toEqual([])
    expect(
      agentsDesCollegues(
        { collegues: [null, { poste: 3 }] } as unknown as PresencesDesCollegues,
        MAINTENANT
      )
    ).toEqual([])
  })
})

describe('le plafond de quinze', () => {
  it('n’en garde jamais plus de quinze', () => {
    const liste = agentsDesCollegues(
      presences({ poste: 'a', agents: 12 }, { poste: 'b', agents: 12 }),
      MAINTENANT
    )
    expect(COLLEGUES_AGENTS_MAX).toBe(15)
    expect(liste).toHaveLength(15)
  })

  it('laisse sa place à chacun : un collègue chargé ne cache pas les autres', () => {
    const liste = agentsDesCollegues(
      presences({ poste: 'a', agents: 15 }, { poste: 'b', agents: 2 }, { poste: 'c', agents: 1 }),
      MAINTENANT
    )
    const parPoste = (p: string): number => liste.filter((x) => x.collegue.poste === p).length
    expect([parPoste('a'), parPoste('b'), parPoste('c')]).toEqual([12, 2, 1])
  })

  it('prend d’abord ceux qui travaillent', () => {
    const liste = agentsDesCollegues(
      presences({
        poste: 'a',
        agents: [
          { id: 'conv-1', phase: 'fini', metier: null, depuis: IL_Y_A_2_MIN },
          { id: 'conv-2', phase: 'travail', metier: 'lire', depuis: IL_Y_A_2_MIN }
        ]
      }),
      MAINTENANT
    )
    expect(liste.map((a) => a.collegue.idFil)).toEqual(['conv-2', 'conv-1'])
  })
})

describe('l’attente et le plantage restent discrets', () => {
  it('assied l’agent qui attend son humain au lieu de brandir la pancarte dorée', () => {
    const [a] = agentsDesCollegues(
      presences({
        poste: 'a',
        agents: [{ id: 'conv-1', phase: 'attente', metier: null, depuis: IL_Y_A_2_MIN }]
      }),
      MAINTENANT
    )
    expect(consigneDe(a, MAINTENANT).pose).toBe('at')
    expect(consigneDuCollegue(a, MAINTENANT)).toEqual({ metier: null, pose: 'as', partir: false })
  })

  it('envoie au travail aux mêmes lieux que les miens', () => {
    const [a] = agentsDesCollegues(presences({ poste: 'a', agents: 1 }), MAINTENANT)
    expect(consigneDuCollegue(a, MAINTENANT)).toEqual(consigneDe(a, MAINTENANT))
  })
})

describe('le bouton « Mes agents / Toute l’équipe »', () => {
  it('vaut « Toute l’équipe » par défaut et pour un contenu abîmé', () => {
    expect(modeLu(null)).toBe('equipe')
    expect(modeLu('nimporte')).toBe('equipe')
    expect(modeLu('moi')).toBe('moi')
    expect(lireModeVillage()).toBe('equipe')
  })

  it('masque tous les agents des collègues en « Mes agents »', () => {
    const liste = agentsDesCollegues(presences({ poste: 'a', agents: 3 }), MAINTENANT)
    expect(selonLeMode('moi', liste)).toEqual([])
    expect(selonLeMode('equipe', liste)).toBe(liste)
  })

  it('retient le choix et l’applique à la liste affichée', () => {
    poserAgentsCollegues(agentsDesCollegues(presences({ poste: 'a', agents: 2 }), MAINTENANT))
    expect(lireAgentsCollegues()).toHaveLength(2)
    choisirModeVillage('moi')
    expect(window.localStorage.getItem(CLE_MODE_VILLAGE)).toBe('moi')
    expect(lireAgentsCollegues()).toHaveLength(0)
    expect(agentCollegue(idCollegue('a', 'conv-1'))).toBeNull()
    choisirModeVillage('equipe')
    expect(agentCollegue(idCollegue('a', 'conv-1'))?.collegue.poste).toBe('a')
  })
})
