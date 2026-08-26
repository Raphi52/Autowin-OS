/**
 * LES MOTS QUE CE PRODUIT EMPLOIE POUR LA MEME CHOSE.
 *
 * La recherche multi-mots sur la racine rattrape les pluriels et les accords -- « pastilles »
 * trouve « pastille ». Elle ne rattrape pas les mots DIFFERENTS pour le meme objet : « badges » ne
 * trouvait jamais « pastilles », alors que c'est la meme chose a l'ecran, nommee autrement selon le
 * jour.
 *
 * C'est le cas le plus courant en pratique : personne ne retient la formulation exacte employee la
 * derniere fois. Une recherche qui l'exige demande a l'utilisateur de se souvenir de sa propre
 * phrase -- exactement ce qu'il vient chercher.
 *
 * CE QUE CE N'EST PAS, et il vaut mieux le dire que le laisser croire : un modele semantique. Ce
 * lexique nomme des familles VUES dans ce produit ; il ne devine pas un synonyme qu'on ne lui a pas
 * appris. Un index d'embeddings sur les 28 Mo du corpus, relu a chaque tour, a ete ecarte pour sa
 * latence et pour l'etat qu'il faudrait tenir a jour -- pas parce qu'il serait moins bon.
 *
 * POUR L'ETENDRE : ajouter une ligne ici. Chaque famille est un ensemble de mots INTERCHANGEABLES
 * dans ce produit ; les relier trop largement ferait remonter tout le corpus, ce qui n'est plus
 * chercher.
 */
const FAMILLES: string[][] = [
  // L'indicateur de couleur a cote d'une conversation, nomme de cinq facons dans les memes semaines.
  ['pastille', 'pastilles', 'badge', 'badges', 'puce', 'puces', 'indicateur', 'indicateurs'],
  // La copie de travail isolee : « bureau » cote interface, « worktree » cote git.
  ['bureau', 'bureaux', 'worktree', 'worktrees', 'copie'],
  // Le fil d'echanges.
  ['conversation', 'conversations', 'discussion', 'discussions', 'echange', 'echanges', 'fil'],
  // Ce qui prouve.
  ['test', 'tests', 'suite', 'preuve', 'preuves', 'signal'],
  // Le tour de travail autonome.
  ['run', 'runs', 'tour', 'tours', 'orchestration'],
  // Ce qui ne marche pas.
  ['bug', 'bugs', 'defaut', 'defauts', 'anomalie', 'anomalies', 'regression'],
  // Ce qui bloque.
  ['refus', 'refuse', 'blocage', 'bloque', 'interdit', 'deny'],
  // Le regard critique.
  ['juge', 'juges', 'audit', 'revue', 'review', 'relecture'],
  // Le savoir partage.
  ['brain', 'memoire', 'connaissance', 'savoir', 'fiche', 'fiches'],
  // L'agent delegue.
  ['agent', 'agents', 'sous-agent', 'delegation', 'deleguer']
]

/** Mot -> tous les mots de sa famille (lui compris). Construit une fois. */
const PAR_MOT = new Map<string, string[]>()
for (const famille of FAMILLES) {
  for (const mot of famille) PAR_MOT.set(mot, famille)
}

/**
 * Les autres facons de dire ce mot, ou rien.
 *
 * Rend la famille ENTIERE plutot que le mot seul : c'est l'appelant qui decide comment scorer, et
 * un mot appartenant a deux familles resterait ainsi visible dans les deux.
 */
export function memeFamille(mot: string): readonly string[] {
  return PAR_MOT.get(mot) ?? []
}
