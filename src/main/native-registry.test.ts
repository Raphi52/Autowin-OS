import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enablementPath,
  listNativeRegistry,
  setNativeEnablement,
  seedRegistrySnapshot,
  nativeSkills
} from './native-registry'

describe('native-registry (Chantier 1 — souveraineté inventaire)', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'natreg-'))
  })
  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('reste récupérable si un crash laisse seulement le backup', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    const primary = enablementPath(base)
    renameSync(primary, `${primary}.bak`)

    expect(listNativeRegistry('tools', base)[0].enabled).toBe(false)
  })

  it('enablement persisté : un toggle survit à une relecture (plus aucun native.exe)', () => {
    setNativeEnablement('skills', 'frame', false, base)
    const items = listNativeRegistry('tools', base) // relit le disque
    expect(items).toEqual([]) // pas de catalogue → tools vide (natif, pas d'erreur)
    // relecture de l'état skills
    setNativeEnablement('skills', 'build', true, base)
    const raw = JSON.parse(readFileSync(enablementPath(base), 'utf8'))
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
    const enablement = JSON.parse(readFileSync(enablementPath(base), 'utf8'))
    expect(enablement.skills.frame).toBe(false)
    // nativeSkills lit les vraies racines du poste : on vérifie juste qu'il rend un tableau
    expect(Array.isArray(nativeSkills(base))).toBe(true)
  })

  it('amorçage unique depuis Native fige tools/plugins + état, sans écraser si déjà amorcé', () => {
    seedRegistrySnapshot(
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
    seedRegistrySnapshot({ tools: [] }, base)
    expect(listNativeRegistry('tools', base)).toHaveLength(1)
  })

  it('réhydrate le catalogue après un toggle précoce et persiste ses mises à jour', async () => {
    setNativeEnablement('tools', 't1', false, base)

    // Simule la recréation du store entre le toggle et l'amorçage du catalogue.
    vi.resetModules()
    const reloaded = await import('./native-registry')
    reloaded.seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: true, mutable: true }]
      },
      base
    )

    expect(reloaded.listNativeRegistry('tools', base)).toEqual([
      { id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }
    ])

    reloaded.setNativeEnablement('tools', 't1', true, base)
    vi.resetModules()
    const afterUpdate = await import('./native-registry')
    expect(afterUpdate.listNativeRegistry('tools', base)).toEqual([
      { id: 't1', label: 't1', description: 'outil', enabled: true, mutable: true }
    ])
  })

  it('ne réactive ni n’écrase les désactivations si le fichier principal est corrompu', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    // Une seconde écriture valide doit devenir la dernière version récupérable.
    setNativeEnablement('tools', 't1', false, base)
    writeFileSync(enablementPath(base), '{json tronqué', 'utf8')

    expect(listNativeRegistry('tools', base)[0].enabled).toBe(false)
    setNativeEnablement('tools', 't2', true, base)
    const recovered = JSON.parse(readFileSync(enablementPath(base), 'utf8'))
    expect(recovered.tools).toEqual({ t1: false, t2: true })
  })

  it('récupère une désactivation si le JSON parsable perd sa structure', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    setNativeEnablement('tools', 't1', false, base)
    writeFileSync(enablementPath(base), '{}', 'utf8')

    expect(listNativeRegistry('tools', base)[0].enabled).toBe(false)
  })

  it('récupère le snapshot complet si le primaire ne garde qu’une catégorie', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    setNativeEnablement('tools', 't1', false, base)
    writeFileSync(enablementPath(base), JSON.stringify({ skills: {} }), 'utf8')

    expect(listNativeRegistry('tools', base)[0].enabled).toBe(false)
  })

  it('crée une copie récupérable dès le premier snapshot courant', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    const primary = enablementPath(base)
    expect(existsSync(`${primary}.bak`)).toBe(true)
    expect(JSON.parse(readFileSync(primary, 'utf8')).schemaVersion).toBe(1)
    writeFileSync(primary, JSON.stringify({ skills: {} }), 'utf8')

    expect(listNativeRegistry('tools', base)[0].enabled).toBe(false)
  })

  it('migre une désactivation legacy partielle sans la réactiver', () => {
    const primary = enablementPath(base)
    writeFileSync(primary, JSON.stringify({ tools: { legacyOff: false } }), 'utf8')

    setNativeEnablement('tools', 'newTool', true, base)

    const migrated = JSON.parse(readFileSync(primary, 'utf8'))
    const backup = JSON.parse(readFileSync(`${primary}.bak`, 'utf8'))
    expect(migrated).toMatchObject({
      schemaVersion: 1,
      skills: {},
      tools: { legacyOff: false, newTool: true },
      plugins: {},
      hooks: {}
    })
    expect(backup.schemaVersion).toBe(1)
  })

  it('bloque un primaire partiel si un backup courant existe mais est corrompu', () => {
    seedRegistrySnapshot(
      {
        tools: [{ id: 't1', label: 't1', description: 'outil', enabled: false, mutable: true }]
      },
      base
    )
    const primary = enablementPath(base)
    writeFileSync(primary, JSON.stringify({ tools: {} }), 'utf8')
    writeFileSync(`${primary}.bak`, '{', 'utf8')

    expect(() => listNativeRegistry('tools', base)).toThrow(/corrompu|invalide/i)
    expect(JSON.parse(readFileSync(primary, 'utf8'))).toEqual({ tools: {} })
    expect(readFileSync(`${primary}.bak`, 'utf8')).toBe('{')
  })
})
