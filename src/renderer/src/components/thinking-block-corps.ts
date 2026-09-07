/*
 * Corps du bloc « Reflexion » — hors du composant EXPRES : un fichier qui exporte a la fois un
 * composant et une fonction casse le rechargement a chaud de React
 * (regle react-refresh/only-export-components). Le calcul est pur, il n'a pas besoin du composant.
 */
/**
 * Corps DEPLIE : la pensee du modele, puis TOUTES les lignes de signe de vie du tour.
 *
 * Le repli ne garde que la derniere ligne ; deplier doit rendre la trace COMPLETE. Sans liste
 * transmise (rendu partiel), on retombe sur la ligne courante : jamais MOINS qu'avant.
 */
export function corpsDuBloc(
  text: string,
  statusLog: string[] | undefined,
  status: string | undefined,
  done: boolean
): string {
  const lignes = statusLog?.length ? statusLog : status ? [status] : []
  return [text, ...(done ? [] : lignes)].filter(Boolean).join('\n')
}
