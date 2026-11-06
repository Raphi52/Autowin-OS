// Catalogue des commandes — conversations, retrospective, verdicts et travaux triés, état de l’app.
// Entrées sorties telles quelles de commands/catalogue.ts, dans le même ordre :
// catalogue.ts les remet bout à bout dans CATALOG. Seuls des TYPES viennent de '../commands'.
import type { CommandSpec } from './commands'
import { AIDE_ARGS_ETAT, LIMITE_MAX } from '../chat/etat-outil'
import { LISTE_DE_TEXTES, TRANCHE_MESSAGE_LU } from './catalogue-champs'

export const CATALOGUE_CONVERSATIONS: CommandSpec[] = [
  {
    name: 'create_conversation',
    description:
      'Créer une conversation. Le titre est celui que l’utilisateur a ÉCRIT — ne le reformule ' +
      'pas ; si tu ne le fournis pas, ses mots sont repris automatiquement. Un second appel ' +
      'identique dans les secondes qui suivent rend la conversation déjà créée (champ ' +
      '`reprise`) au lieu d’en créer une deuxième.',
    args: {
      title: 'titre — facultatif, les mots de l’utilisateur si omis',
      category: 'claude|codex'
    },
    argsFacultatifs: ['title'],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    /**
     * REGARDER son propre travail, sans avoir a le refaire.
     *
     * Defaut vecu (2026-08-26), second volet. Autowin collecte deja tout ce qu'il faut
     * pour une retrospective — conversation, activite, traces Brain, evenements causaux, RUN.md
     * natifs — en UN appel (`collectAutowinKaizenEvidence`). Mais ce dossier n'etait atteignable
     * que par une tache commencant par `/kaizen`, donc en LANCANT un run complet : couteux,
     * delegue, asynchrone.
     *
     * L'orchestrateur decide lui-meme s'il traite ou s'il delegue. Un agent qui doit deleguer POUR
     * S'INFORMER decide a l'aveugle : la seule facon de savoir lui coutait un run. Meme forme que
     * `conversation_read` avant le 18/08 — branche pour l'oeil et pour un pipeline, jamais pour le
     * modele qui decide.
     *
     * Lecture SEULE : regarder n'engage rien, et doit donc etre le geste le moins cher du catalogue.
     */
    name: 'retrospective',
    description:
      "Regarder ce qui s'est REELLEMENT passe dans une conversation : ses messages, l'activite de " +
      'ses tours, ses evenements causaux (outils appeles, refus, verdicts) et ses RUN.md. Appelle-le ' +
      "des qu'on te demande pourquoi un tour a echoue, ce qui a ete tente, ce qui a coute, ou avant " +
      'de relancer un travail deja tente : tu sauras ce qui a DEJA ete essaye au lieu de le refaire. ' +
      "C'est de la LECTURE — cela ne lance aucun run et ne coute aucun appel de modele.",
    args: {
      id: 'identifiant de la conversation a examiner (ex. « conv-1407 »)',
      page: 'numero de page du dossier (defaut 1) : le dossier est rendu par pages de ~20 000 caracteres, demande la suivante tant que `page` < `pages`'
    },
    argsFacultatifs: ['page'],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    /**
     * CHERCHER par contenu dans TOUTES les conversations.
     *
     * Defaut vecu le 2026-08-26. L'orchestrateur recoit « remake les pastilles de
     * couleurs » : quatre mots qui referent a un tour tenu dans une AUTRE conversation. Pour le
     * retrouver il lui fallait chercher par CONTENU dans le corpus -- or son catalogue n'offrait
     * cela que sur les FICHIERS du depot (`find_in_files`). `get_state` ne rend que des titres
     * tronques, et `conversation_read` exige un id connu d'avance : pour lire, il fallait deja
     * savoir OU lire.
     *
     * Il a donc cherche son propre besoin dans le CODE SOURCE : 20 inspections, zero conversation
     * lue, run arrete a 0,96 $. Meme forme que `list_files` et `classer_conversation` avant lui --
     * une capacite absente ne rend pas l'agent prudent, elle le pousse vers un chemin desespere.
     *
     * C'est la PORTE d'entree de `conversation_read` : celle-ci trouve l'id, celle-la ouvre.
     */
    name: 'conversation_search',
    description:
      'Chercher un mot ou une phrase dans le CONTENU de TOUTES les conversations, et recevoir les ' +
      'extraits qui le portent avec leur identifiant. Appelle-le des que la demande suppose un ' +
      'echange passe sans en donner l identifiant : « comme on avait dit », « reprends ce truc ' +
      'd hier », une demande courte qui refere a un tour precedent, une retrospective, ou quand tu ' +
      'ne sais plus de quoi parle la demande. Cherche ICI avant de fouiller le code : le code dit ' +
      'ce que l app FAIT, les conversations disent ce qui a ete DEMANDE. Les identifiants rendus ' +
      's ouvrent ensuite avec `conversation_read`. `restantes` dit ce qui n a pas ete rendu, ' +
      '`decalage` rend la suite.',
    args: {
      terme: 'mot ou phrase a chercher (insensible a la casse et aux accents)',
      limite: 'nombre maximum de conversations rendues (defaut 10, borne 50)',
      extraits: 'extraits par conversation (defaut 3, borne 20)',
      decalage:
        'nombre de conversations a sauter, les mieux classees d abord (defaut 0) : le resultat donne `restantes`, et la recherche s arrete aux 50 meilleures'
    },
    argsTypes: {
      limite: { type: 'integer', minimum: 1, maximum: 50 },
      extraits: { type: 'integer', minimum: 1, maximum: 20 },
      decalage: { type: 'integer', minimum: 0 }
    },
    argsFacultatifs: ['limite', 'extraits', 'decalage'],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    /**
     * Lire le CONTENU d'une autre conversation.
     *
     * Defaut vecu le 2026-08-18 : « scout en te basant sur la derniere conversation (cite-la) » a
     * recu « je ne peux pas citer honnetement le contenu de la conversation precedente ». L'agent
     * disait VRAI : `get_state` n'expose que des titres tronques, et le store sur disque avait 1h41
     * de retard (id max pour la demandee) — le contenu ne vivait qu'en memoire.
     * Autowin garde 31 modules de retrospective, exposes a l'INTERFACE par 9 canaux IPC et a l'agent
     * par AUCUN outil : la rétrospective etait branchee pour l'oeil, pas pour le modele qui analyse.
     *
     * Lit le store VIVANT (`os.conversations`), jamais le fichier : c'est la seule source a jour.
     *
     * Defaut vecu le 2026-10-19 : pour relire SON propre fil, l'agent a lance un
     * `node -e` sur `conversations.json`, n'y a pas trouve le fil (cree a 23:30, fichier ecrit a
     * 09:06), et a annonce a l'utilisateur que « le fichier sur disque a du retard » — formule
     * reprise de cette description. Le fil etait pourtant sur le disque, dans le journal : le
     * snapshot n'est reecrit qu'au demarrage ou quand le journal depasse 16 Mo
     * (`JOURNAL_MAX_BYTES`, store/conversations-disk.ts). La description dit donc OU vit un fil
     * recent, et que cet outil vaut aussi pour la conversation en cours.
     */
    name: 'conversation_read',
    description:
      "Lire le CONTENU REEL d'une conversation (ses messages) depuis l'etat vivant de l'app — une " +
      'autre, ou CELLE EN COURS. Appelle-le des que la demande cite une conversation : « la ' +
      "derniere conversation », « conv-1291 », « compare avec ce qu'on a dit hier », une " +
      "retrospective ou une analyse comparative. L'etat general n'expose que des titres tronques. " +
      "Un fil recent N'EST PAS dans `conversations.json` : chaque changement part d'abord dans " +
      "`conversations.json.journal.jsonl`, et le gros fichier n'est reecrit qu'au demarrage ou " +
      'au-dela de 16 Mo de journal. Ne lis donc JAMAIS un fil par `node -e` (ni grep) sur ' +
      '`conversations.json` : passe par cet outil. Ne reponds JAMAIS « je ne peux pas citer ' +
      'cette conversation » sans avoir appele cet outil. Chaque message porte sa `position` : ' +
      '`avant` remonte plus haut que les derniers messages, `message` lit un message coupe en entier.',
    args: {
      id: 'identifiant de la conversation (ex. « conv-1291 ») — `get_state` les liste',
      derniers: 'nombre de derniers messages a rendre (defaut 20, borne 200)',
      avant:
        'position : ne rendre que les messages AVANT elle, pour remonter le fil. Le resultat donne `restentAvant`, a repasser ici',
      message: `position d UN message a lire en entier, par tranches de ${TRANCHE_MESSAGE_LU} caracteres. Ne se combine ni avec derniers ni avec avant`,
      depuis:
        'avec `message` : caractere de depart (defaut 0). Le resultat donne `suite`, a repasser ici'
    },
    argsTypes: {
      derniers: { type: 'integer', minimum: 1, maximum: 200 },
      avant: { type: 'integer', minimum: 0 },
      message: { type: 'integer', minimum: 0 },
      depuis: { type: 'integer', minimum: 0 }
    },
    argsFacultatifs: ['derniers', 'avant', 'message', 'depuis'],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    /**
     * CLASSER une conversation — la capacite qui manquait, et son absence poussait au pire chemin.
     *
     * Demande de l'utilisateur : « ranges moi mes conversations dans des sous categories adequates ».
     * Mesure le 2026-08-15 : faute de commande pour classer, l'agent a tente de
     * piloter le BUREAU WINDOWS a la souris — `desktop_act`, clics qui ouvrent les reglages rapides
     * par erreur, tentative de relancer l'application — puis a echoue sur
     * « Type d'action desktop inconnu: double_click ». Rien n'a ete range.
     *
     * Le catalogue savait RENOMMER et SUPPRIMER une conversation, jamais la CLASSER, alors que
     * `conversations.rangerDansDossier` existait deja. Meme forme que `list_files` le meme jour : une
     * capacite absente ne rend pas l'agent prudent, elle le pousse vers un chemin desespere.
     *
     * La barre laterale groupe par DOSSIER (« Divers » = sans dossier) et indente les dossiers
     * enfants en sous-categories : classer, c'est donc affecter un chemin de dossier.
     */
    name: 'classer_conversation',
    description:
      "Classer une conversation dans la barre laterale. Un CHEMIN de dossier (ex. D:/GIT/ContosoApp) devient AUSSI le dossier de travail de la conversation, et le fil se range sous le nom de ce dossier ; les dossiers enfants s'indentent en sous-categories. Un LIBELLE libre (ex. « Perso ») ne cree qu'une categorie d'affichage et ne change PAS le dossier de travail. Vide = retirer du classement.",
    args: {
      id: 'identifiant de la conversation',
      dossier:
        'chemin du dossier de travail (ex. D:/GIT/ContosoApp), OU libelle de categorie (ex. « Perso ») ; vide pour declasser'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'rename_conversation',
    description:
      'Renommer une conversation. Rend { id, title } RELU apres coup — ne rejoue pas l appel : un id inconnu leve une erreur explicite.',
    args: { id: 'id', title: 'nouveau titre' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'remove_conversation',
    description:
      'Supprimer UNE conversation. Irreversible : ses messages et ses satellites disque (artefacts, trace causale, prompts) partent avec elle ; le tour ou le run qui y tourne est arrete avant. Id inconnu : `removed: false`, rien de touche. Pour plusieurs : remove_conversations.',
    args: { id: 'id' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'remove_conversations',
    description:
      'Supprimer un LOT de conversations NOMMEES par leurs ids (max 200). Irreversible : les satellites disque (artefacts, trace causale, prompts) partent aussi. Ids inconnus ignores, doublons dedupliques, aucune conversation non nommee touchee.',
    args: { ids: 'liste d ids, ex. ["conv-1","conv-2"]' },
    argsTypes: { ids: LISTE_DE_TEXTES },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'attach_run',
    description:
      'Attacher un RUN.md (workflow) existant à une conversation : il rejoint ses `runPaths`, donc son fil et son dossier `retrospective`. Ne lance et ne relance aucun run. Sans `conversationId` : la conversation courante.',
    args: { path: 'chemin du RUN.md', conversationId: 'id (optionnel, défaut = conv active)' },
    argsFacultatifs: ['conversationId'],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'load_graph',
    description:
      'Charger le graphe d’un Brain (300 notes au plus) et basculer l’écran de l’utilisateur sur sa vue mémoire. Rend seulement le nombre de nœuds et de liens : pour lire le savoir, passe par brain_query puis brain_read.',
    args: { brainId: 'id du brain' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'confirmer_verdict_juge',
    /*
     * LA VERITE HUMAINE, SEULE MESURE POSSIBLE DES FAUX-VERTS.
     *
     * trust.jsonl portait 186 verdicts tous de la forme {judgeModel, verdict} : aucun horodatage,
     * aucun rattachement, aucune confirmation. `calibration()` ignorant tout verdict sans
     * `humanTruth`, le taux de faux-verts etait structurellement incalculable. Ce geste est le
     * seul point d'entree de cette verite : il n'invente rien, il enregistre ce que l'humain dit.
     */
    description:
      'Enregistrer la VERITE HUMAINE sur les verdicts de juge d’un run : « c’était bon » (green) ' +
      'ou « c’était faux » (red). N’à appeler que sur demande EXPLICITE de l’utilisateur — c’est ' +
      'sa parole, jamais une auto-évaluation du modèle. Rend le nombre de verdicts ré-étiquetés.',
    args: {
      runId: 'identifiant du run jugé',
      verite: '"green" (le verdict était juste) ou "red" (le verdict était faux)'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'marquer_travail_trie',
    /*
     * LE GESTE QUI MANQUAIT AU BOUT DU SALVAGE.
     *
     * Vecu le 2026-08-27 : le bandeau annonce des travaux non publies, « Traiter »
     * lance un `/salvage`, le salvage conclut deux fois « SUPERSEDED — deja dans main sous une
     * meilleure implementation », conserve les branches comme le protocole l'exige, et le bandeau
     * repasse identique trente secondes plus tard. `git cherry` ne voit pas une REECRITURE, donc
     * l'inventaire criait a jamais et l'utilisateur n'avait aucun moyen de refermer.
     */
    description:
      'Enregistrer qu’un travail non publié a été TRIÉ : déjà repris dans la base sous une autre ' +
      'forme, fusionné à la main, ou abandonné en connaissance de cause. NE SUPPRIME RIEN — la ' +
      'branche de secours reste le seul endroit où ce travail existe. Le marquage porte le SHA ' +
      'jugé : si le travail reprend sur la même branche, il ressort de lui-même. À n’appeler ' +
      'qu’APRÈS un diagnostic par contenu, jamais pour faire taire une liste qu’on n’a pas lue.',
    args: {
      agentId: 'identifiant du travail, tel que `get_state.travauxNonPublies` le nomme',
      oublier: 'true pour RETIRER le marquage et faire ressortir le travail (optionnel)'
    },
    argsTypes: { oublier: { type: 'boolean' } },
    argsFacultatifs: ['oublier'],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'marquer_travaux_tries',
    /*
     * LE MEME GESTE, MAIS PAR LOT.
     *
     * Trace causale au 2026-09-12 : 225 appels a `marquer_travail_trie` sur 94 tours, dont un tour
     * a 23 appels. Chaque appel etait un aller-retour modele complet pour une ecriture d'une ligne.
     * Le lot suit `remove_conversations` : ids inconnus IGNORES (et rendus), doublons dedupliques,
     * compte rendu par identifiant — sans quoi un seul id perime annulerait tout le reste.
     */
    description:
      'Enregistrer par LOT que des travaux non publiés ont été TRIÉS (max 200). NE SUPPRIME RIEN — ' +
      'les branches de secours restent. Ids inconnus ignorés et rendus dans `introuvables`, ' +
      'doublons dédupliqués. À n’appeler qu’APRÈS un diagnostic par contenu de CHAQUE travail, ' +
      'jamais pour faire taire une liste qu’on n’a pas lue.',
    args: { ids: 'liste d identifiants, ex. ["agent-a","agent-b"]' },
    argsTypes: { ids: LISTE_DE_TEXTES },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'get_state',
    // La donnee ne sert que si l'agent sait qu'elle existe : sans cette phrase, il continue de
    // deduire la recence de l'ordre du tableau au lieu de lire les dates.
    // 2026-10-31 : 187 000 caractères, coupés à 120 000, 6 appels sur 6 tronqués et aucun
    // argument pour rétrécir. Vue courte par défaut, `etat-outil.ts`.
    description:
      'Lire l’état courant de l’app. Sans argument : vue courte (onglet, conversation active, ' +
      `compteurs, runs bloqués, \`travauxNonPublies\` en entier, les 20 conversations les plus récentes). ` +
      `\`conversation\` cherche un titre ou un id ; \`limite\` en rend davantage (maximum ${LIMITE_MAX}) ; ` +
      '`sections` choisit des clés précises, ou `tout` pour l’état entier (plus de 100 000 caractères, ' +
      'tronqué). `updatedAt` = dernière touche, y compris par un agent ; `lastUserMessageAt` = ' +
      'dernier tour de l’utilisateur : pour « la dernière conversation », c’est lui qui compte. ' +
      '`travauxNonPublies` liste les travaux de runs terminés qui n’ont JAMAIS rejoint la base, ' +
      'avec leurs fichiers : consulte-le avant de répondre « rien à fusionner » — un `git status` ' +
      'dans l’arbre principal ne les voit pas, ils vivent dans leur propre copie isolée.',
    args: AIDE_ARGS_ETAT,
    argsTypes: { limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAX } },
    // Relecture PURE de l'etat en memoire : rien n'est ecrit, rien n'est appele au dehors. Sans
    // cette declaration, le recu d'autorite la classerait « mutante » par prudence (defaut de
    // `authority-receipt-trace.ts`) et Observatory afficherait une mutation qui n'a pas lieu.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
]
