/**
 * LE VOCABULAIRE MAISON D'AUTOWIN, pour un modèle qui ne voit QUE la phrase de l'utilisateur
 * (kaizen conv-1266, 2026-10-29).
 *
 * Mesure : conv-1263, tour 60eda4d2-c6e0-491d-8b34-116257bf3766. « ce jeu est un 1/10 je veux un
 * 10/10 fais une super conv pour faire ca » a été relu par le petit modèle (claude-haiku-5-5, appel
 * `deuxLectures` de `cost.jsonl`, 2026-10-29T09:04:15Z) comme « Rendre le jeu 10/10 en améliorant
 * ses dialogues : une grande conversation (dialogues, personnages) ». Ligne affichée à
 * l'utilisateur et remise au modèle du chat ; l'utilisateur a coupé le tour pour répondre « pk tu me
 * parles de dialogue? ya meme pas de dialogue normalement dans le jeu » (saisie ts 1793264717170).
 * Rejeu hors app, même modèle, même consigne : 3 lectures sur 3 sans aucun plan de lots
 * (« un brief complet », « une excellente consigne »), dont une à 50/50 qui aurait posé la question.
 *
 * Cause : la consigne de ce modèle disait « un agent de développement », jamais Autowin, et la
 * charge ne porte que les commandes `/nom` citées. Les mots d'Autowin qui ne sont pas des commandes
 * (« super conv » = plan de lots, conv-1150) arrivaient sans leur sens, et une phrase sur un jeu les
 * rabattait sur le jeu. Le modèle du chat, lui, les connaît par sa consigne
 * (`consigne-plan-de-lots.ts`).
 *
 * Un texte STABLE (le cache de la consigne en dépend), à joindre à la consigne d'un petit modèle qui
 * lit une demande. Il ne nomme que des objets d'Autowin qu'un humain tape vraiment.
 */
export const VOCABULAIRE_AUTOWIN = [
  "L'agent travaille DANS Autowin OS, l'application où l'utilisateur pilote des agents par des",
  'conversations. Dans sa bouche, ces mots désignent d’abord des objets d’Autowin, pas de son projet :',
  '- « conv », « conversation », « fil » : une conversation de travail avec un agent dans Autowin.',
  '  Elle se désigne par son numéro (« conv 1263 », « la 1263 »), et un numéro seul en tête de',
  '  message (« 1256 pk … ») désigne souvent une de ces conversations.',
  '- « super conv », « super conversation », « plan de lots » : un fil chef qui découpe un gros',
  '  chantier en lots, chacun traité par un agent dans son propre fil, puis suivi par l’app.',
  '- « lot » : une partie d’un tel plan ; « run » : un travail lancé par étapes (cadrage, travail,',
  '  contrôle) ; « le Brain » : la mémoire partagée des agents.',
  'Quand la demande applique ces mots à son projet (« une conversation entre deux personnages »,',
  '« des lots de 500 lignes »), c’est le sens courant qui vaut, sans autre lecture Autowin.'
].join('\n')
