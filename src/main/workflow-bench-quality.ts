/**
 * Juger le RÉSULTAT d'une confrontation, pas seulement son prix.
 *
 * Le banc comparait le coût, la durée et un booléen « vert ». Or `vert` signifie seulement « le run
 * est allé au bout » : deux workflows peuvent finir tous les deux et rendre l'un une analyse fouillée,
 * l'autre trois lignes creuses. Mesuré le 2026-08-06 — le banc a recommandé un workflow parce qu'il
 * était moins cher, sans que rien n'ait regardé ce qu'il avait produit. Un instrument qui mesure le
 * prix et prétend départager la valeur induit en erreur, et c'est pire que pas d'instrument.
 *
 * Deux garanties portent tout ce module :
 *
 * 1. **La comparaison est AVEUGLE.** Le juge reçoit les livrables sous les étiquettes A, B, C… et
 *    ignore quel workflow a produit lequel. Sans cela il suffirait qu'un nom sonne sérieux — « Panel
 *    critique » — pour qu'il l'emporte sur le contenu.
 * 2. **L'ordre est TIRÉ AU SORT par l'appelant, pas figé.** À qualité égale, un juge favorise ce
 *    qu'il lit en premier ; laisser l'ordre du banc décider ferait gagner le premier workflow lancé.
 */

export interface Livrable {
  /** L'identifiant réel — jamais montré au juge. */
  profileId: string | null
  profileName: string
  texte: string
  costUsd: number
}

export interface VerdictQualite {
  /** L'étiquette gagnante telle que le juge l'a nommée (A, B…). */
  etiquette: string
  raison: string
}

/** Ce que le juge voit : des lettres, jamais des noms de workflow. */
export function etiquetteDe(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * Le prompt de comparaison. Il demande UNE lettre et une raison courte — un juge invité à nuancer
 * rend un paragraphe dont on ne peut rien tirer d'automatique.
 */
export function promptComparaison(objectif: string, livrables: Livrable[]): string {
  const corpus = livrables
    .map((l, i) => `--- LIVRABLE ${etiquetteDe(i)} ---\n${l.texte.trim() || '(vide)'}`)
    .join('\n\n')
  return `Deux ou plusieurs agents ont traité le MÊME objectif. Tu compares leurs livrables et tu désignes le meilleur.

OBJECTIF
${objectif}

${corpus}

Juge UNIQUEMENT sur ce qui est écrit : la cause est-elle réellement prouvée (fichier, ligne,
déclencheur) ? le correctif proposé tient-il ? ce qui n'a pas été vérifié est-il dit ?
Un livrable plus long n'est pas meilleur. Un livrable qui affirme sans preuve est moins bon qu'un
livrable qui dit ce qu'il ignore.

Réponds par DEUX lignes, rien d'autre :
MEILLEUR: <lettre>
RAISON: <une phrase>`
}

/** Lit le verdict. Toute réponse incomprise rend `undefined` — on ne devine pas un gagnant. */
export function lireVerdict(texte: string, nombre: number): VerdictQualite | undefined {
  const ligne = texte.split('\n').find((l) => /^\s*MEILLEUR\s*:/i.test(l))
  if (!ligne) return undefined
  const lettre = ligne.replace(/^\s*MEILLEUR\s*:/i, '').trim().toUpperCase().slice(0, 1)
  const index = lettre.charCodeAt(0) - 65
  if (!(index >= 0 && index < nombre)) return undefined
  const raisonLigne = texte.split('\n').find((l) => /^\s*RAISON\s*:/i.test(l))
  return {
    etiquette: lettre,
    raison: raisonLigne ? raisonLigne.replace(/^\s*RAISON\s*:/i, '').trim() : ''
  }
}

export interface ClassementQualite {
  gagnantProfileId: string | null
  gagnantNom: string
  raison: string
  /** Le surcoût du gagnant par rapport au moins cher : le prix payé POUR cette qualité. */
  surcoutUsd: number
}

/**
 * Le classement final. La QUALITÉ décide ; le coût ne sert qu'à dire ce que cette qualité a coûté
 * en plus. C'est l'inversion qui compte : avant, le moins cher gagnait et personne ne lisait rien.
 */
export function classer(
  livrables: Livrable[],
  verdict: VerdictQualite | undefined
): ClassementQualite | undefined {
  if (!livrables.length || !verdict) return undefined
  const index = verdict.etiquette.charCodeAt(0) - 65
  const gagnant = livrables[index]
  if (!gagnant) return undefined
  const moinsCher = Math.min(...livrables.map((l) => l.costUsd))
  return {
    gagnantProfileId: gagnant.profileId,
    gagnantNom: gagnant.profileName,
    raison: verdict.raison,
    surcoutUsd: Number((gagnant.costUsd - moinsCher).toFixed(4))
  }
}
