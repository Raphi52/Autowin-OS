import { describe, expect, it } from 'vitest'
import {
  agentsEnScene,
  AGENTS_MAX,
  appliquerEvenement,
  appliquerResumes,
  PAUSE_APRES_MS,
  consigneDe,
  poseDePlantage,
  REPOS_MS,
  RETARD_RESUMES_MS,
  SIGNAL_MAX_MS,
  type AgentQuartier
} from './agents-quartier'

const T0 = 1_000_000_000_000
const vide = new Map<string, AgentQuartier>()

describe('appliquerResumes', () => {
  it('donne un personnage à un fil dont un tour tourne', () => {
    const carte = appliquerResumes(vide, [{ id: 'a', title: 'Fil A', hasStreamingTurn: true }], T0)
    expect(carte.get('a')).toMatchObject({ titre: 'Fil A', phase: 'reflexion', metier: null })
  })

  it('ne dessine pas les fils au repos depuis longtemps', () => {
    const carte = appliquerResumes(
      vide,
      [{ id: 'a', lastAssistantStatus: 'completed', updatedAt: T0 - REPOS_MS - 1 }],
      T0
    )
    expect(carte.size).toBe(0)
  })

  it('garde 15 minutes au repos un fil qui vient de finir, puis le laisse partir (D-4)', () => {
    const r = { id: 'a', lastAssistantStatus: 'completed', updatedAt: T0 - 1000 }
    expect(appliquerResumes(vide, [r], T0).get('a')?.phase).toBe('fini')
    expect(appliquerResumes(vide, [r], T0 + REPOS_MS).has('a')).toBe(false)
  })

  it('garde l’or d’une question et le rouge d’un échec, sans limite de 15 minutes (D7)', () => {
    const q = { id: 'q', lastAssistantAsksUser: true, updatedAt: T0 - REPOS_MS * 3 }
    const e = { id: 'e', lastAssistantStatus: 'failed', updatedAt: T0 - REPOS_MS * 3 }
    const carte = appliquerResumes(vide, [q, e], T0)
    expect(carte.get('q')?.phase).toBe('attente')
    expect(carte.get('e')?.phase).toBe('plante')
  })

  it('oublie une vieille question plutôt que d’encombrer la scène pour toujours', () => {
    const q = { id: 'q', lastAssistantAsksUser: true, updatedAt: T0 - SIGNAL_MAX_MS - 1 }
    expect(appliquerResumes(vide, [q], T0).size).toBe(0)
  })

  it('libère le personnage dès que l’utilisateur a ouvert le fil (D9)', () => {
    const r = { id: 'a', lastAssistantStatus: 'failed', updatedAt: T0 - 1000 }
    expect(appliquerResumes(vide, [r], T0, new Map([['a', T0 - 500]])).size).toBe(0)
  })

  it('remet au travail le même personnage quand le fil repart (D9)', () => {
    const fini = appliquerResumes(
      vide,
      [{ id: 'a', lastAssistantStatus: 'completed', updatedAt: T0 - 1000 }],
      T0
    )
    const repart = appliquerResumes(fini, [{ id: 'a', hasStreamingTurn: true }], T0 + 1000)
    expect(repart.get('a')?.phase).toBe('reflexion')
  })

  it('ne chasse pas un agent qui démarre à cause d’un résumé en retard', () => {
    const c = appliquerEvenement(
      vide,
      { kind: 'command', conversationId: 'a', actionId: '1', name: 'Read' },
      T0
    )
    const retard = appliquerResumes(
      c,
      [{ id: 'a', title: 'A', lastAssistantStatus: 'completed', updatedAt: T0 - 1e7 }],
      T0 + 2000
    )
    expect(retard.get('a')).toMatchObject({ phase: 'travail', metier: 'lire', titre: 'A' })
    expect(
      appliquerResumes(
        c,
        [{ id: 'a', lastAssistantStatus: 'completed', updatedAt: T0 - 1e7 }],
        T0 + RETARD_RESUMES_MS + 1
      ).size
    ).toBe(0)
  })

  it('ignore un fil mis de côté', () => {
    expect(
      appliquerResumes(vide, [{ id: 'a', hasStreamingTurn: true, inactive: true }], T0).size
    ).toBe(0)
  })
})

describe('appliquerEvenement', () => {
  it('envoie l’agent au métier de l’outil réel', () => {
    const carte = appliquerEvenement(
      vide,
      { kind: 'command', conversationId: 'a', actionId: '1', name: 'Read' },
      T0
    )
    expect(carte.get('a')).toMatchObject({ phase: 'travail', metier: 'lire', actions: ['1'] })
  })

  it('le laisse réfléchir à son poste quand l’outil rend la main (D14)', () => {
    const c1 = appliquerEvenement(
      vide,
      { kind: 'command', conversationId: 'a', actionId: '1', name: 'Edit' },
      T0
    )
    const c2 = appliquerEvenement(
      c1,
      { kind: 'result', conversationId: 'a', actionId: '1' },
      T0 + 500
    )
    expect(c2.get('a')).toMatchObject({ phase: 'reflexion', metier: 'modifier' })
  })

  it('reste au travail tant qu’une action en parallèle est ouverte', () => {
    let c = appliquerEvenement(
      vide,
      { kind: 'command', conversationId: 'a', actionId: '1', name: 'Read' },
      T0
    )
    c = appliquerEvenement(
      c,
      { kind: 'command', conversationId: 'a', actionId: '2', name: 'Read' },
      T0
    )
    c = appliquerEvenement(c, { kind: 'result', conversationId: 'a', actionId: '1' }, T0)
    expect(c.get('a')?.phase).toBe('travail')
  })

  it('ne déplace personne pour une liste de tâches', () => {
    const c1 = appliquerEvenement(
      vide,
      { kind: 'command', conversationId: 'a', actionId: '1', name: 'Read' },
      T0
    )
    const c2 = appliquerEvenement(
      c1,
      { kind: 'command', conversationId: 'a', actionId: '2', name: 'TaskUpdate' },
      T0
    )
    expect(c2.get('a')?.metier).toBe('lire')
  })

  it('marque l’échec et la fin du tour', () => {
    expect(
      appliquerEvenement(vide, { kind: 'error', conversationId: 'a' }, T0).get('a')?.phase
    ).toBe('plante')
    expect(
      appliquerEvenement(vide, { kind: 'done', conversationId: 'a' }, T0).get('a')?.phase
    ).toBe('fini')
  })

  it('relève un agent au repos dès que le fil repart', () => {
    const fini = appliquerEvenement(vide, { kind: 'done', conversationId: 'a' }, T0)
    expect(
      appliquerEvenement(fini, { kind: 'delta', conversationId: 'a' }, T0 + 1).get('a')?.phase
    ).toBe('reflexion')
  })

  it('ignore un événement sans fil', () => {
    expect(appliquerEvenement(vide, { kind: 'delta' }, T0).size).toBe(0)
  })
})

describe('consigneDe', () => {
  const agent = (
    phase: AgentQuartier['phase'],
    metier: AgentQuartier['metier']
  ): AgentQuartier => ({
    id: 'a',
    titre: '',
    phase,
    metier,
    actions: [],
    depuis: T0
  })

  it('un agent planté garde la même pose, et les trois sortent sur un échantillon', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `fil-${i}`)
    const poses = ids.map((id) => poseDePlantage(id))
    expect(ids.map((id) => poseDePlantage(id))).toEqual(poses)
    expect(new Set(poses)).toEqual(new Set(['pr', 'fu', 'bi']))
    const a = { ...agent('plante', null), id: 'fil-7' }
    expect(consigneDe(a, T0).pose).toBe(consigneDe(a, T0 + 60_000).pose)
    expect(consigneDe(a, T0).pose).toBe(poseDePlantage('fil-7'))
  })

  it("aucune autre phase n'emprunte une pose de plantage", () => {
    for (const phase of ['travail', 'reflexion', 'attente', 'fini'] as const) {
      expect(['pr', 'fu', 'bi']).not.toContain(consigneDe(agent(phase, 'lire'), T0).pose)
    }
  })

  it('traduit chaque phase en pose', () => {
    expect(consigneDe(agent('travail', 'lire'), T0)).toEqual({
      metier: 'lire',
      pose: '',
      partir: false
    })
    expect(consigneDe(agent('attente', 'lire'), T0).pose).toBe('at')
    expect(['pr', 'fu', 'bi']).toContain(consigneDe(agent('plante', null), T0).pose)
    expect(consigneDe(agent('fini', 'lire'), T0)).toEqual({
      metier: 'bain',
      pose: 'ba',
      partir: false
    })
  })

  it('ne l’envoie en pause qu’après quelques secondes de réflexion', () => {
    expect(consigneDe(agent('reflexion', 'lire'), T0 + 1000)).toEqual({
      metier: 'lire',
      pose: '',
      partir: false
    })
    expect(consigneDe(agent('reflexion', 'lire'), T0 + PAUSE_APRES_MS + 1)).toEqual({
      metier: 'pause',
      pose: '',
      partir: false
    })
  })

  it('y envoie aussi celui qui n’a encore rien fait', () => {
    expect(consigneDe(agent('reflexion', null), T0 + PAUSE_APRES_MS + 1).metier).toBe('pause')
  })
})

describe('agentsEnScene', () => {
  it('garde en priorité ceux qui appellent l’utilisateur, dans la limite de la scène', () => {
    const carte = new Map<string, AgentQuartier>()
    for (let i = 0; i < AGENTS_MAX + 4; i++)
      carte.set(`t${i}`, {
        id: `t${i}`,
        titre: '',
        phase: 'travail',
        metier: 'lire',
        actions: [],
        depuis: T0 + i
      })
    carte.set('q', {
      id: 'q',
      titre: '',
      phase: 'attente',
      metier: null,
      actions: [],
      depuis: T0 + 99
    })
    const scene = agentsEnScene(carte)
    expect(scene).toHaveLength(AGENTS_MAX)
    expect(scene[0].id).toBe('q')
  })
})
