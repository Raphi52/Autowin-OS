/**
 * UNE RELANCE SANS OBJET — « reprend », « go », « lancer terrain. » : le message ne nomme pas ce
 * qu'il faut faire, il renvoie au sujet discute juste avant.
 *
 * DEFAUT MESURE le 2026-10-14. `orchestrate` (commands.ts) prend le dernier message de
 * l'utilisateur comme objectif du run, et n'y ajoutait la cible du pilote que pour une liste codee
 * en dur : « vas-y », « go », « fais ça », « finis ça ». Or les saisies reelles
 * (saisies-utilisateur.jsonl) comptent « reprend » 90 fois, « reprendre » 9, « vazy » 9,
 * « finis » 5, « lance le », « relance le » et « lancer terrain. » 3 fois chacun. Resultat : 30
 * RUN.md avaient pour objectif « reprend » et 23 « lancer terrain. », sans un mot du sujet — et le
 * dossier « reprend-… » faisait rouvrir un run ouvert d'un AUTRE sujet, puisque la reutilisation
 * apparie sur le texte de la tache (`reuseOrCreateConvRun`).
 *
 * LE SENS DE L'ERREUR TOLEREE. Une relance reconnue ne PERD rien : l'appelant garde le message tel
 * quel et lui AJOUTE la cible du pilote. Un faux positif coute une ligne de contexte en trop, un
 * faux negatif coute la cible. Les motifs restent pourtant ANCRES des deux cotes : un message qui
 * nomme son objet (« reprends le decoupage de index.ts », « lance le terrain sur arena-audit »,
 * « ok pardon reprend : ajouter /ingest ») n'est pas une relance et reste seul maitre du run.
 */

/**
 * Le marqueur qui separe la relance de la cible du pilote dans l'objectif du run :
 * `<relance>\n\nCIBLE CONTEXTUALISEE : <cible>` (commands.ts). `slugify` (conv-runs.ts) le retire
 * du nom de dossier — d'ou la constante unique : un marqueur renomme d'un seul cote reviendrait
 * dans les libelles sans qu'aucun test ne le voie.
 */
export const MARQUEUR_CIBLE_CONTEXTUALISEE = 'CIBLE CONTEXTUALISEE :'

/** Les mots qui acceptent ou relancent sans rien nommer. Compares sur la forme repliee. */
const MOT_DE_RELANCE =
  "(?:go|ok|okay|oki|oui|ouais|yes|vas[- ]?y|vazy|continue[sz]?|continuer|poursuis|poursuivre|reprends?|reprendre|recommence|relance[rz]?|fai[st][- ](?:le|la|ca|tout)|d'?accord|dac|c'?est parti|on y va|allez|finis?|finir)"

/** Ce qui s'ajoute a une relance sans lui donner d'objet (« reprend pardon », « ok go stp »). */
const REMPLISSAGE = '(?:pardon|stp|svp|merci|alors|bon|bah|ben|maintenant|donc|please)'

const SEPARATEUR = '[\\s,]+'

const MOTIFS: readonly RegExp[] = [
  // Un ou plusieurs mots de relance, eventuellement accompagnes de remplissage.
  new RegExp(
    `^(?:${REMPLISSAGE}${SEPARATEUR})*${MOT_DE_RELANCE}(?:${SEPARATEUR}(?:${MOT_DE_RELANCE}|${REMPLISSAGE}))*$`
  ),
  // « lance le », « relance la suite », « lancer terrain », « lancer la phase suivante » : une
  // phase ou un pronom, jamais un objet.
  /^(?:re)?lance[rz]?(?:\s+(?:le|la|l'|ca|ceci|cela))?(?:\s*(?:(?:la\s+)?(?:phase|etape)\s+)?(?:\/?(?:scout|frame|cadrage|terrain|build|clean|judge|juge)|suivante|suite))?$/,
  // Les formules vagues reconnues avant 2026-10-14 (conv-1265) : « fais un truc parfait »…
  /^(?:(?:fais|fait)\s+)?(?:ca|ceci|cela|un truc|le truc)(?:\s+(?:bien|parfait|parfaitement))?$/,
  /^fais ce qu'il faut pour que (?:ca|ceci|cela)(?: se)? fasse (?:ca|ceci|cela) la prochaine fois$/,
  /^finis? (?:ca|ceci|cela)(?: une bonne fois pour toutes)?$/,
  // La suite que propose l'arret d'un run (orchestration-outcome.ts) : « reprendre le travail
  // arrete — corriger la cause nommee ci-dessus, puis relancer la meme demande ». Elle renvoie a
  // un sujet qu'elle ne nomme pas.
  /^reprend(?:re|s)? le travail arrete\b.*\b(?:ci-dessus|meme demande)\b/
]

/** Forme repliee : sans accents, en minuscules, apostrophes unifiees, ponctuation finale retiree. */
function replier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’ʼ]/gu, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s>*•\-–—]+/u, '')
    .replace(/[\s.!?…;:]+$/u, '')
    .trim()
}

/** Vrai si le message relance sans nommer son objet : la cible doit venir du contexte. */
export function estRelanceSansObjet(texte: string): boolean {
  const replie = replier(texte)
  if (!replie) return false
  return MOTIFS.some((motif) => motif.test(replie))
}
