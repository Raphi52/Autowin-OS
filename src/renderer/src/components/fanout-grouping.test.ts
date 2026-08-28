import { describe, it, expect } from 'vitest'
import {
  groupSubagentSteps,
  costByModel,
  parseBtw,
  matchSlashCommands,
  type OrchStep, skillSlashCommands} from './chat-view-model'

describe('matchSlashCommands (palette /)', () => {
  it("« / » seul : commandes intégrées PUIS skills de l’inventaire", () => {
    // La liste n'est plus figée dans le renderer : `/` rend ce que le composer lui passe. Une skill
    // ajoutée sur le disque apparaît donc seule, sans qu'on touche à ce fichier — c'était le défaut.
    const skills = skillSlashCommands([
      { id: 'scout', description: 'Chercher.', enabled: true },
      { id: 'think', description: 'Charger le contexte.', enabled: true }
    ])
    expect(matchSlashCommands('/', skills).map((c) => c.name)).toEqual(['scout', 'think'])
    // Sans inventaire, seules les commandes câblées dans l'interface subsistent.
    expect(matchSlashCommands('/').map((c) => c.name)).toEqual([])
  })
  it('filtre par préfixe (casse-insensible)', () => {
    const skills = skillSlashCommands([{ id: 'build', description: 'Implémenter.', enabled: true }])
    expect(matchSlashCommands('/b', skills).map((c) => c.name)).toEqual(['build'])
    expect(matchSlashCommands('/BT', skills).map((c) => c.name)).toEqual([])
  })
  it('préfixe sans correspondance → []', () => {
    expect(matchSlashCommands('/zzz')).toEqual([])
  })
  it('filtre les skills par préfixe et insère un espace pour la consigne', () => {
    // Les skills ne sont plus écrites à la main dans le renderer : elles viennent de l'inventaire
    // disque, passé ici tel que le composer le fournit.
    const skills = skillSlashCommands([
      { id: 'scout', description: 'Chercher.', enabled: true },
      { id: 'judge', description: 'Auditer.', enabled: true },
      { id: 'kaizen', description: 'Rétro.', enabled: true }
    ])
    expect(matchSlashCommands('/sc', skills)).toEqual([
      expect.objectContaining({ name: 'scout', insert: '/scout ' })
    ])
    expect(matchSlashCommands('/j', skills).map((c) => c.name)).toEqual(['judge'])
    expect(matchSlashCommands('/k', skills).map((c) => c.name)).toEqual(['kaizen'])
  })
  it('corps déjà tapé (/btw x) → palette fermée []', () => {
    expect(matchSlashCommands('/btw x')).toEqual([])
  })
  it('texte normal (pas de /) → []', () => {
    expect(matchSlashCommands('bonjour')).toEqual([])
    expect(matchSlashCommands('au fait /btw')).toEqual([])
  })
})

describe('parseBtw', () => {
  it('détecte /btw en préfixe + extrait le corps', () => {
    expect(parseBtw('/btw pense aussi aux tests')).toEqual({
      isBtw: true,
      body: 'pense aussi aux tests'
    })
  })
  it('insensible à la casse + espaces/tab avant le corps', () => {
    expect(parseBtw('  /BTW\t oriente ainsi').isBtw).toBe(true)
    expect(parseBtw('  /BTW\t oriente ainsi').body).toBe('oriente ainsi')
  })
  it('/btw seul → isBtw avec corps vide (no-op côté UI)', () => {
    expect(parseBtw('/btw')).toEqual({ isBtw: true, body: '' })
  })
  it('corps multi-ligne conservé', () => {
    expect(parseBtw('/btw ligne1\nligne2').body).toBe('ligne1\nligne2')
  })
  it('/btwfoo (pas de frontière) N’EST PAS une commande', () => {
    expect(parseBtw('/btwfoo').isBtw).toBe(false)
  })
  it('un message normal (ou /btw en milieu) n’est pas capté', () => {
    expect(parseBtw('message normal').isBtw).toBe(false)
    expect(parseBtw('au fait /btw non').isBtw).toBe(false)
  })
})

const member = (phase: string, model: string, role = 'subagent'): OrchStep => ({
  step: role === 'judge' ? 'judge' : 'exec',
  role,
  model,
  detail: role === 'judge' ? 'vote: VALIDE' : `phase ${phase} · modèle ${model}`
})

describe('groupSubagentSteps', () => {
  it('≥2 membres consécutifs d’une même phase → un groupe fan-out', () => {
    const g = groupSubagentSteps([member('frame', 'opus'), member('frame', 'codex')])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('fanout')
    if (g[0].kind === 'fanout') expect(g[0].steps).toHaveLength(2)
  })

  it('un step mono (sans model) reste seul', () => {
    const g = groupSubagentSteps([
      { step: 'exec', role: 'subagent', detail: 'phase build', text: 'ok' }
    ])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('single')
  })

  it('un seul membre (run de 1) → single, pas de grille', () => {
    expect(groupSubagentSteps([member('frame', 'opus')])[0].kind).toBe('single')
  })

  it('la synthèse (rôle orchestrateur) sépare deux phases fan-outées', () => {
    const synth: OrchStep = {
      step: 'exec',
      role: 'orchestrator',
      model: 'orch',
      detail: 'synthèse frame (2 modèles)'
    }
    const g = groupSubagentSteps([
      member('frame', 'opus'),
      member('frame', 'codex'),
      synth,
      member('scout', 'opus'),
      member('scout', 'codex')
    ])
    // frame(fanout) + synthèse(single) + scout(fanout)
    expect(g.map((x) => x.kind)).toEqual(['fanout', 'single', 'fanout'])
  })

  it('N juges consécutifs → groupe fan-out juge', () => {
    const g = groupSubagentSteps([
      member('', 'j1', 'judge'),
      member('', 'j2', 'judge'),
      member('', 'j3', 'judge')
    ])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('fanout')
    if (g[0].kind === 'fanout') expect(g[0].steps).toHaveLength(3)
  })

  it('un gate/step sans model n’est jamais groupé (rétrocompat)', () => {
    const g = groupSubagentSteps([{ step: 'gate', detail: 'clôture autorisée' }])
    expect(g[0].kind).toBe('single')
  })
})

describe('costByModel', () => {
  it('somme le coût + compte les appels par modèle, trié coût décroissant', () => {
    const r = costByModel([
      { step: 'exec', model: 'opus', costUsd: 0.04 },
      { step: 'exec', model: 'codex', costUsd: 0.05 },
      { step: 'exec', model: 'opus', costUsd: 0.03 }
    ])
    // opus = 0.07 (2 appels) > codex = 0.05 (1) → opus en premier. Aucun step ne porte de tokens ici,
    // donc le tri retombe sur le coût : l'ordre historique est préservé.
    expect(r.map((m) => m.model)).toEqual(['opus', 'codex'])
    expect(r[0]).toEqual({
      model: 'opus',
      costUsd: expect.closeTo(0.07, 5),
      count: 2,
      unpricedTokens: 0,
      unpricedCalls: 0
    })
    expect(r[1]).toEqual({
      model: 'codex',
      costUsd: 0.05,
      count: 1,
      unpricedTokens: 0,
      unpricedCalls: 0
    })
  })
  it('ignore les steps sans model', () => {
    const r = costByModel([
      { step: 'gate', costUsd: 1 },
      { step: 'exec', model: 'm', costUsd: 0.1 }
    ])
    expect(r).toEqual([{ model: 'm', costUsd: 0.1, count: 1, unpricedTokens: 0, unpricedCalls: 0 }])
  })
  it("coût absent → 0, et l'appel est compté comme NON CHIFFRÉ", () => {
    // Un coût absent n'est pas un coût nul : le distinguer est tout l'objet du champ `unpricedCalls`.
    expect(costByModel([{ step: 'exec', model: 'm' }])).toEqual([
      { model: 'm', costUsd: 0, count: 1, unpricedTokens: 0, unpricedCalls: 1 }
    ])
  })
})
