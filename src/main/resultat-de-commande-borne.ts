/**
 * PLAFOND D'UN RESULTAT DE COMMANDE INJECTE DANS LE PROMPT.
 *
 * Mesure du 2026-09-06 (conv-312, trace `prompt-observability/conv-312.jsonl`) : un appel
 * `retrospective` a rendu 2 860 957 caracteres, recopies TELS QUELS dans le message du tour.
 * Le prompt final pesait 3 120 985 caracteres — environ 890 k tokens pour une fenetre de 200 k.
 * Le fournisseur a repondu « Prompt is too long », le tour est mort, et la RELANCE rejouait le
 * meme prompt : la conversation devenait un cul-de-sac dont l'utilisateur ne pouvait plus sortir.
 *
 * La cause n'est pas la commande — n'importe quelle lecture volumineuse produit le meme effet —
 * c'est l'ABSENCE DE PLAFOND a l'injection. On borne donc ici, une fois, pour toutes.
 *
 * On coupe en DISANT ce qui manque, jamais en silence : une troncature muette ferait conclure le
 * modele sur un resultat qu'il croit complet. L'avis nomme la commande, le nombre de caracteres
 * ecartes, et la sortie : redemander plus etroit.
 */
export const CARACTERES_MAX_RESULTAT_COMMANDE = 120_000

export function bornerResultatDeCommande(
  nomDeLaCommande: string,
  rendu: string,
  plafond: number = CARACTERES_MAX_RESULTAT_COMMANDE
): string {
  if (!Number.isFinite(plafond) || plafond <= 0) return rendu
  if (rendu.length <= plafond) return rendu
  const ecartes = rendu.length - plafond
  return (
    rendu.slice(0, plafond) +
    `\n\n[RESULTAT TRONQUE PAR L'APP — ${ecartes} caractere(s) de la sortie de ` +
    `\`${nomDeLaCommande}\` ne sont PAS dans ce prompt (plafond ${plafond}). Tu ne lis donc PAS ` +
    `la fin de ce resultat. Ne conclus pas sur ce qui manque : relance la commande sur un ` +
    `perimetre plus etroit (moins d'elements, une plage, un filtre) pour obtenir le reste.]`
  )
}
