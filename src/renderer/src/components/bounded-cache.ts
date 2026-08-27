/**
 * Cache LRU minimal, clé texte → valeur calculée.
 *
 * Pourquoi borné : pendant le streaming, CHAQUE lot de deltas produit une clé NOUVELLE (le texte
 * grandit). Un cache non borné garderait donc tous les états intermédiaires du fil — une fuite qui
 * grossit avec la conversation. La borne fait de ce cache ce qu'il doit être : une mémoire des
 * DERNIERS textes rendus, ce qui suffit à ne pas re-parser les bulles déjà figées à chaque frame.
 *
 * Un `Map` JS conserve l'ordre d'insertion : la première clé est la plus ancienne, d'où une LRU en
 * quelques lignes (relire une entrée la réinsère en queue).
 */
export function createBoundedCache<V>(maxEntries: number): {
  get: (key: string, compute: (key: string) => V) => V
  size: () => number
} {
  const entries = new Map<string, V>()
  return {
    get(key, compute) {
      const hit = entries.get(key)
      if (hit !== undefined) {
        entries.delete(key)
        entries.set(key, hit)
        return hit
      }
      const value = compute(key)
      entries.set(key, value)
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      return value
    },
    size: () => entries.size
  }
}
