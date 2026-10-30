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
 * dessus. Depuis conv-1171 (2026-10-27), déposer LANCE le plan, sans clic d'accord : « je ne veux pas
 * avoir à confirmer, je veux que ça se lance tout seul ». La consigne le dit donc, coût compris.
 *
 * L'IMPASSE DES TÂCHES INDÉPENDANTES (kaizen de conv-1332, 2026-10-30, « tu aurais dû tout
 * paralléliser ») : cette règle les renvoyait à la carte des fils, que conv-1163 a retirée sauf
 * demande explicite. Résultat : deux tâches indépendantes ne pouvaient plus partir qu'en série.
 * Mesuré sur la saisie 1793348606693 de conv-1306 : deux tâches sans fichier commun, un seul tour de
 * 16 minutes et 5,88 $. Le plan part sans clic, donc le refus de la carte ne s'y oppose pas.
 */
export const CONSIGNE_PLAN_DE_LOTS =
  `UNE TÂCHE LONGUE → LANCE UN PLAN DE LOTS. Au moment où UNE demande d'action est un chantier ` +
  `qui se découpe en au moins TROIS parties sur des fichiers séparés (une refonte, « rends X ` +
  `parfait », une fonctionnalité qui touche à la fois le cœur, l'interface et les tests) et qu'un ` +
  `seul fil y passerait plusieurs tours, lance-le toi-même avec \`plan_de_lots\` (action ` +
  `« deposer ») au lieu de tout faire ici ou de lancer \`orchestrate\`. Même geste quand un message ` +
  `demande PLUSIEURS tâches d'action indépendantes, sur des fichiers séparés, dont chacune occuperait ` +
  `un tour entier : lance-les en parallèle avec \`plan_de_lots\`. Déposer LANCE le plan aussitôt, ` +
  `sans clic de l'utilisateur (il peut l'arrêter dans le tableau) : ne dépose qu'un plan prêt. Avant de déposer, une lecture ` +
  `ciblée (le même escalier que pour un symptôme) estime les fichiers de chaque lot ; un lot qui a ` +
  `besoin du RÉSULTAT d'un autre l'attend par « apres ». Donne un « contexte » commun (le but, les ` +
  `décisions et contraintes déjà prises) : le fil d'un lot ne sait RIEN d'autre que sa demande et ce ` +
  `contexte. Un lot simple part sur un modèle léger (« modele »: « haiku » ou « sonnet »). Pendant le ` +
  `plan, une nouvelle demande qui prolonge le chantier s'AJOUTE au plan (action « ajouter »), et une ` +
  `décision qui vaut pour les lots à venir se NOTE (action « noter »). Chaque lot coûte un tour : vise 3 à 8 lots, ` +
  `pas plus que le chantier n'en demande. Dis en une ligne pourquoi tu découpes et que les lots sont ` +
  `partis, puis rends la main : l'app te réveille à chaque fin de lot. AUCUN plan pour : une tâche qui tient en un ou deux fichiers, une correction ` +
  `ponctuelle, une question ou une analyse (RÈGLE PREMIÈRE), de petites tâches qui tiennent dans ce ` +
  `tour ou qui touchent les mêmes fichiers, un message qui demande de tout faire ici. Si ` +
  `l'utilisateur demande lui-même une « super conversation » ou un « plan de lots », lance-le.`
