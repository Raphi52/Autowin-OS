import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { type CapabilityItem } from './capability-controls'

export interface SkillRegistryItem extends CapabilityItem {
  source: string
  sourceLabel: string
  path: string
}

export interface SkillDiscoveryProvider {
  id: string
  label: string
  root: string
}

interface SkillSourcesConfig {
  sources?: SkillDiscoveryProvider[]
}

export interface SkillRegistryRoots {
  codex: string
  claude: string
  autowin: string
}

const MAX_DEPTH = 6
const MAX_FILES_PER_SOURCE = 500
const METADATA_BYTES = 16_384

export function defaultSkillRegistryRoots(): SkillRegistryRoots {
  const user = homedir()
  const localAppData = process.env.LOCALAPPDATA ?? join(user, 'AppData', 'Local')
  // Souverain : kit `~/.claude/skills` + `~/.codex/skills` + racine Autowin.
  return {
    codex: join(user, '.codex', 'skills'),
    claude: join(user, '.claude', 'skills'),
    autowin: join(localAppData, 'autowin-os', 'skills')
  }
}

export function providersFromRoots(roots: SkillRegistryRoots): SkillDiscoveryProvider[] {
  return [
    { id: 'codex', label: 'Codex', root: roots.codex },
    { id: 'claude', label: 'Claude', root: roots.claude },
    { id: 'autowin', label: 'Autowin', root: roots.autowin }
  ]
}

export function loadConfiguredProviders(
  configPath: string,
  roots: SkillRegistryRoots = defaultSkillRegistryRoots()
): SkillDiscoveryProvider[] {
  const defaults = providersFromRoots(roots)
  if (!existsSync(configPath)) return defaults
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as SkillSourcesConfig
    const external = (parsed.sources ?? []).filter(
      (source) =>
        typeof source?.id === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/.test(source.id) &&
        typeof source.label === 'string' &&
        source.label.trim().length > 0 &&
        source.label.length <= 80 &&
        typeof source.root === 'string' &&
        isAbsolute(source.root)
    )
    const byId = new Map(defaults.map((provider) => [provider.id, provider]))
    for (const provider of external) {
      if (!byId.has(provider.id))
        byId.set(provider.id, { ...provider, label: provider.label.trim() })
    }
    return [...byId.values()]
  } catch {
    return defaults
  }
}

function discoverFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const seen = new Set<string>()
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES_PER_SOURCE) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_PER_SOURCE) break
      if (entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (entry.name === 'SKILL.md') {
        let canonical = path
        try {
          canonical = realpathSync(path)
        } catch {
          // Le chemin lisible reste une identité de repli suffisante.
        }
        if (!seen.has(canonical)) {
          seen.add(canonical)
          files.push(path)
        }
      }
    }
  }
  visit(root, 0)
  return files
}

function metadata(path: string): { label: string; description: string } | null {
  try {
    const header = readFileSync(path, 'utf8').slice(0, METADATA_BYTES)
    const fallback = basename(dirname(path))
    return {
      label: /^name:\s*["']?([^\r\n"']+)/m.exec(header)?.[1].trim() || fallback,
      description:
        /^description:\s*["']?([^\r\n"']+)/m.exec(header)?.[1].trim() || 'Sans description'
    }
  } catch {
    return null
  }
}

export async function discoverSkillRegistry(
  roots: SkillRegistryRoots = defaultSkillRegistryRoots()
): Promise<SkillRegistryItem[]> {
  return discoverSkillProviders(providersFromRoots(roots))
}

export async function discoverConfiguredSkillRegistry(
  configPath: string,
  roots: SkillRegistryRoots = defaultSkillRegistryRoots()
): Promise<SkillRegistryItem[]> {
  return discoverSkillProviders(loadConfiguredProviders(configPath, roots))
}

// Souverain : plus d'état enabled récupéré via un binaire externe. Un skill présent
// sur disque est actif (l'activation/désactivation vit désormais dans le registre natif local).
export async function discoverSkillProviders(
  providers: readonly SkillDiscoveryProvider[]
): Promise<SkillRegistryItem[]> {
  return providers.flatMap((provider) =>
    discoverFiles(provider.root).flatMap<SkillRegistryItem>((path) => {
      const meta = metadata(path)
      if (!meta) return []
      return [
        {
          id: `${provider.id}:${meta.label}`,
          label: meta.label,
          description: meta.description,
          enabled: true,
          mutable: false,
          source: provider.id,
          sourceLabel: provider.label,
          path
        }
      ]
    })
  )
}
