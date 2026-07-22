import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * SOURCE DE VÉRITÉ UNIQUE des providers de capacités (skills + hooks), générique tous modèles
 * présents ET futurs. Ajouter un provider = UNE entrée ici, zéro edit ailleurs : skill-registry et
 * claude-hooks dérivent leurs racines/fichiers de cette liste. Aucun identifiant figé en dur ailleurs.
 */
export interface ProviderHookFile {
  path: string
  scope: 'global' | 'project'
}

export interface ProviderCapabilities {
  id: string
  label: string
  /** Racine de scan des skills (SKILL.md). '' si le provider n'expose pas de skills. */
  skillsRoot: string
  /** Fichiers de configuration de hooks à parser (ordre = priorité d'affichage). */
  hookFiles: ProviderHookFile[]
}

export interface ProviderCapabilitiesEnv {
  home?: string
  projectRoot?: string
  localAppData?: string
}

/** Liste dérivée de l'environnement — un futur provider s'ajoute par UNE entrée dans ce tableau. */
export function providerCapabilities(env: ProviderCapabilitiesEnv = {}): ProviderCapabilities[] {
  const home = env.home ?? homedir()
  const projectRoot = env.projectRoot ?? process.cwd()
  const localAppData = env.localAppData ?? process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  return [
    {
      id: 'codex',
      label: 'Codex',
      skillsRoot: join(home, '.codex', 'skills'),
      hookFiles: [{ path: join(home, '.codex', 'hooks.json'), scope: 'global' }]
    },
    {
      id: 'claude',
      label: 'Claude',
      skillsRoot: join(home, '.claude', 'skills'),
      hookFiles: [
        { path: join(home, '.claude', 'settings.json'), scope: 'global' },
        { path: join(home, '.claude', 'settings.local.json'), scope: 'global' },
        { path: join(projectRoot, '.claude', 'settings.json'), scope: 'project' },
        { path: join(projectRoot, '.claude', 'settings.local.json'), scope: 'project' }
      ]
    },
    {
      id: 'autowin',
      label: 'Autowin',
      skillsRoot: join(localAppData, 'autowin-os', 'skills'),
      hookFiles: []
    }
  ]
}

/** Recherche d'un provider par id (undefined si inconnu). */
export function findProviderCapabilities(
  id: string,
  env: ProviderCapabilitiesEnv = {}
): ProviderCapabilities | undefined {
  return providerCapabilities(env).find((provider) => provider.id === id)
}
