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
 *
 * Le plafond se regle par AUTOWIN_MAX_RESULTAT_COMMANDE_CHARS : une fenetre de contexte n'est pas
 * la meme d'un modele a l'autre, et l'exploitation doit pouvoir serrer (ou desserrer) sans rebuild.
 * Toute valeur inutilisable — absente, mal typee, nulle, negative — RETOMBE sur les 120 000 par
 * defaut : un reglage fautif ne doit jamais rouvrir le cul-de-sac de conv-312.
 */
export const CARACTERES_MAX_RESULTAT_COMMANDE_PAR_DEFAUT = 120_000

/**
 * BORNE HAUTE du reglage. Un plafond reglable sans maximum rouvre exactement le cul-de-sac de
 * conv-312 : il suffit d'ecrire 10000000 pour laisser repasser les 2 860 957 caracteres qui ont
 * tue le tour. 400 000 caracteres valent environ 115 k tokens — cela tient dans une fenetre de
 * 200 k en laissant la place au reste du prompt. Toute valeur au-dessus est ECRETEE, jamais
 * refusee : un reglage trop genereux doit degrader vers le sur, pas casser le demarrage.
 */
export const CARACTERES_MAX_RESULTAT_COMMANDE_MAXIMUM = 400_000

/**
 * Lit un plafond depuis la forme BRUTE de la variable d'environnement (donc `string | undefined`).
 * Seul un nombre fini strictement positif est retenu ; tout le reste rend le defaut.
 */
export function plafondDepuisEnvironnement(
  brut: string | undefined,
  defaut: number = CARACTERES_MAX_RESULTAT_COMMANDE_PAR_DEFAUT
): number {
  if (typeof brut !== 'string') return defaut
  const nettoye = brut.trim()
  if (nettoye === '') return defaut
  const valeur = Number(nettoye)
  if (!Number.isFinite(valeur) || valeur <= 0) return defaut
  return Math.min(Math.floor(valeur), CARACTERES_MAX_RESULTAT_COMMANDE_MAXIMUM)
}

export const CARACTERES_MAX_RESULTAT_COMMANDE = plafondDepuisEnvironnement(
  typeof process !== 'undefined' ? process.env?.AUTOWIN_MAX_RESULTAT_COMMANDE_CHARS : undefined
)

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
