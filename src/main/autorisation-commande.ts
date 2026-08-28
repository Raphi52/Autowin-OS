/**
 * QUI A LE DROIT DE LANCER UNE COMMANDE — et d'où ce droit vient.
 *
 * DÉFAUT VÉCU, rapporté le 2026-08-26 après des semaines : l'utilisateur écrit « Autorise les
 * commandes git », et l'agent répond « ton autorisation dans le chat ne lève pas le garde
 * d'exécution de mon outil Bash ».
 *
 * LA CAUSE N'ÉTAIT PAS UNE GARDE TROP STRICTE : il n'y en avait AUCUNE. L'agent n'a jamais eu de
 * capacité d'exécution libre. Le catalogue expose 26 commandes, aucune n'est un shell ; `verify`
 * lance le script `test` DÉCLARÉ par le projet, et aucun paramètre du modèle ne traverse la
 * frontière (`verify-command.ts`). Le refus était donc juste sur le fond — et faux sur la cause.
 * L'agent a inventé un garde pour expliquer une capacité absente, ce qui a envoyé l'utilisateur
 * chercher pendant des semaines une permission qui n'existait pas.
 *
 * CE MODULE REND L'AUTORISATION RÉELLE, et il la fait venir du seul endroit qui compte : les
 * messages de L'UTILISATEUR. Pas d'un drapeau de configuration qu'il faudrait retrouver, pas d'une
 * affirmation du modèle — qui pourrait alors s'accorder ce qu'il veut en l'écrivant.
 *
 * TROIS PROPRIÉTÉS, et chacune répond à une façon précise de se tromper :
 *   1. REFUS PAR DÉFAUT. Sans autorisation écrite, rien ne part.
 *   2. PAR BINAIRE. Autoriser `git` n'ouvre pas `curl` : une autorisation donnée pour une tâche ne
 *      devient pas un blanc-seing.
 *   3. AUCUN ENCHAÎNEMENT. `git status && rm -rf /` est refusé. Avec `shell: false` ces opérateurs
 *      ne seraient pas interprétés — ils partiraient comme ARGUMENTS, donc silencieusement inertes.
 *      Un refus explicite vaut mieux qu'une commande qui ne fait pas ce qu'elle a l'air de faire.
 */

/** Ce qui sera réellement exécuté : le premier mot, sans son chemin ni son extension. */
export function binaireDe(ligne: string): string | undefined {
  const premier = ligne.trim().split(/\s+/)[0]
  if (!premier) return undefined
  const base = premier.split(/[\\/]|[\\\\]/).pop() ?? premier
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/** Opérateurs qui donnent à une ligne un sens que `shell: false` n'exécutera pas. */
const ENCHAINEMENTS = /[;|&`$><\n]|\$\(/

export interface DecisionCommande {
  autorise: boolean
  binaire?: string
  motif?: string
}

/**
 * L'utilisateur a-t-il autorisé CE binaire, dans SES messages ?
 *
 * `messagesUtilisateur` ne doit contenir que des messages de rôle `user`. Le contrat est
 * volontairement porté par l'appelant : un module qui recevrait tout l'historique laisserait le
 * modèle s'autoriser en écrivant la phrase lui-même.
 */
export interface AutorisationsLues {
  general: boolean
  binaires: readonly string[]
}

/**
 * AUTORISE D'OFFICE — decision utilisateur du 2026-08-28 : « arrete de me demander de t'autoriser
 * git, fais-le ». Redemander un droit deja donne a chaque conversation etait le vrai cout. `git`
 * seul est grave : la liste reste nominale (propriete 2), les enchainements restent refuses
 * (propriete 3), et tout autre binaire garde le refus par defaut (propriete 1).
 */
export const AUTORISATIONS_PAR_DEFAUT: readonly string[] = ['git']

const MOTS_GENERAUX = /autorise\s+(toutes\s+les\s+commandes|tout)\b/

/**
 * Ce que L'UTILISATEUR a autorisé, lu dans SES messages — et rien d'autre.
 *
 * Extrait pour que le droit puisse être MÉMORISÉ hors de la conversation (« dans toutes les
 * conversations, forever ») sans que la source du droit change : elle reste le message `user`.
 */
export function autorisationsLuesDans(messagesUtilisateur: readonly string[]): AutorisationsLues {
  const texte = messagesUtilisateur.join('\n').toLowerCase()
  const binaires = new Set<string>()
  const motif = /autorise\s+(?:les\s+commandes?\s+|la\s+commande\s+)?([a-z0-9._-]+)/g
  for (const trouve of texte.matchAll(motif)) {
    const nom = trouve[1]
    if (!nom || nom === 'toutes' || nom === 'tout' || nom === 'la' || nom === 'les') continue
    binaires.add(nom)
  }
  return { general: MOTS_GENERAUX.test(texte), binaires: [...binaires] }
}

/**
 * L'utilisateur a-t-il autorisé CE binaire — ici, ou une fois pour toutes ?
 *
 * `messagesUtilisateur` ne doit contenir que des messages de rôle `user` : un module qui recevrait
 * tout l'historique laisserait le modèle s'autoriser en écrivant la phrase lui-même. `permanentes`
 * vient du registre disque, qui n'est alimenté que par ces mêmes messages utilisateur.
 */
export function decisionDeCommande(
  ligne: string,
  messagesUtilisateur: readonly string[],
  permanentes: AutorisationsLues = { general: false, binaires: [] }
): DecisionCommande {
  const binaire = binaireDe(ligne)
  if (!binaire) return { autorise: false, motif: 'aucune commande à lancer' }
  if (ENCHAINEMENTS.test(ligne)) {
    return {
      autorise: false,
      binaire,
      motif: `enchaînement shell refusé : lance une seule commande à la fois (${binaire})`
    }
  }
  // Le binaire est VALIDE avant toute comparaison : normalisé en minuscules, il ne doit porter que
  // des caractères inoffensifs.
  if (!/^[a-z0-9._-]+$/.test(binaire)) {
    return { autorise: false, binaire, motif: `nom de commande inattendu : ${binaire}` }
  }
  const ici = autorisationsLuesDans(messagesUtilisateur)
  const general = ici.general || permanentes.general
  const nominale =
    AUTORISATIONS_PAR_DEFAUT.includes(binaire) ||
    ici.binaires.includes(binaire) ||
    permanentes.binaires.includes(binaire)
  if (general || nominale) return { autorise: true, binaire }
  return {
    autorise: false,
    binaire,
    motif: `${binaire} n'est pas autorisé — écris « autorise les commandes ${binaire} » pour l'ouvrir (l'autorisation vaut ensuite pour toutes les conversations)`
  }
}
