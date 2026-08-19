import type { ChatPart } from './chat-view-model'

/**
 * BILAN D'UN TOUR — ce qu'il a accompli, y compris quand il s'arrête mal.
 *
 * Vécu le 2026-08-19 : l'application a livré un correctif de production en DEUX commits fusionnés
 * dans `main`, puis son tour a été coupé. À l'écran, l'utilisateur n'a lu que « ⚠️ Le tour a échoué —
 * budget duree depasse (2700000 ms) ». Rien sur le travail livré. Son verdict, et il est juste : sans
 * compte rendu, un arrêt se lit comme un échec total — alors que deux commits étaient dans `main`.
 *
 * Le travail était SOUS LES YEUX du rendu : les actions du tour vivent dans le même message que
 * l'erreur. Il n'y avait rien à aller chercher, juste à le dire.
 *
 * Ce module ne DÉDUIT rien : il compte ce qui porte une issue, et distingue explicitement les actions
 * dont on ne sait pas si elles ont abouti — un tour tué en laisse toujours. Une action sans issue
 * n'est JAMAIS comptée en réussite.
 */
export interface BilanTour {
  reussies: string[]
  echouees: string[]
  /** Actions dont l'issue n'est jamais revenue — un tour coupé en laisse. */
  sansIssue: number
}

/** Libellé court d'une action : son nom, plus ce qui l'identifie quand c'est disponible. */
function libelle(name: string, data: unknown): string {
  const enregistrement =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
  const precision =
    typeof enregistrement?.path === 'string'
      ? enregistrement.path
      : typeof enregistrement?.command === 'string'
        ? enregistrement.command
        : undefined
  return precision ? `${name} ${precision}` : name
}

export function bilanDuTour(parts: readonly ChatPart[]): BilanTour {
  const reussies: string[] = []
  const echouees: string[] = []
  let sansIssue = 0
  for (const part of parts) {
    if (part.kind !== 'action') continue
    const texte = libelle(part.name, part.data)
    if (part.ok === true) reussies.push(texte)
    else if (part.ok === false) echouees.push(texte)
    else sansIssue += 1
  }
  return { reussies, echouees, sansIssue }
}

/** Combien de libellés on cite avant de s'arrêter : le bilan doit rester lisible d'un coup d'œil. */
const CITES_MAX = 3

function citer(libelles: readonly string[]): string {
  const uniques = [...new Set(libelles)]
  const cites = uniques.slice(0, CITES_MAX).join(' · ')
  const reste = uniques.length - CITES_MAX
  return reste > 0 ? `${cites} · et ${reste} autre(s)` : cites
}

/**
 * Phrase de bilan, ou `undefined` s'il n'y a RIEN à dire — un tour qui n'a rien fait ne doit pas
 * recevoir une ligne rassurante qui laisse croire le contraire.
 */
export function formaterBilan(bilan: BilanTour): string | undefined {
  const morceaux: string[] = []
  if (bilan.reussies.length > 0) {
    morceaux.push(
      `${bilan.reussies.length} réussie${bilan.reussies.length > 1 ? 's' : ''} : ${citer(bilan.reussies)}`
    )
  }
  if (bilan.echouees.length > 0) {
    morceaux.push(
      `${bilan.echouees.length} échouée${bilan.echouees.length > 1 ? 's' : ''} : ${citer(bilan.echouees)}`
    )
  }
  if (bilan.sansIssue > 0) {
    morceaux.push(`${bilan.sansIssue} sans issue connue`)
  }
  return morceaux.length > 0 ? `Avant l’arrêt — ${morceaux.join(' | ')}` : undefined
}
