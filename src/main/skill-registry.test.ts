import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverSkillProviders,
  discoverConfiguredSkillRegistry,
  discoverSkillRegistry,
  type SkillRegistryRoots
} from './skill-registry'

function put(
  root: string,
  directory: string,
  name: string,
  description = `${name} description`
): void {
  const target = join(root, directory)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`)
}

function roots(base: string): SkillRegistryRoots {
  return {
    codex: join(base, 'codex'),
    claude: join(base, 'claude'),
    hermesLocal: join(base, 'hermes-local'),
    hermesBuiltin: join(base, 'hermes-builtin')
  }
}

describe('registre multi-source des skills', () => {
  it('conserve les homonymes Codex, Claude et Hermes avec des identités qualifiées', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const configured = roots(base)
    put(configured.codex, 'shared', 'shared')
    put(configured.claude, 'shared', 'shared')
    put(configured.hermesLocal, 'shared', 'shared')
    put(configured.hermesBuiltin, 'builtin-only', 'builtin-only')

    const items = await discoverSkillRegistry(configured, async () => [])

    expect(items.map((item) => item.id)).toEqual([
      'codex:shared',
      'claude:shared',
      'hermes-local:shared',
      'hermes-builtin:builtin-only'
    ])
    expect(new Set(items.map((item) => item.source))).toEqual(
      new Set(['codex', 'claude', 'hermes-local', 'hermes-builtin'])
    )
  })

  it('rapproche un identifiant Hermes tronqué avec le nom canonique du fichier', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const configured = roots(base)
    put(configured.hermesLocal, 'hermes-oauth-operations', 'hermes-oauth-operations')

    const items = await discoverSkillRegistry(configured, async () => [
      {
        id: 'hermes-oauth-operatio…',
        label: 'hermes-oauth-operatio…',
        description: 'oauth',
        enabled: true,
        mutable: false
      }
    ])

    expect(items).toEqual([
      expect.objectContaining({
        id: 'hermes-local:hermes-oauth-operations',
        label: 'hermes-oauth-operations',
        enabled: true
      })
    ])
  })

  it('accepte une nouvelle source sans modifier le registre ni le renderer', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const windsurf = join(base, 'windsurf')
    put(windsurf, 'custom', 'custom')

    const items = await discoverSkillProviders(
      [{ id: 'windsurf', label: 'Windsurf', root: windsurf }],
      async () => []
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'windsurf:custom',
        source: 'windsurf',
        sourceLabel: 'Windsurf'
      })
    ])
  })

  it('charge une cinquième source depuis la configuration runtime du chemin applicatif', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const configured = roots(base)
    const windsurf = join(base, 'windsurf')
    put(windsurf, 'custom', 'custom')
    const configPath = join(base, 'skill-sources.json')
    mkdirSync(base, { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({ sources: [{ id: 'windsurf', label: 'Windsurf', root: windsurf }] })
    )

    const items = await discoverConfiguredSkillRegistry(configPath, configured, async () => [])

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'windsurf:custom', sourceLabel: 'Windsurf' })
    )
  })
})
