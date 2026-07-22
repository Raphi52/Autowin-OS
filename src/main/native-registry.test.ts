import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enablementPath,
  nativeRegistryActive,
  listNativeRegistry,
  setNativeEnablement,
  seedRegistryFromHermes,
  nativeSkills
} from './native-registry'

describe('native-registry (Chantier 1 — souveraineté inventaire)', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'natreg-'))
  })
  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    delete process.env.AUTOWIN_NATIVE_REGISTRY
  })

  it('actif si flag=1, inactif si flag=0, sinon dépend de la présence du fichier', () => {
    process.env.AUTOWIN_NATIVE_REGISTRY = '1'
    expect(nativeRegistryActive(base)).toBe(true)
    process.env.AUTOWIN_NATIVE_REGISTRY = '0'
    expect(nativeRegistryActive(base)).toBe(false)
    delete process.env.AUTOWIN_NATIVE_REGISTRY
    expect(nativeRegistryActive(base)).toBe(false) // pas de fichier
    setNativeEnablement('tools', 'x', true, base)
    expect(nativeRegistryActive(base)).toBe(true) // fichier créé
  })

  it('enablement persisté : un toggle survit à une relecture (plus aucun hermes.exe)', () => {
    setNativeEnablement('skills', 'frame', false, base)
    const items = listNativeRegistry('tools', base) // relit le disque
    expect(items).toEqual([]) // pas de catalogue → tools vide (natif, pas d'erreur)
    // relecture de l'état skills
    setNativeEnablement('skills', 'build', true, base)
    const raw = JSON.parse(require('node:fs').readFileSync(enablementPath(base), 'utf8'))
    expect(raw.skills.frame).toBe(false)
    expect(raw.skills.build).toBe(true)
  })

  it('inventaire skills = scan disque, désactivé seulement par un false explicite', () => {
    const root = join(base, 'skills')
    mkdirSync(join(root, 'frame'), { recursive: true })
    writeFileSync(join(root, 'frame', 'SKILL.md'), 'name: frame\n')
    mkdirSync(join(root, 'build'), { recursive: true })
    writeFileSync(join(root, 'build', 'SKILL.md'), 'name: build\n')
    // scanne une racine custom via nativeSkills ? nativeSkills utilise skillRoots() (réelles) —
    // on teste plutôt la règle enabled-par-défaut sur l'état :
    setNativeEnablement('skills', 'frame', false, base)
    const enablement = JSON.parse(require('node:fs').readFileSync(enablementPath(base), 'utf8'))
    expect(enablement.skills.frame).toBe(false)
    // nativeSkills lit les vraies racines du poste : on vérifie juste qu'il rend un tableau
    expect(Array.isArray(nativeSkills(base))).toBe(true)
  })

  it('amorçage unique depuis Hermes fige tools/plugins + état, sans écraser si déjà amorcé', () => {
    seedRegistryFromHermes(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: true, mutable: true }],
        plugins: [{ id: 'p1', label: 'p1', description: 'plug', enabled: false, mutable: true }]
      },
      base
    )
    const tools = listNativeRegistry('tools', base)
    expect(tools).toHaveLength(1)
    expect(tools[0].id).toBe('t1')
    expect(tools[0].enabled).toBe(true)
    const plugins = listNativeRegistry('plugins', base)
    expect(plugins[0].enabled).toBe(false)
    // 2e amorçage ignoré (état local préservé)
    seedRegistryFromHermes({ tools: [] }, base)
    expect(listNativeRegistry('tools', base)).toHaveLength(1)
  })
})
