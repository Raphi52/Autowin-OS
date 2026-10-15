/**
 * CE QUE LA BRIQUE « FAIT RETENU » MONTRE AU CLIC (demande du 2026-10-12 : « je vois fait retenu
 * mais quand je clique dessus je voudrais voir quel fait »).
 *
 * Le graphe ne montre aucun contenu d'outil. Celui-ci est l'exception, et elle est étroite : on lit
 * la RÉPONSE de `remember` (`main/commands.ts`, `case 'remember'`), jamais ses arguments. La réponse
 * ne porte le texte que s'il a passé la validation locale (`fact`, écrit depuis `outcome.fact`) ; un
 * refus local n'y porte que son motif. Un fait refusé localement parce qu'il contenait un secret
 * n'apparaît donc jamais à l'écran.
 *
 * UNE RÉPONSE EN ÉCHEC EST ÉCRITE EN `error`, PAS EN `tool-result` (2026-10-15, conv-966 : « pk ça
 * veut le texte du fait »). Un dépôt refusé (`stored: false`) est un échec de la commande : la trace
 * range sa réponse dans une charge `error`. Le panneau ne lisait que `tool-result` ; il affichait
 * donc « le texte du fait n'est pas lisible » sur chaque appel refusé, et taisait le refus dans un
 * groupe où un autre appel avait réussi (conv-927 : « refusé par le Brain : likely personal data »).
 * Un fait validé mais NON déposé (Brain injoignable, refusé par le Brain) reste gardé dans le fil :
 * il se montre, marqué `depose: false`, avec la raison.
 */
export type LectureFaitRetenu =
  | { retenu: true; depose: boolean; titre: string; texte: string; issue?: string }
  | { retenu: false; motif: string }

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
      depose: champs.stored === true,
      titre: chaine(fait?.title) ?? '',
      texte,
      ...(issue ? { issue } : {})
    }
  }
  const motif = chaine(champs.reason) ?? chaine(champs.detail)
  return motif ? { retenu: false, motif } : undefined
}

/**
 * Lit une charge de réponse de `remember`, réussie (`tool-result`) ou en échec (`error`). Une erreur
 * qui n'est pas une réponse structurée (la commande a levé une exception) est son propre motif.
 */
export function lireReponseRemember(charge: {
  kind: string
  content: string
}): LectureFaitRetenu | undefined {
  const lecture = lireFaitRetenu(charge.content)
  if (lecture || charge.kind !== 'error') return lecture
  const motif = chaine(charge.content)?.trim()
  return motif ? { retenu: false, motif } : undefined
}
