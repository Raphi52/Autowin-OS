import { describe, expect, it } from 'vitest'
import {
  composerContexte,
  lireReponseContexte,
  libelleCategorie,
  tokensCourts
} from './contexte-detaille'

/** Reponse reelle du CLI 2.1.301 (sonde du 2026-10-16), allegee de `gridRows`. */
const REPONSE_CLI = {
  categories: [
    { name: 'System prompt', tokens: 34783, color: 'promptBorder', kind: 'used' },
    { name: 'System tools', tokens: 20203, color: 'inactive', kind: 'used' },
    { name: 'System tools (deferred)', tokens: 10626, isDeferred: true, kind: 'deferred' },
    { name: 'MCP tools', tokens: 14400, kind: 'used' },
    { name: 'Memory files', tokens: 1952, color: 'claude', kind: 'used' },
    { name: 'Messages', tokens: 10, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
    { name: 'Free space', tokens: 950111, kind: 'free' }
  ],
  totalTokens: 71348,
  maxTokens: 1000000,
  model: 'claude-opus-5-5',
  memoryFiles: [
    {
      path: 'C:\\Users\\x\\.claude\\projects\\D--AutoWinOS\\memory\\MEMORY.md',
      type: 'AutoMem',
      tokens: 1952
    }
  ],
  mcpTools: [
    { name: 'mcp__autowin__get_state', serverName: 'autowin', tokens: 148, isLoaded: true },
    { name: 'mcp__autowin__orchestrate', serverName: 'autowin', tokens: 1100, isLoaded: true },
    { name: 'illisible', serverName: 'autowin' }
  ],
  skills: {
    totalSkills: 2,
    skillFrontmatter: [
      { name: 'loop', source: 'built-in', tokens: 115 },
      { name: 'dataviz', source: 'built-in', tokens: 482 }
    ]
  }
}

describe('lireReponseContexte', () => {
  it('garde la partie FIXE et ecarte ce que la sonde ne peut pas mesurer juste', () => {
    const s = lireReponseContexte(REPONSE_CLI, 42)!
    // Messages et Espace libre se recalculent : la sonde tourne AVANT les messages du tour.
    expect(s.categories.map((c) => c.nom)).toEqual([
      'System prompt',
      'System tools',
      'System tools (deferred)',
      'MCP tools',
      'Memory files'
    ])
    expect(s.categories.find((c) => c.nom === 'System tools (deferred)')?.differe).toBe(true)
    expect(s.reserve).toBe(33000)
    expect(s.max).toBe(1_000_000)
    expect(s.modele).toBe('claude-opus-5-5')
    expect(s.mesureLe).toBe(42)
  })

  it('nomme les outils MCP « serveur · outil », du plus lourd au plus leger, sans entree illisible', () => {
    const s = lireReponseContexte(REPONSE_CLI, 0)!
    expect(s.outilsMcp).toEqual([
      { nom: 'autowin · orchestrate', tokens: 1100 },
      { nom: 'autowin · get_state', tokens: 148 }
    ])
    expect(s.skills.map((k) => k.nom)).toEqual(['dataviz', 'loop'])
    expect(s.fichiersMemoire[0]?.tokens).toBe(1952)
  })

  it('rend undefined sur une reponse sans fenetre ni categories', () => {
    expect(lireReponseContexte({ categories: [] }, 0)).toBeUndefined()
    expect(lireReponseContexte({ maxTokens: 1000 }, 0)).toBeUndefined()
    expect(lireReponseContexte(null, 0)).toBeUndefined()
  })
})

describe('composerContexte', () => {
  const statique = lireReponseContexte(REPONSE_CLI, 0)!
  const fixe = 34783 + 20203 + 14400 + 1952

  it('deduit les Messages de l occupation REELLE, et le total reste celui de la jauge', () => {
    const d = composerContexte(statique, 93_900, 1_000_000)
    const messages = d.categories.find((c) => c.cle === 'messages')!
    expect(messages.tokens).toBe(93_900 - fixe)
    expect(d.utilise).toBe(93_900)
    const libre = d.categories.find((c) => c.cle === 'free-space')!
    expect(libre.tokens).toBe(1_000_000 - 93_900 - 33_000)
    // La somme des categories utilisees retombe exactement sur l occupation.
    const somme = d.categories
      .filter((c) => c.genre === 'utilise')
      .reduce((s, c) => s + c.tokens, 0)
    expect(somme).toBe(93_900)
  })

  it('ordonne : utilisees par poids, puis reserve, espace libre, et les differes en dernier', () => {
    const d = composerContexte(statique, 93_900, 1_000_000)
    expect(d.categories.map((c) => c.genre)).toEqual([
      'utilise',
      'utilise',
      'utilise',
      'utilise',
      'utilise',
      'reserve',
      'libre',
      'differe'
    ])
    expect(d.categories[0]?.libelle).toBe('Prompt système')
  })

  it('ne rend jamais de Messages negatifs quand la partie fixe depasse la jauge', () => {
    const d = composerContexte(statique, 10_000, 1_000_000)
    expect(d.categories.find((c) => c.cle === 'messages')?.tokens).toBe(0)
    expect(d.utilise).toBe(fixe)
  })
})

describe('affichage', () => {
  it('traduit les categories du CLI et garde un nom inconnu tel quel', () => {
    expect(libelleCategorie('MCP tools (deferred)')).toBe('Outils MCP (différés)')
    expect(libelleCategorie('Free space')).toBe('Espace libre')
    expect(libelleCategorie('Nouvelle catégorie')).toBe('Nouvelle catégorie')
  })

  it('ecrit les tokens comme claude.exe', () => {
    expect(tokensCourts(733)).toBe('733')
    expect(tokensCourts(93_900)).toBe('93.9k')
    expect(tokensCourts(1_000_000)).toBe('1M')
    expect(tokensCourts(24_700)).toBe('24.7k')
  })
})
