import { describe, expect, it } from 'vitest'
import { libraryModels } from './model-library'

/**
 * Le cas RÉEL signalé le 2026-08-06 : le catalogue Claude contient à la fois les ALIAS du CLI
 * (`claude/opus`, dont `claudeAliasModels` recopie le label du modèle concret le plus récent) et
 * les versions concrètes. Routage listait les deux, donc « Claude Opus 5 · CLI » deux fois.
 */
const CATALOG = [
  // alias du CLI : label recopié du concret le plus récent, PAS de dynamicallyLoaded
  { id: 'claude/opus', provider: 'claude', model: 'opus', label: 'Claude Opus 5 · CLI' },
  { id: 'claude/sonnet', provider: 'claude', model: 'sonnet', label: 'Claude Sonnet 5 · CLI' },
  // versions concrètes découvertes dynamiquement
  {
    id: 'claude/claude-opus-5',
    provider: 'claude',
    model: 'claude-opus-5',
    label: 'Claude Opus 5 · CLI',
    dynamicallyLoaded: true
  },
  {
    id: 'claude/claude-opus-4-8',
    provider: 'claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8 · CLI',
    dynamicallyLoaded: true
  },
  {
    id: 'claude/claude-sonnet-5',
    provider: 'claude',
    model: 'claude-sonnet-5',
    label: 'Claude Sonnet 5 · CLI',
    dynamicallyLoaded: true
  },
  // constante statique : jamais de dynamicallyLoaded
  { id: 'kimi/kimi-for-coding', provider: 'kimi', model: 'kimi-for-coding', label: 'Kimi' }
]

describe('libraryModels', () => {
  it('ne rend aucun nom affiché en double', () => {
    const names = libraryModels(CATALOG).map((model) => model.label)
    expect(names).toEqual([...new Set(names)])
  })

  it('écarte les pointeurs alias et garde la version concrète', () => {
    const ids = libraryModels(CATALOG).map((model) => model.id)
    expect(ids).not.toContain('claude/opus')
    expect(ids).not.toContain('claude/sonnet')
    expect(ids).toContain('claude/claude-opus-5')
  })

  it('trie par nom affiché', () => {
    expect(libraryModels(CATALOG).map((model) => model.label)).toEqual([
      'Claude Opus 4.8 · CLI',
      'Claude Opus 5 · CLI',
      'Claude Sonnet 5 · CLI'
    ])
  })

  it('écarte aussi les modèles statiques — conséquence assumée du choix de définition', () => {
    // Documente le compromis retenu plutôt que de le laisser surgir comme une surprise :
    // kimi/gemini ne sont dans AUCUNE liste de modèles. Leur carte provider, elle, subsiste
    // (voir RouterView : `providers` part du catalogue complet, pas de cette liste).
    expect(libraryModels(CATALOG).map((model) => model.provider)).not.toContain('kimi')
  })

  it('ne modifie pas le tableau reçu', () => {
    const input = [...CATALOG]
    libraryModels(input)
    expect(input).toEqual(CATALOG)
  })
})
