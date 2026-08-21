import { parseOrderedPilotTokens } from './agent-pilot'

/**
 * Les OUTILS d'un nœud SKILL de workflow.
 *
 * Un nœud portant `think` ou `learn` recevait ses instructions — « appelle `brain_query` »,
 * « appelle `remember` » — sans disposer d'aucun de ces outils : l'orchestrateur fait un `send()`
 * UNIQUE par phase, sans boucle. Le nœud produisait donc un texte DÉCRIVANT ce qu'il ferait, pendant
 * que le graphe affichait une brique qui avait l'air d'avoir travaillé. C'est le même défaut qu'une
 * brique qui figure au dessin sans rien exécuter, une couche plus haut.
 *
 * Ce module donne le strict nécessaire, et rien de plus :
 *
 *  - Le PARSEUR n'est pas réécrit : `parseOrderedPilotTokens` est déjà exporté par `agent-pilot`.
 *    Deux parseurs du même protocole divergeraient, et c'est le genre d'écart qui ne se voit qu'en
 *    production.
 *  - Le CATALOGUE est une liste blanche de deux commandes. `orchestrate` en est absent
 *    DÉLIBÉRÉMENT : un nœud à l'intérieur d'un run capable de lancer un run est une récursion sans
 *    fond. Ce n'est pas un oubli à corriger un jour, c'est la garantie principale de ce module.
 *  - Rien ici ne COUPE un run. Commande refusée, bloc illisible, plafond atteint : on rend ce qu'on
 *    a, on le trace, et le run continue.
 *
 * « Lecture seule » qualifie le DÉPÔT, pas le Brain : un nœud skill ne peut ni modifier un fichier
 * ni lancer un build, mais déposer un fait au Brain est un acte d'une autre nature — réversible,
 * dédupliqué et mis en revue par le Brain lui-même.
 */

/** Ce qu'un nœud skill a le droit d'appeler. Toute autre commande est refusée et tracée. */
export const OUTILS_NOEUD_SKILL = ['brain_query', 'remember'] as const

/** Tours d'outils au maximum. Au-delà, on garde le dernier texte et on continue. */
export const TOURS_OUTILS_MAX = 2

/** La declaration d'une commande, telle que le bus la publie. */
export interface SpecCommandeSkill {
  name: string
  description: string
  args: Record<string, unknown>
}

/** Ce dont ce module a besoin du bus de commandes — volontairement minuscule. */
export interface LanceurCommandeSkill {
  exec(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>
  /**
   * Les specs REELLES des commandes autorisees. Absent = prompt sans liste d'arguments (degrade,
   * mais jamais faux) — voir `promptOutilsNoeudSkill`.
   */
  catalogue?(): SpecCommandeSkill[]
}

export interface AppelOutil {
  name: string
  args: Record<string, unknown>
  /** Refusé = hors liste blanche. L'appel n'a PAS eu lieu. */
  refuse: boolean
  ok?: boolean
  resultat?: unknown
  erreur?: string
}

/** Vrai si ce texte demande au moins un outil AUTORISÉ — sinon la boucle est un no-op sans coût. */
export function demandeUnOutil(texte: string): boolean {
  return parseOrderedPilotTokens(texte).some(
    (token) =>
      token.kind === 'command' && (OUTILS_NOEUD_SKILL as readonly string[]).includes(token.name)
  )
}

/**
 * Exécute les commandes AUTORISÉES trouvées dans la sortie d'un nœud skill.
 *
 * Une commande hors liste blanche n'est pas exécutée, mais elle est RENDUE avec `refuse: true` :
 * un refus silencieux ferait croire au modèle qu'il a agi — le pire défaut possible pour un agent,
 * et exactement ce que le parseur d'origine avait déjà corrigé de son côté.
 */
export async function executerOutilsDuNoeud(
  texte: string,
  lanceur: LanceurCommandeSkill
): Promise<AppelOutil[]> {
  const appels: AppelOutil[] = []
  for (const token of parseOrderedPilotTokens(texte)) {
    if (token.kind !== 'command') continue
    if (!(OUTILS_NOEUD_SKILL as readonly string[]).includes(token.name)) {
      appels.push({ name: token.name, args: token.args, refuse: true })
      continue
    }
    try {
      const resultat = await lanceur.exec(token.name, token.args)
      appels.push({
        name: token.name,
        args: token.args,
        refuse: false,
        ok: resultat.ok,
        resultat: resultat.data,
        ...(resultat.error ? { erreur: resultat.error } : {})
      })
    } catch (error) {
      // Un outil qui echoue est une information pour le modele, pas une raison d'arreter le run.
      appels.push({
        name: token.name,
        args: token.args,
        refuse: false,
        ok: false,
        erreur: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return appels
}

/** Borne d'un resultat reinjecte : un `brain_query` genereux noierait le tour suivant. */
const RESULTAT_MAX_CARACTERES = 4_000

/**
 * Le message rendu au modèle après exécution. C'est ce qui transforme un appel en BOUCLE : sans le
 * résultat, `brain_query` ne servirait à rien — un nœud `think` ne pourrait pas lire ce qu'il a
 * demandé.
 */
export function compteRenduDesOutils(appels: readonly AppelOutil[]): string {
  if (appels.length === 0) return ''
  const lignes = appels.map((appel) => {
    if (appel.refuse) {
      return `- \`${appel.name}\` : REFUSÉ — indisponible depuis un nœud de workflow. L'appel n'a pas eu lieu.`
    }
    if (!appel.ok) return `- \`${appel.name}\` : ÉCHEC — ${appel.erreur ?? 'raison inconnue'}`
    const brut =
      typeof appel.resultat === 'string' ? appel.resultat : JSON.stringify(appel.resultat ?? null)
    const borne =
      brut.length > RESULTAT_MAX_CARACTERES ? `${brut.slice(0, RESULTAT_MAX_CARACTERES)}…` : brut
    return `- \`${appel.name}\` : OK\n${borne}`
  })
  return `RÉSULTAT DE TES COMMANDES :\n${lignes.join('\n')}`
}

/**
 * Le prompt d'outillage d'un nœud skill, ENGENDRE depuis le catalogue reel.
 *
 * Volontairement distinct de `buildChatPilotagePrompt` : celui-la s'adresse a l'agent du CHAT
 * (« tu converses avec l'utilisateur », catalogue complet, reponses cliquables). Un nœud de
 * workflow ne converse avec personne et ne dispose que de deux commandes.
 *
 * POURQUOI ENGENDRE ET NON ECRIT A LA MAIN. La premiere version listait les arguments de memoire :
 * elle annoncait `brain_query {"query": ...}` quand la commande attend `question`, et `remember`
 * sans `scope` ni `source` alors que les deux sont OBLIGATOIRES. Consequence mesuree sur le run
 * reel `conv-1339` : le nœud a bien emis sa commande, le bus l'a bien recue, et elle est revenue
 * « question manquante ou invalide ». L'outil etait branche, teste, et inutilisable — parce que la
 * documentation que le modele lit ne decrivait pas la fonction qu'il appelle.
 *
 * Un prompt copie d'une spec ne peut plus diverger d'elle. Sans catalogue, on degrade en nommant
 * seulement les commandes : mieux vaut un prompt incomplet qu'un prompt FAUX.
 */
export function promptOutilsNoeudSkill(specs: readonly SpecCommandeSkill[] = []): string {
  const autorisees = specs.filter((s) => (OUTILS_NOEUD_SKILL as readonly string[]).includes(s.name))
  const lignes = autorisees.length
    ? autorisees.map((s) => {
        const args = Object.entries(s.args ?? {})
          .map(([nom, attendu]) => `    "${nom}" : ${String(attendu)}`)
          .join('\n')
        return `- ${s.name} — ${s.description}\n  args :\n${args || '    (aucun)'}`
      })
    : (OUTILS_NOEUD_SKILL as readonly string[]).map(
        (nom) => `- ${nom} (arguments non declares ici : lis le refus, il nomme ce qui manque)`
      )
  return (
    `\n=== OUTILS DISPONIBLES ===\n` +
    `Tu peux appeler des commandes de l'application au FORMAT EXACT : ` +
    `<cmd>{"name":"...","args":{...}}</cmd>. Tout texte hors commande est ton livrable.\n` +
    `Commandes autorisees ici, et AUCUNE autre :\n${lignes.join('\n')}\n` +
    `Ces memes commandes peuvent aussi t'etre servies comme OUTILS NATIFS, prefixes ` +
    `\`mcp__autowin__\` (par exemple \`mcp__autowin__brain_query\`). Si tu les vois dans tes outils, ` +
    `appelle-les NATIVEMENT — c'est le chemin fiable. Le format \`<cmd>\` reste valable et execute ` +
    `pour les modeles qui n'ont pas d'outils natifs : les DEUX chemins fonctionnent, aucun n'est un ` +
    `piege. C'est voulu : avant, un seul des deux etait branche, et le modele choisissait l'autre ` +
    `une fois sur deux.
` +
    `Respecte le nom EXACT de chaque argument ci-dessus. ` +
    `Le resultat de tes commandes t'est rendu, puis tu produis ton livrable. ` +
    `Tu disposes de ${TOURS_OUTILS_MAX} tours d'outils au maximum : au-dela, conclus avec ce que tu as.\n`
  )
}
