import {
  listNativeRegistry,
  setNativeEnablement,
  type RegistryItem,
  type RegistryKind
} from './native-registry'

/**
 * Contrôles de CAPACITÉS (skills / hooks / tools / plugins) — source LOCALE unique (native-registry),
 * sans aucun sous-processus externe. Générique tous providers : l'inventaire vient du registre natif
 * (scan disque des skills + catalogue déclaratif pour tools/plugins/hooks), l'état enabled/disabled
 * d'un fichier de préférences local. Les vues Skills·Hooks·Tools consomment ceci.
 */
export type CapabilityItem = RegistryItem
export type CapabilityKind = RegistryKind

/** Inventaire d'un type de capacité (lecture locale). */
export async function listCapabilities(kind: CapabilityKind): Promise<CapabilityItem[]> {
  return listNativeRegistry(kind)
}

/** Active/désactive une capacité (persisté localement). restartRequired conservé pour l'UI. */
export async function setCapabilityEnabled(
  kind: CapabilityKind,
  id: string,
  enabled: boolean
): Promise<{ items: CapabilityItem[]; restartRequired: true }> {
  if (!/^[\w.\-/]{1,128}$/.test(id)) throw new Error(`Identifiant de capacité invalide: ${id}`)
  const known = listNativeRegistry(kind)
  if (!known.some((item) => item.id === id)) throw new Error(`Capacité inconnue (${kind}): ${id}`)
  return { items: setNativeEnablement(kind, id, enabled), restartRequired: true }
}

/** Amorçage opportuniste du cache/lecture (best-effort, ne jette jamais). */
export async function warmCapabilities(): Promise<void> {
  try {
    listNativeRegistry('skills')
  } catch {
    /* lecture opportuniste : l'IPC affichera l'erreur réelle si nécessaire */
  }
}
