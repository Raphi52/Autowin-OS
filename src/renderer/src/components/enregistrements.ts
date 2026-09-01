/**
 * Le widget « Enregistrements », côté DÉCISIONS : tout ce qui se prouve sans micro ni disque.
 *
 * Le widget lui-même ne garde que ce qui n'est pas testable hors navigateur (le moteur vocal et les
 * appels à l'application). Les règles qui comptent vivent ici : ce qu'on affiche d'un fichier, et
 * ce qu'on garde à l'écran d'un transcript qui, lui, part en entier sur le disque.
 */

export interface FichierEnregistre {
  nom: string
  chemin: string
  octets: number
  /** Dernière écriture, en millisecondes epoch. */
  le: number
}

/**
 * Ce qu'on garde À L'ÉCRAN. Le disque, lui, reçoit TOUT : une réunion de trois heures y tient
 * entière. Afficher trois mille lignes ne servirait personne et ferait ramer la page.
 */
export const MAX_LIGNES_AFFICHEES = 80

export function formaterTaille(octets: number): string {
  if (octets < 1_000) return `${octets} o`
  if (octets < 1_000_000) return `${Math.round(octets / 100) / 10} ko`
  return `${Math.round(octets / 100_000) / 10} Mo`
}

const deuxChiffres = (n: number): string => String(n).padStart(2, '0')

/** Une durée pour un humain : on lit d'abord les minutes, pas les millisecondes. */
export function formaterDuree(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${deuxChiffres(m)} min`
  if (m > 0) return `${m} min ${deuxChiffres(s)} s`
  return `${s} s`
}

/** Quand ce fichier a été écrit, dit comme on le dirait à voix haute. */
export function formaterQuand(le: number, maintenant: number): string {
  const ecart = maintenant - le
  const d = new Date(le)
  const heure = `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`
  if (ecart < 60_000) return 'à l’instant'
  if (ecart < 3_600_000) return `il y a ${Math.floor(ecart / 60_000)} min`
  const aujourdhui = new Date(maintenant)
  const memeJour =
    d.getFullYear() === aujourdhui.getFullYear() &&
    d.getMonth() === aujourdhui.getMonth() &&
    d.getDate() === aujourdhui.getDate()
  if (memeJour) return `aujourd’hui ${heure}`
  return `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)} ${heure}`
}

/**
 * Le titre lisible d'un fichier, tiré de son NOM.
 *
 * `enregistrement-2026-09-01_14-32-05.txt` se lit « 01/09/2026 à 14:32 ». Un nom qui ne suit pas
 * ce moule est rendu tel quel : mieux vaut un nom brut qu'une date inventée.
 */
export function titreEnregistrement(nom: string): string {
  const m = /^enregistrement-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-\d{2}\.txt$/.exec(nom)
  if (!m) return nom
  return `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}`
}

/** Ajoute une phrase figée à l'affichage, la plus récente en tête. Une phrase vide n'est rien. */
export function ajouterLigneAffichee(lignes: readonly string[], texte: string): string[] {
  const propre = texte.trim()
  if (propre === '') return lignes as string[]
  return [propre, ...lignes].slice(0, MAX_LIGNES_AFFICHEES)
}
