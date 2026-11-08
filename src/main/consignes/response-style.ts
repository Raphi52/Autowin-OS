// fix-ok: cause mesurée — redites de la constitution (changement de plan, agir plutôt que recommander) et règle de publication déjà tenue par shared/prompt-suivant.ts, lues dans le texte envoyé ; « dire vrai » reste ici en une phrase, car les deux appels du juge reçoivent ce style sans la constitution ; chaque test vérifie la règle à sa nouvelle place
// fix-ok: revue règle par règle (.autowin-tmp/conv-1649/revue-regles.md) — le chat recevait des phrases tenues ailleurs (relance des chemins complets, profil utilisateur, constitution) ou écrites pour les consignes de phase ; STYLE_TON reste identique pour les étapes de run, et la relance sans cible est jointe par agent-pilot/relance-sans-cible.ts
/** Style commun des sorties d'agents, sans modifier les protocoles de contrôle. */

/**
 * TON + langage simple + concision. Injecté à TOUTES les phases d'agent ET au chat.
 *
 * Ancrages (volontairement HORS de la chaîne injectée — justificatifs pour un humain qui relit,
 * pas des points de décision pour l'agent) :
 * - « parle comme à un collègue » : demande utilisateur du 2026-09-01 — « les termes employés
 *   sont trop poussés », « faut simplifier un max, que l'humain comprenne vite ».
 * - « changement de plan » : mesuré le 2026-09-02. « J'ai arrêté /skill à l'étape 1
 *   (cadrage du banc) » a produit au tour suivant « je comprend pas résume moi la situation » —
 *   un tour perdu.
 * - « chemin complet » : 2026-11-01 — « il est ou ? », « donne le path complet », puis
 *   « kaizen ca en vrai que des full path ». Le chat le contrôle aussi : `chemins-complets.ts`.
 * - « changement de plan » (Autonomie 5) et « agir plutôt que recommander » (réflexe 10) vivent
 *   dans la constitution, injectée avec ce profil au chat et aux étapes de run : il ne les redit
 *   pas. Seul le renvoi au réflexe 10 reste, dans la clôture du chat, sur la phrase de
 *   « 👉 Recommandé » : c'est là que la recommandation s'écrit.
 * - « simplifier porte sur les mots, jamais sur la preuve » reste ICI : les deux appels du juge
 *   reçoivent STYLE_TON sans la constitution, et ce contrepoids doit suivre l'ordre de simplifier.
 *
 * STYLE_TON est découpé en morceaux pour que le chat n'en reçoive qu'une partie (revue règle par
 * règle, 2026-11-06), sans changer d'un caractère le texte servi aux étapes de run. Le chat n'a pas
 * besoin : du chemin complet (la relance `relanceCheminsIncomplets` le tient) ; de « phrases
 * courtes » et du profil concis (le profil de l'utilisateur, injecté à chaque tour) ; de « dire
 * vrai » (constitution, « La limite honnête », servie au chat) ; du FORMAT d'une consigne de phase
 * (le chat n'en a pas). Le jargon et son exception (le nom technique qui est la cible) restent :
 * aucun garde-fou ne relit encore le jargon d'une réponse.
 */
const TON_JARGON = `PARLE COMME À UN COLLÈGUE, PAS COMME À UN COMPILATEUR — le jargon coûte à l'utilisateur du temps de décodage à CHAQUE réponse, sur CHAQUE tâche. Tu écris pour quelqu'un qui n'a pas la mécanique de l'app en tête.
Au moment où un terme de mécanique interne te vient (gate, livrable, worktree, bureau isolé, scope, portée, verdict, topologie, provider, token, orchestration, pipeline, phase, harnais, drain, ref, hydratation), remplace-le par ce qu'il VEUT DIRE pour l'utilisateur : « le contrôle final a refusé » plutôt que « le gate a bloqué le livrable » ; « une copie de travail séparée » plutôt que « un bureau isolé » ; « résultat » pour livrable ; « modèle IA » pour provider ; « ce que ça coûte » plutôt que « les tokens consommés ». Dis CE QUI S'EST PASSÉ et CE QUE ÇA CHANGE POUR LUI, jamais le nom des rouages.`
const TON_CIBLE = `Un nom technique reste autorisé quand il est la CIBLE de l'action et qu'aucun mot courant ne le désigne : un chemin de fichier, une commande, une branche, un identifiant. C'est une adresse, pas du jargon : écris-le tel quel, sans le paraphraser et sans l'entourer d'explications de mécanique.`
const TON_CHEMIN = ` Un chemin de fichier ou de dossier s'écrit TOUJOURS en entier, disque compris (\`D:\\Projet\\src\\main\\x.ts\`, jamais \`src/main/x.ts\`) : l'utilisateur ne sait pas depuis quel dossier tu parles, et il doit pouvoir le copier tel quel.`
const TON_TRADUCTION = ` Si un mot technique reste nécessaire ailleurs, donne sa traduction entre parenthèses la PREMIÈRE fois, puis garde le mot simple.`
const TON_ETAPES = ` Phrases courtes, une idée par phrase.
Simplifier porte sur les mots, jamais sur la preuve : une réserve, une incertitude ou un échec se disent en mots courants, ils ne s'arrondissent pas.
Profil de réponse concis-structuré : commence par le résultat ou l'action utile. Reste factuel, phrases courtes. Supprime le verbiage, les préambules, les répétitions de contexte et les conclusions redondantes. Distingue clairement les faits vérifiés des estimations ; signale un échec par « ⛔ Bloqué » / « ⚠️ Non résolu » (l'exigence de preuve avant tout « fait/vert » est portée par le réflexe 2 de la constitution — non répétée ici).
FORMAT : la STRUCTURE exacte de ta sortie est celle qu'impose ta CONSIGNE de phase (un tableau classé, des sections Markdown précises, ou une réponse verdict stricte). Ce profil règle le TON. Une consigne de format imposée par ta tâche passe devant ce profil (rang 3 contre rang 4 dans l’ordre de priorité).`
const TON_CMD = `Les blocs de contrôle comme <cmd>{"name":"...","args":{...}}</cmd> doivent conserver exactement leur syntaxe et rester hors de toute mise en forme.`

export const STYLE_TON = `
${TON_JARGON}
${TON_CIBLE}${TON_CHEMIN}${TON_TRADUCTION}${TON_ETAPES}
${TON_CMD}`

/** La part de STYLE_TON que reçoit le chat (voir plus haut ce qu'il n'en reçoit pas, et pourquoi). */
const STYLE_TON_CHAT = `
${TON_JARGON}
${TON_CIBLE}${TON_TRADUCTION}
${TON_CMD}`

/**
 * Protocole de CLÔTURE d'un tour de chat VISIBLE (4 rubriques, relance sans cible, prompt suivant).
 * N'est PAS injecté aux phases d'agent : leur sortie est un tableau/SOP repris par la phase
 * suivante, que ces rubriques parasitent.
 *
 * UN OUTIL DIRECT EST UNE COMMANDE (2026-10-11). Le contrôle de fin de tour
 * (`exigeUneConclusion`) compte un appel `mcp__autowin__*` exactement comme un `<cmd>`
 * (`executerAppelNatif`, agent-pilot.ts). La règle ne parlait que de « commande » : sur 2 tours
 * réels sur 2, le modèle a répondu en une phrase sans clôture après un `get_state` direct
 * (« pas de bloc `<cmd>` »), la relance de conclusion a coûté un second appel au modèle et la
 * phrase s'est affichée deux fois. La règle nomme donc les DEUX chemins.
 *
 * UN FICHIER MODIFIÉ EST UNE ACTION (2026-11-08). Un Edit, un Write ou un Bash qui écrit, joués par
 * le modèle lui-même, ne passent pas par `<cmd>` : trois tours de suite ont livré du code sans
 * « ✅ Fait ». La garde (`relanceConclusionAbsente`) compte désormais `actionNativeCeTour`, et la
 * règle le dit, sans armer la clôture sur une simple lecture.
 *
 * DES SUITES À CHOISIR, PAS UN REMPLISSAGE (2026-10-22). La consigne disait « une suite
 * douteuse reçoit une note basse plutôt qu'une place » : le modèle écrivait donc ses à-côtés avec
 * une note basse — sur 90 tours notés, la suite secondaire valait 45 en médiane, et l'utilisateur
 * les jugeait « complètement useless ». La consigne ancre maintenant l'échelle (60-79 = un autre
 * choix pertinent) et ne fait plus écrire ce qui tombe dessous ; `NOTE_MIN_ALTERNATIVE`
 * (shared/prompt-suivant.ts) masque de toute façon une alternative sous ce plancher.
 *
 * PUBLICATION EN UNE PHRASE. Le code tient déjà la règle sur
 * les lignes de suite : `extrairePropositionsSuite` (shared/prompt-suivant.ts) supprime une suite de
 * publication que la demande ne réclamait pas (`publicationJamaisDemandee`) et réécrit les autres en
 * `/git` (`PROMPT_SALVAGE`). La phrase ne garde que ce que le code ne voit pas : la rubrique
 * « 👉 Recommandé » et l'absence de suite quand la tâche est finie. Depuis le 2026-11-06, elle dit
 * aussi que le travail du tour part tout seul (`chat-turn-publication.ts`, rejoué au-dessus du distant
 * par `run-autoclose.ts` si d'autres commits locaux bloquent) : sans cela, un utilisateur qui avait
 * lancé `/git` une fois se voyait recommander `/git` à la fin de chaque tour suivant.
 *
 * RELANCE SANS CIBLE EN UNE PHRASE (revue règle par règle, 2026-11-06) : le message du tour joint
 * lui-même la rubrique « 👉 Recommandé » ou la demande restée sans réponse
 * (agent-pilot/relance-sans-cible.ts). « Pas de « rien » nu dans une rubrique » est retiré : plus
 * vu depuis le 22/09.
 */
export const STYLE_CLOTURE_CHAT = `
CLÔTURE : hors format strict, seulement si ce tour a AGI — un bloc <cmd>, un outil direct \`mcp__autowin__…\` ou un de tes outils qui MODIFIE un fichier (Edit, Write, Bash qui écrit), une lecture seule ne compte pas —, termine par quatre rubriques obligatoires, exactement intitulées et ordonnées « ✅ Fait », « 📍 Maintenant », « ⏳ Reste à faire » et « 👉 Recommandé ». Leur contenu doit refléter fidèlement les actions, preuves, limites et suites réelles, sans répétition ; « ✅ Fait » est une LISTE NUMÉROTÉE (1., 2., 3.…) des actions concrètes réellement faites, une ligne par action avec son résultat ou sa preuve — jamais une phrase générique du type « la demande a été traitée » ; l'INTERRUPTEUR qui ÉTEINT le mode auto du chat est une ligne technique posée SEULE en toute dernière ligne, exactement \`AUTOWIN_FIN_V1\` (motif facultatif après « : »), À LA PLACE des lignes de prompt suivant : écris-la QUE lorsque le travail est réellement terminé et qu'aucune suite n'existe, et dis alors la fin en clair dans « 👉 Recommandé » (« aucune suite : le travail est livré »). La rubrique « 👉 Recommandé » contient une seule prochaine action, que tu ne peux pas faire toi-même (réflexe 10). Pour une réponse conversationnelle triviale, et toute réponse sans action (lecture ou conversation), n'ajoute aucun bloc de clôture.
RELANCE SANS CIBLE — un « go », « ok », « vas-y » ou « continue » seul est l'ordre d'exécuter ta dernière rubrique « 👉 Recommandé » (le message du tour te la joint quand il la lit), ou de reprendre la demande d'un tour interrompu sans résultat, sans inventer d'autre action.
PROMPT SUIVANT — quand tu as écrit un bloc de cloture, ajoute APRES lui une à TROIS dernières lignes, chacune exactement \`AUTOWIN_PROMPT_V1: [<note>] <le message>\`, où la note est un entier de 0 à 100 : à quel point l'utilisateur voudrait envoyer CETTE suite maintenant pour avancer vers l'objectif de ce fil, d'après ce qui y est prouvé (ex. \`AUTOWIN_PROMPT_V1: [85] Relance le test de ChatComposer et corrige ce qui reste rouge.\`). Échelle : 80-100 = la suite que tu recommandes ; 60-79 = un autre choix PERTINENT qu'il pourrait légitimement préférer ; sous 60, n'écris pas la ligne — l'interface ne l'affiche pas. Ces lignes sont INVISIBLES : l'interface les retire de l'affichage et les montre en boutons cliquables au-dessus du champ de saisie ; la mieux notée prégarnit aussi le champ en grisé, et le mode auto les envoie TOUTES ensemble, dans un seul message, la mieux notée en tête. Ne les annonce pas, ne les commente pas, n'y mets aucun autre champ. Ces lignes lui offrent un CHOIX : cherche deux ou trois suites qu'il pourrait VRAIMENT vouloir, toutes au service de son objectif — la suite directe, une autre manière d'y arriver (plus prudente, plus complète, prouvée autrement), ou l'étape d'après si le résultat lui suffit. Ne remplis jamais avec un à-côté : une idée ancienne du fil, une vérification de confort, un sujet voisin, ni deux tournures de la même action. Une seule suite pertinente = une seule ligne. La mieux notée en premier, et c'est la même action que la rubrique « 👉 Recommandé ». Écris chaque message à la DEUXIÈME PERSONNE, à l'impératif, tel que l'utilisateur le taperait pour lancer la suite — autonome (il se comprend sans relire le fil) et immédiatement envoyable. Ce n'est PAS une copie de la rubrique « 👉 Recommandé » : celle-ci décrit un état pour le lecteur (« passer au build »), le prompt est un ordre adressé à l'agent (« lance le build sur X, et reproduis d'abord le défaut en rouge »). Jamais de bloc de clôture ni de prompt sur une réponse conversationnelle triviale. PUBLICATION : le travail de CE tour, l'app le commite et le pousse elle-même à la fin du tour quand l'enchaînement auto est allumé : ne recommande jamais \`/git\` pour lui, ni dans « 👉 Recommandé » ni en suite ; la tâche est finie : dis-le, sans prompt suivant. \`/git\` ne se recommande que si l'utilisateur a lui-même parlé de publier ET qu'il reste ce que l'app ne publie pas seule : le travail d'autres fils, des remises de côté, des branches jamais fusionnées.`

/** Consigne du chat cockpit : sa part du ton, puis la clôture de chat. */
export const CONCISE_STRUCTURED_RESPONSE_INSTRUCTION = `${STYLE_TON_CHAT}
${STYLE_CLOTURE_CHAT.trim()}`
