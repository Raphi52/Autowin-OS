/**
 * QUAND PROPOSER UN PLAN DE LOTS (« super conversation », conv-1150) — servie par
 * `chat-pilotage-prompt.ts`, hors tour lecture seule et seulement si l'outil `plan_de_lots` est au
 * catalogue.
 *
 * Pourquoi (conv-1151, 2026-10-27) : la consigne du chat ne nommait nulle part `plan_de_lots` ; seule
 * la description de l'outil (`commands.ts`) disait CE QU'IL FAIT, jamais QUAND s'en servir. Résultat
 * mesuré : un plan ne naissait que si l'utilisateur le demandait en toutes lettres. La carte
 * ```aw-fils (`shared/lancer-en-fils.ts`) couvre l'autre cas — plusieurs demandes indépendantes de
 * l'utilisateur — et cette règle s'en distingue explicitement pour que les deux ne se marchent pas
 * dessus. Déposer ne coûte rien : rien ne part avant le clic « Lancer le plan ».
 */
export const CONSIGNE_PLAN_DE_LOTS =
  `UNE TÂCHE LONGUE → PROPOSE UN PLAN DE LOTS. Au moment où UNE demande d'action est un chantier ` +
  `qui se découpe en au moins TROIS parties sur des fichiers séparés (une refonte, « rends X ` +
  `parfait », une fonctionnalité qui touche à la fois le cœur, l'interface et les tests) et qu'un ` +
  `seul fil y passerait plusieurs tours, propose-le toi-même avec \`plan_de_lots\` (action ` +
  `« deposer ») au lieu de tout faire ici ou de lancer \`orchestrate\`. Déposer n'engage aucun coût : ` +
  `rien ne part avant que l'utilisateur clique « Lancer le plan ». Avant de déposer, une lecture ` +
  `ciblée (le même escalier que pour un symptôme) estime les fichiers de chaque lot ; un lot qui a ` +
  `besoin du RÉSULTAT d'un autre l'attend par « apres ». Chaque lot coûte un tour : vise 3 à 8 lots, ` +
  `pas plus que le chantier n'en demande. Dis en une ligne pourquoi tu découpes, puis rends la main ` +
  `sur le tableau. AUCUN plan pour : une tâche qui tient en un ou deux fichiers, une correction ` +
  `ponctuelle, une question ou une analyse (RÈGLE PREMIÈRE), plusieurs demandes indépendantes de ` +
  `l'utilisateur (c'est la carte des fils), un message qui demande de tout faire ici. Si ` +
  `l'utilisateur demande lui-même une « super conversation » ou un « plan de lots », dépose-le.`
