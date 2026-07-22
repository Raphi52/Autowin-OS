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
    autowin: join(base, 'autowin')
  }
}

describe('registre multi-source des skills (souverain de Hermes)', () => {
  it('conserve les homonymes Codex, Claude et Autowin avec des identités qualifiées', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const configured = roots(base)
    put(configured.codex, 'shared', 'shared')
    put(configured.claude, 'shared', 'shared')
    put(configured.autowin, 'shared', 'shared')
    put(configured.autowin, 'autowin-only', 'autowin-only')

    const items = await discoverSkillRegistry(configured)

    expect(items.map((item) => item.id)).toEqual([
      'codex:shared',
      'claude:shared',
      'autowin:autowin-only',
      'autowin:shared'
    ])
    expect(new Set(items.map((item) => item.source))).toEqual(
      new Set(['codex', 'claude', 'autowin'])
    )
  })

  it('un skill présent sur disque est actif (plus d’état enabled via Hermes)', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const configured = roots(base)
    put(configured.autowin, 'frame', 'frame')

    const items = await discoverSkillRegistry(configured)

    expect(items).toEqual([
      expect.objectContaining({ id: 'autowin:frame', label: 'frame', enabled: true })
    ])
  })

  it('accepte une nouvelle source sans modifier le registre ni le renderer', async () => {
    const base = join(process.cwd(), 'node_modules', '.tmp-skill-registry', crypto.randomUUID())
    const windsurf = join(base, 'windsurf')
    put(windsurf, 'custom', 'custom')

    const items = await discoverSkillProviders([
      { id: 'windsurf', label: 'Windsurf', root: windsurf }
    ])

    expect(items).toEqual([
      expect.objectContaining({
        id: 'windsurf:custom',
        source: 'windsurf',
        sourceLabel: 'Windsurf'
      })
    ])
  })

  it('charge une source supplémentaire depuis la configuration runtime', async () => {
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

    const items = await discoverConfiguredSkillRegistry(configPath, configured)

    expect(items).toContainEqual(
      expect.objectContaining({ id: 'windsurf:custom', sourceLabel: 'Windsurf' })
    )
  })
})
