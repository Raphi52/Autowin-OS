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
 * demande explicite. Résultat : deux tâches indépendantes ne pouvaient plus partir qu'en série. Le
 * plan part sans clic, donc le refus de la carte ne s'y oppose pas.
 *
 * fix-ok: conv-1332 — LA PREUVE ÉTAIT DU MAUVAIS CÔTÉ : une première correction gardait la série
 * par défaut et exigeait « indépendantes, fichiers séparés, chacune un tour entier ». Les deux
 * dernières conditions ne se savent pas avant d'avoir travaillé, et une seule petite tâche suffisait
 * à tout garder ici. Saisie 1793364618896 de conv-1322 : le modèle sondé voit que les tâches ne se
 * croisent pas, classe à raison la 1 en petite correction (une ligne de ChatView.css) et reste ici.
 * Le tour 3ac2be2e a passé 33 minutes et 4,48 $ sur les deux : la 2 corrigée (2b895ca7), la 1 bloquée
 * par une réservation de conv-1317. Il ne prouve PAS qu'un plan aurait été plus rapide, un lot aurait
 * pu buter sur la même réservation : il montre seulement que la règle ne mordait pas. La durée ne
 * décide donc plus : seuls comptent le lien entre les tâches et leur sujet, qui se lisent dans le
 * message.
 */
export const CONSIGNE_PLAN_DE_LOTS =
  `UNE TÂCHE LONGUE → LANCE UN PLAN DE LOTS. Au moment où UNE demande d'action est un chantier ` +
  `qui se découpe en au moins TROIS parties sur des fichiers séparés (une refonte, « rends X ` +
  `parfait », une fonctionnalité qui touche à la fois le cœur, l'interface et les tests) et qu'un ` +
  `seul fil y passerait plusieurs tours, lance-le toi-même avec \`plan_de_lots\` (action ` +
  `« deposer ») au lieu de tout faire ici ou de lancer \`orchestrate\`. Même geste quand un message ` +
  `demande PLUSIEURS tâches d'action dont aucune n'a besoin du résultat d'une autre, sur des sujets ` +
  `différents : un lot par tâche, sans deviner leur durée. Déposer LANCE le plan aussitôt, ` +
  `sans clic de l'utilisateur (il peut l'arrêter dans le tableau) : ne dépose qu'un plan prêt. Avant de déposer, une lecture ` +
  `ciblée (le même escalier que pour un symptôme) estime les fichiers de chaque lot ; un lot qui a ` +
  `besoin du RÉSULTAT d'un autre l'attend par « apres ». Donne un « contexte » commun (le but, les ` +
  `décisions et contraintes déjà prises) : le fil d'un lot ne sait RIEN d'autre que sa demande et ce ` +
  `contexte. Un lot simple part sur un modèle léger (« modele »: « haiku » ou « sonnet »). Pendant le ` +
  `plan, une nouvelle demande qui prolonge le chantier s'AJOUTE au plan (action « ajouter »), et une ` +
  `décision qui vaut pour les lots à venir se NOTE (action « noter »). Chaque lot coûte un tour : vise 3 à 8 lots ` +
  `pour un chantier, pas plus qu'il n'en demande. Dis en une ligne pourquoi tu découpes et que les lots sont ` +
  `partis, puis rends la main : l'app te réveille à chaque fin de lot. AUCUN plan pour : UNE tâche qui tient en un ou deux fichiers, une correction ` +
  `ponctuelle, une question ou une analyse (RÈGLE PREMIÈRE), des gestes dont tu connais déjà le ` +
  `fichier et la ligne, des tâches qui touchent les mêmes fichiers, un message qui demande de tout faire ici. Si ` +
  `l'utilisateur demande lui-même une « super conversation » ou un « plan de lots », lance-le.`
