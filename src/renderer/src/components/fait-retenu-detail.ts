/**
 * CE QUE LA BRIQUE « FAIT RETENU » MONTRE AU CLIC (demande du 2026-10-12 : « je vois fait retenu
 * mais quand je clique dessus je voudrais voir quel fait »).
 *
 * Le graphe ne montre aucun contenu d'outil. Celui-ci est l'exception, et elle est étroite : on lit
 * la RÉPONSE de `remember` (`main/commands.ts`, `case 'remember'`), jamais ses arguments. La réponse
 * ne porte le texte que s'il a été VALIDÉ (`fact`, écrit depuis `outcome.fact`) ; un refus n'y porte
 * que son motif. Un fait refusé parce qu'il contenait un secret n'apparaît donc jamais à l'écran.
 */
export type LectureFaitRetenu =
  { retenu: true; titre: string; texte: string; issue?: string } | { retenu: false; motif: string }

function chaine(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.trim() !== '' ? valeur : undefined
}

/** Lit une réponse de `remember` ; rien quand elle n'est ni un fait validé ni un refus motivé. */
export function lireFaitRetenu(contenu: string): LectureFaitRetenu | undefined {
  let reponse: unknown
  try {
    reponse = JSON.parse(contenu)
  } catch {
    return undefined
  }
  if (!reponse || typeof reponse !== 'object') return undefined
  const champs = reponse as Record<string, unknown>
  const fait =
    champs.fact && typeof champs.fact === 'object'
      ? (champs.fact as Record<string, unknown>)
      : undefined
  const texte = chaine(fait?.body)
  if (texte) {
    const issue = chaine(champs.detail)
    return {
      retenu: true,
      titre: chaine(fait?.title) ?? '',
      texte,
      ...(issue ? { issue } : {})
    }
  }
  const motif = chaine(champs.reason) ?? chaine(champs.detail)
  return motif ? { retenu: false, motif } : undefined
}
