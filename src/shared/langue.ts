/**
 * LA LANGUE DE L'APPLICATION — Settings · Interface (conv-1146, 2026-10-26, « je veux pouvoir
 * basculer autowin OS en full anglais »).
 *
 * Partagé entre l'interface (ce qu'on LIT à l'écran) et le moteur (la langue dans laquelle l'agent
 * RÉPOND) : une seule liste, une seule règle de validation, pour que les deux côtés ne puissent pas
 * diverger sur ce qu'est une langue valable.
 *
 * Le français reste la langue PAR DÉFAUT : qui ne touche pas au réglage ne voit rien changer. Toute
 * valeur absente, vide, abîmée ou inconnue (`"de"`, `""`, un ancien format) retombe sur lui.
 */
export type Langue = 'fr' | 'en'

export interface LangueProposee {
  readonly id: Langue
  /** Écrit dans SA langue : on doit reconnaître la sienne sans lire l'autre. */
  readonly libelle: string
  /** Pour `toLocaleDateString` / `Intl.NumberFormat`. */
  readonly locale: string
}

export const LANGUES: readonly LangueProposee[] = [
  { id: 'fr', libelle: 'Français', locale: 'fr-FR' },
  { id: 'en', libelle: 'English', locale: 'en-US' }
]

export const LANGUE_PAR_DEFAUT: Langue = 'fr'

export function estLangue(valeur: unknown): valeur is Langue {
  return typeof valeur === 'string' && LANGUES.some((l) => l.id === valeur)
}

/** Une valeur quelconque ramenée à une langue valable : inconnue = français. */
export function langueOuDefaut(valeur: unknown): Langue {
  return estLangue(valeur) ? valeur : LANGUE_PAR_DEFAUT
}

/** La locale des dates et des nombres pour une langue. */
export function localeDeLangue(langue: Langue): string {
  return LANGUES.find((l) => l.id === langue)?.locale ?? 'fr-FR'
}
