import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_VISIBILITY_SETTINGS,
  GRAPH_VISIBILITY_SETTINGS_SUFFIX,
  loadGraphVisibilitySettings,
  saveGraphVisibilitySettings,
  loadMemoryDetailWidths,
  saveMemoryDetailWidths,
  MEMORY_DETAIL_WIDTHS_SUFFIX
} from './graph-settings'
import { autowinStorageKey, legacyStorageKey } from '../../../shared/app-identity'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('réglages Memory persistants', () => {
  it('sauvegarde et restaure chacun des neuf réglages', () => {
    const storage = new MemoryStorage()
    const expected = {
      labels: false,
      links: false,
      orphans: false,
      arrows: true,
      contextOpacity: 0.41,
      nodeSize: 2.2,
      linkWidth: 1.3,
      nodeSpacing: 174,
      lod: 4200
    }
    saveGraphVisibilitySettings(storage, expected)
    expect(loadGraphVisibilitySettings(storage)).toEqual(expected)
  })

  it('ignore une valeur corrompue et migre l’ancienne clé d’espacement', () => {
    const storage = new MemoryStorage()
    storage.setItem(autowinStorageKey(GRAPH_VISIBILITY_SETTINGS_SUFFIX), '{invalide')
    storage.setItem(legacyStorageKey('graph.node-spacing.v1'), '198')
    expect(loadGraphVisibilitySettings(storage)).toEqual({
      ...DEFAULT_GRAPH_VISIBILITY_SETTINGS,
      nodeSpacing: 198
    })
  })

  it('mémorise DEUX largeurs détail indépendantes (thème / nœud) sans conflit', () => {
    const storage = new MemoryStorage()
    // Deux slots distincts persistés + relus tels quels.
    saveMemoryDetailWidths(storage, { theme: 280, node: 900 })
    expect(loadMemoryDetailWidths(storage)).toEqual({ theme: 280, node: 900 })
    // Écrire un slot ne touche pas l'autre.
    saveMemoryDetailWidths(storage, { ...loadMemoryDetailWidths(storage), node: 1200 })
    expect(loadMemoryDetailWidths(storage)).toEqual({ theme: 280, node: 1200 })
  })

  it('largeurs détail : défaut null + rejet hors-bornes, sans crash', () => {
    const storage = new MemoryStorage()
    expect(loadMemoryDetailWidths(storage)).toEqual({ theme: null, node: null })
    storage.setItem(
      autowinStorageKey(MEMORY_DETAIL_WIDTHS_SUFFIX),
      JSON.stringify({ theme: 5, node: 99_999 }) // < min et > max → null
    )
    expect(loadMemoryDetailWidths(storage)).toEqual({ theme: null, node: null })
    storage.setItem(autowinStorageKey(MEMORY_DETAIL_WIDTHS_SUFFIX), '{corrompu')
    expect(loadMemoryDetailWidths(storage)).toEqual({ theme: null, node: null })
  })

  it('rejette les types et valeurs hors limites sans perdre les valeurs valides', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      autowinStorageKey(GRAPH_VISIBILITY_SETTINGS_SUFFIX),
      JSON.stringify({ labels: 'non', links: false, lod: 99_999, nodeSize: -4 })
    )
    expect(loadGraphVisibilitySettings(storage)).toEqual({
      ...DEFAULT_GRAPH_VISIBILITY_SETTINGS,
      links: false
    })
  })
})
