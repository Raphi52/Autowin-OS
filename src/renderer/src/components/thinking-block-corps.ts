/*
 * Corps des blocs « Raisonnement » et « Actions » — hors du composant EXPRES : un fichier qui
 * exporte a la fois un composant et une fonction casse le rechargement a chaud de React
 * (regle react-refresh/only-export-components). Le calcul est pur, il n'a pas besoin du composant.
 */
/**
 * Corps du bloc RAISONNEMENT : la pensee du modele, et rien d'autre.
 *
 * Avant le 2026-09-12 ce corps melangeait la pensee et les lignes d'action ; l'utilisateur ne
 * voyait donc que les actions sur les modeles dont la pensee arrive vide. Les deux vivent
 * desormais dans DEUX blocs empiles.
 */
export function corpsDuBloc(text: string): string {
  return text
}

/**
 * En-tete du bloc RAISONNEMENT quand il est PLIE : la DERNIERE ligne ecrite, comme le bloc
 * Actions affiche son action courante (demande de l'utilisateur, 2026-09-12). On saute les lignes
 * vides de fin : une pensee qui vient de passer a la ligne afficherait sinon du vide.
 */
export function derniereLigneDuRaisonnement(text: string): string {
  const lignes = text.split('\n')
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const ligne = lignes[i]!.trim()
    if (ligne) return ligne
  }
  return ''
}

/**
 * Corps du bloc ACTIONS : UNE LIGNE PAR ACTION.
 *
 * Le fournisseur emet deux sortes de lignes : l'ACTION elle-meme (`Read · src/a.ts`) puis des
 * BATTEMENTS qui ne font que redire la meme action avec sa duree qui monte (`Bash en cours - 30 s`,
 * `Bash en cours - 1 min`, ...). Empilees telles quelles, une seule commande longue produisait des
 * dizaines de lignes et le bloc devenait illisible. Demande de l'utilisateur (2026-09-12) : « dans
 * le bloc Action je veux une ligne par action ».
 *
 * Regle : un battement ne cree PAS de ligne, il MET A JOUR la ligne de son outil (la derniere du
 * meme nom). Si l'action n'a jamais ete annoncee, le battement devient lui-meme cette ligne.
 */
const BATTEMENT = /^(.+?) en cours(?: - (.*))?$/

/** Nom d'outil porte par une ligne d'action (`Read · cible` -> `Read`). */
function outilDe(ligne: string): string {
  const battement = BATTEMENT.exec(ligne)
  if (battement) return battement[1]!.trim()
  return (ligne.split('·')[0] ?? ligne).trim()
}

export function corpsDesActions(
  statusLog: string[] | undefined,
  status: string | undefined
): string {
  const lignes = (statusLog?.length ? statusLog : status ? [status] : []).filter(Boolean)
  const sortie: string[] = []
  for (const ligne of lignes) {
    const battement = BATTEMENT.exec(ligne)
    if (!battement) {
      if (sortie.at(-1) !== ligne) sortie.push(ligne)
      continue
    }
    const outil = battement[1]!.trim()
    const suite = (battement[2] ?? '').trim()
    const index = sortie.map(outilDe).lastIndexOf(outil)
    if (index < 0) {
      sortie.push(ligne)
      continue
    }
    // Ligne d'action deja annoncee : elle garde son libelle, l'avancement s'ecrit APRES (une seule
    // fois). Ligne qui n'etait DEJA qu'un battement : elle est remplacee par le battement courant.
    const ancre = sortie[index]!
    sortie[index] = BATTEMENT.test(ancre)
      ? ligne
      : suite
        ? `${ancre.split(' — ')[0]!} — ${suite}`
        : ancre.split(' — ')[0]!
  }
  return sortie.join('\n')
}
