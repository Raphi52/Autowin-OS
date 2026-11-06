/**
 * LA SORTIE D'UN MOTEUR ENTRE DANS AUTOWIN MASQUÉE — une fois, à l'entrée.
 *
 * Pourquoi ici : tout ce que rend un moteur (Claude, Codex, Agy, Grok, moteur direct) passe par la
 * pompe du routeur (`registry.ts`) — chaque morceau vers le fil et le journal de tour, puis le
 * résultat final et l'erreur. Masquer à ce seul endroit couvre tous les moteurs et tous leurs lecteurs
 * sans semer `masquerValeurs` dans chacun. Une valeur du coffre y devient `[secret:NOM]`.
 *
 * Ce que ce point ne voit PAS : le fichier `run-stdout/` est rempli par le processus de l'agent
 * lui-même (sa sortie y est redirigée pour survivre à l'app), Autowin ne fait que le relire ; et une
 * valeur coupée entre deux morceaux de texte en flux échappe au masquage morceau par morceau.
 *
 * Parcours : chaînes, tableaux et objets simples seulement — un tampon binaire, une date ou une
 * instance de classe ressort tel quel. Rien à masquer → la MÊME référence, sans copie.
 */
import { masquerValeurs } from '../app/coffre-cles'

export function masquerSortie<T>(
  valeur: T,
  masquer: (texte: string) => string = masquerValeurs
): T {
  const vus = new WeakSet<object>()
  const parcourir = (v: unknown): unknown => {
    if (typeof v === 'string') return masquer(v)
    if (v === null || typeof v !== 'object' || vus.has(v)) return v
    if (Array.isArray(v)) {
      vus.add(v)
      let copie: unknown[] | undefined
      v.forEach((x, i) => {
        const m = parcourir(x)
        if (m !== x) (copie ??= [...v])[i] = m
      })
      return copie ?? v
    }
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return v
    vus.add(v)
    let copie: Record<string, unknown> | undefined
    for (const [cle, x] of Object.entries(v)) {
      const m = parcourir(x)
      if (m !== x) (copie ??= { ...(v as Record<string, unknown>) })[cle] = m
    }
    return copie ?? v
  }
  return parcourir(valeur) as T
}

/** Le message d'une erreur de moteur (souvent la fin de la sortie d'erreur du CLI), masqué en place. */
export function masquerErreur(
  erreur: unknown,
  masquer: (texte: string) => string = masquerValeurs
): void {
  if (!(erreur instanceof Error)) return
  try {
    const masque = masquer(erreur.message)
    if (masque !== erreur.message) erreur.message = masque
    if (typeof erreur.stack === 'string') {
      const pile = masquer(erreur.stack)
      if (pile !== erreur.stack) erreur.stack = pile
    }
  } catch {
    // Une erreur figée (propriétés en lecture seule) garde son texte : on ne remplace pas l'erreur.
  }
}
