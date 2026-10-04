import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { type CapabilityItem } from './capability-controls'
import { descriptionDuFrontMatter, skillRoots } from './native-registry'

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

const MAX_DEPTH = 6
const MAX_FILES_PER_SOURCE = 500
const METADATA_BYTES = 16_384

/**
 * Sources par défaut de l'écran Skills : les MÊMES racines que la palette `/` et l'état du modèle
 * (`skillRoots`, native-registry) — uniquement Autowin, le dépôt d'abord.
 *
 * Décision utilisateur du 2026-09-26 (conv-16) : « je garde que les skills d'autowin ». Avant, l'écran
 * listait `~/.codex/skills` et `~/.claude/skills`, et sa source « Autowin » pointait vers
 * `%LOCALAPPDATA%/autowin-os/skills` seul — les skills du dépôt n'y figuraient même pas. Une source
 * supplémentaire reste possible, mais seulement si l'utilisateur la déclare dans `skill-sources.json`.
 */
export function defaultSkillProviders(roots: string[] = skillRoots()): SkillDiscoveryProvider[] {
  return roots.map((root, index) => ({
    id: index === 0 ? 'autowin' : `autowin-${index + 1}`,
    label: 'Autowin',
    root
  }))
}

function loadConfiguredProviders(
  configPath: string,
  defaults: SkillDiscoveryProvider[] = defaultSkillProviders()
): SkillDiscoveryProvider[] {
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
      description: descriptionDuFrontMatter(header) || 'Sans description'
    }
  } catch {
    return null
  }
}

export async function discoverConfiguredSkillRegistry(
  configPath: string,
  defaults: SkillDiscoveryProvider[] = defaultSkillProviders()
): Promise<SkillRegistryItem[]> {
  return discoverSkillProviders(loadConfiguredProviders(configPath, defaults))
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
