// Catalogue des commandes — commandes, redémarrage, vérification, mémoire, Brain, skills, tâches, SQL et fiches.
// Entrées sorties telles quelles de commands/catalogue.ts, dans le même ordre :
// catalogue.ts les remet bout à bout dans CATALOG. Seuls des TYPES viennent de '../commands'.
import type { CommandSpec } from './commands'
import { MODELE_PROMPT_TACHE_COURT } from '../../shared/modele-prompt-tache'
import { PROFIL_UTILISATEUR_MAX_BYTES } from '../profil/profil-utilisateur'
import { CHAMPS_DE_TACHE } from './catalogue-champs'

export const CATALOGUE_APP_ET_SAVOIR: CommandSpec[] = [
  {
    name: 'run',
    /*
     * LA COMMANDE QUE L'UTILISATEUR AUTORISE — la reponse a un defaut vecu, rapporte le 2026-08-26
     * apres des SEMAINES : « Autorise les commandes git » ecrit dans le chat, et l'agent repond que
     * cette autorisation « ne leve pas le garde d'execution de son outil Bash ».
     *
     * Il n'y avait aucun garde. Il n'y avait aucune capacite : ce catalogue exposait 26 commandes,
     * aucune n'etait un shell, et `verify` ne laisse passer aucun parametre du modele. L'agent a
     * donc INVENTE une permission manquante pour expliquer une commande absente — et a envoye
     * l'utilisateur chercher pendant des semaines un reglage qui n'existait pas.
     *
     * Ce qui borne cette ouverture n'est plus « le modele ne choisit jamais » mais une autorisation
     * REELLE : refus par defaut, par BINAIRE, ecrite par l'UTILISATEUR dans le fil, et lue cote
     * principal (`autorisation-commande.ts`). Le modele ne peut pas se l'accorder — ses propres
     * messages ne sont jamais consultes, et un test de cablage le verrouille.
     */
    description:
      "Lancer une commande. Tous les binaires sont autorisés D'OFFICE : lance-les directement, ne demande JAMAIS d'autorisation et ne demande jamais à l'utilisateur d'écrire une phrase pour te débloquer. Seule limite : un seul programme à la fois — les enchaînements (`&&`, `|`, `;`) sont refusés, découpe-les en appels successifs",
    args: {
      commande:
        'la ligne à lancer, un seul programme et ses arguments (ex. `git status --porcelain`). ' +
        'Aucun opérateur de shell : `a && b`, `a | b`, `a ; b`, redirections et sous-shells sont REFUSÉS — ' +
        'découper en appels successifs. Contre-exemple refusé : `powershell -c "ls; pwd"` → deux appels séparés.'
    }
  },
  {
    name: 'restart_app',
    /*
     * REDEMARRER SANS PERDRE LA TACHE.
     *
     * Certains travaux exigent un redemarrage du process principal (code de `src/main` modifie,
     * variable non rechargeable a chaud, dependance native). Jusqu'ici l'agent n'avait aucune
     * capacite pour ca : il rendait la main en demandant a l'utilisateur de relancer l'app — et la
     * tache mourait avec le process. La consigne de reprise est donc ECRITE SUR LE DISQUE avant le
     * `quit`, puis rejouee UNE SEULE FOIS au demarrage suivant (`redemarrage-reprise.ts`).
     */
    description:
      'Redémarrer Autowin OS (mode dev : relance par le lanceur officiel) et REPRENDRE la tâche ' +
      'ensuite. La `consigne` est réécrite sur le disque avant la fermeture puis renvoyée toute ' +
      'seule dans cette conversation au redémarrage — rédige-la comme un ordre autonome, elle sera ' +
      'lue sans le fil courant. À n’utiliser QUE lorsqu’un redémarrage est réellement nécessaire ' +
      '(code du process principal modifié, variable non rechargeable par `reload_env`). Si d’autres ' +
      'conversations ou des runs tournent, le redémarrage est MIS EN FILE (`enFile: true`) : il part ' +
      'tout seul quand plus aucun agent ne tourne, après un préavis — personne n’est coupé, ne ' +
      'demande donc pas à l’utilisateur s’il faut attendre. Sinon l’app redémarre tout de suite.',
    args: {
      consigne: 'la consigne autonome à rejouer après le redémarrage (obligatoire)',
      raison: 'facultatif — pourquoi le redémarrage est nécessaire (trace lisible)'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'reload_env',
    description:
      'Recharger À CHAUD, dans le processus principal, une variable d’environnement déjà persistée par l’utilisateur (setx / variables système) — sans redémarrer l’app. La valeur vient de l’OS, jamais du modèle. Seules les variables de réglage Autowin sont rechargeables (ex. `AUTOWIN_VERIFY_TIMEOUT_MS`, le plafond de `verify`)',
    args: {
      nom: 'le nom exact de la variable à recharger (ex. `AUTOWIN_VERIFY_TIMEOUT_MS`)'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'verify',
    /*
     * Le modele ne choisit JAMAIS la commande -- seulement, s'il le souhaite, la CIBLE.
     *
     * Vecu le 2026-08-25 : un agent devait prouver UN fichier de test. Sans argument, `verify`
     * rejouait la suite entiere, plafonnee a 600 s, qu'elle depasse -- quatre tentatives, quatre
     * refus. Faute de pouvoir executer, il a diagnostique par lecture statique et affirme un defaut
     * « certain » que l'execution a ensuite refute.
     *
     * La frontiere ne bouge pas pour autant : `cibleDeVerification` valide le chemin (relatif, dans
     * le depot, hors `.git`, fichier de TEST, existant, sans joker) et l'argv est construit ici,
     * `shell: false`, arguments separes. Donner Bash aurait ete l'autre voie : mesuree sur le vrai
     * binaire, `--allowedTools "Bash(npm test)"` ne restreint RIEN.
     */
    description:
      'Rejouer une vérification déclarée par le projet et rendre son exit code — la seule façon de prouver « vert ». `type: test` (défaut) rejoue les tests ; `type: typecheck` rejoue le typage et `type: lint` le lint, deux preuves rapides que la suite de tests ne donne PAS. Une CIBLE optionnelle (un fichier de test du dépôt) restreint les TESTS à ce seul fichier : quelques secondes au lieu de la suite entière',
    args: {
      type: 'facultatif — `test` (défaut), `typecheck` ou `lint`. Un typage rouge se voit en quelques dizaines de secondes, sans jouer un seul test',
      cible:
        'facultatif — UN fichier de test du dépôt (chemin relatif, ex. `src/main/x.test.ts`). Absent = suite complète. Ignoré si `type` n’est pas `test`'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      // Faux depuis que les annotations sont publiées : `idempotentHint` autorise le client
      // à rejouer un appel coupé, et le premier `verify` n'est pas annulé. Deux suites tourneraient.
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'remember',
    description:
      'Retenir DURABLEMENT un fait vérifié ou proposer UNE SEULE LEÇON réutilisable issue du succès ou de l’échec du run courant. Dépose d’abord un candidat Brain ; Autowin ne le publie seul que si les preuves causales externes sont fortes, sinon il reste en revue. Pas pour un statut brut, une auto-évaluation, une règle de comportement ni ce qui ne vaut que ce tour-ci',
    args: {
      title: 'titre court et retrouvable',
      fact: 'le fait, autoporté — compréhensible dans 3 mois sans cette conversation',
      type: 'lesson | decision | preference | domain',
      scope: 'le projet concerné, ou « global » (absent = le projet courant)',
      // Les FORMES viennent de la validation reelle du Brain, decouverte par un essai live : le serveur
      // ne verifie pas un prefixe, il verifie que le locator est VERIFIABLE. Sans ces formes, le modele
      // produisait des candidats refuses (`file:src/…` relatif -> refuse, le serveur cherche le fichier
      // depuis SA racine).
      source:
        'sa provenance VÉRIFIABLE. Dans un run Autowin : session:current (résolu vers ce tour). Pour un fait de code hors run : git:<chemin>@<sha> (ex. git:src/main/x.ts@9218eaf). Autres formes : url:https://… | ticket:ABC-123 | session:<id> | email:qui@ex.fr | meeting:AAAA-MM-JJ | file:<chemin ABSOLU existant>',
      learningOutcome:
        'facultatif — success | failure seulement pour une leçon issue du run courant. Pour failure, le fait contient exactement les sections Tentative:, Symptôme:, Cause (prouvée): ou Cause (hypothèse):, Prochaine stratégie:. Décrit le sujet, jamais sa preuve',
      runId:
        'facultatif — identité exacte renvoyée par orchestrate, pour lier la leçon à ses preuves (absent = la dernière issue de ce tour)',
      tags: 'facultatif — quelques mots-clés',
      confidence: 'facultatif — low | medium | high',
      supersedes:
        'facultatif — uid(s) des notes que ce fait REMPLACE (lus via brain_read) ; la note ancienne ne passe « remplacée » qu’à la revue',
      // 2026-10-28 : deux Brains, et c'est l'agent qui range (choix de l'utilisateur).
      portee:
        'equipe | perso — OÙ ranger le fait. equipe : il touche un projet, un outil ou un système de l’équipe. perso : tout le reste (notes personnelles, projets perso, vie hors équipe) — privé, jamais partagé. Défaut : equipe. Dis ensuite en une ligne où tu l’as rangé (champ `rangement` du résultat)'
    },
    // `scope` est rempli depuis le projet (`rememberFact`), `portee` vaut `equipe` par
    // défaut et `runId` se déduit de l'issue du tour. Les exiger coûtait un refus pour rien.
    argsFacultatifs: [
      'scope',
      'learningOutcome',
      'runId',
      'tags',
      'confidence',
      'supersedes',
      'portee'
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  // PROFIL UTILISATEUR : le plafond est tenu par `profil-utilisateur.ts`, hors du modèle.
  {
    name: 'profil_ajouter',
    description:
      'Noter un goût PERSONNEL que l’utilisateur vient d’énoncer (ton, format, langue, habitude de travail) dans SON profil local, relu en entier en tête de chaque tour. Pas pour une règle d’équipe (→ remember), une leçon ni un fait. ' +
      `Plafond de ${PROFIL_UTILISATEUR_MAX_BYTES} octets : un ajout qui le dépasse est REFUSÉ et rien n’est écrit — dis-le à l’utilisateur et propose de retirer une entrée`,
    args: { preference: 'la préférence, en une phrase courte' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'profil_retirer',
    description:
      'Retirer une entrée du profil local de l’utilisateur : quand il la révoque, ou pour faire de la place quand le profil est plein',
    args: {
      preference: 'le texte exact de l’entrée, tel qu’il figure dans le bloc PROFIL UTILISATEUR'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'ask',
    horsCanalNatif:
      'une question clôt le tour et une seule est permise par tour — ces règles ne vivent que sur le chemin texte',
    description:
      "Poser une QUESTION a l'utilisateur avec des reponses cliquables — a utiliser quand une " +
      'decision lui appartient vraiment (un choix entre approches, une autorisation) plutot que de ' +
      'terminer par une question en prose, qui l’oblige a retaper sa reponse. ATTENTION : `ask` ' +
      'CLOT TON TOUR, tu ne reprends pas la main apres — ce que l’utilisateur doit voir pour ' +
      'choisir (maquettes, comparaison) va EN ENTIER dans le MEME message, jamais « a suivre ». ' +
      'Jamais pour choisir entre les propositions d’un /draft : ce choix passe par les boutons de ' +
      'son bloc (scripts/draft-carrousel.mjs)',
    args: {
      question: 'la question, en une phrase',
      options:
        'les reponses proposees (2 a 10). Chacune est un objet : { libelle } court (une poignee de ' +
        'mots, PAS une phrase portant le raisonnement), { consequence } en une ligne, ' +
        '{ recommande: true } sur celle que tu recommandes (une seule), et facultativement ' +
        '{ detail: { fait, touche, neReglePas } } — ce que ca fait, ce que ca touche, ce que ca ne ' +
        'regle PAS. { envoi } remplace le libelle dans le prompt renvoye au clic. Une chaine nue ' +
        'reste acceptee mais donne un bloc sans consequence ni detail.',
      choixMultiple:
        'facultatif — `true` si la question accepte PLUSIEURS reponses a la fois : on coche ' +
        'celles qui conviennent puis on envoie. Defaut : un choix exclusif.'
    },
    annotations: {
      // Elle n'ecrit rien : elle AFFICHE des choix. Ce que l'utilisateur clique repart comme un
      // prompt ordinaire, donc l'action reelle passe par le chemin normal et ses autorisations.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'brain_query',
    description:
      'Interroger le savoir curé du Brain (décisions, leçons, contraintes déjà établies) — à préférer à une exploration du repo quand la question porte sur un acquis. Rend la LISTE des notes candidates (titre, chemin, taille), sans contenu ; une longue liste arrive réduite par le modèle des petites tâches aux 3 à 8 notes utiles à ta question (entier: true = liste complète). Ouvre ensuite avec brain_read celles qui servent ta tâche',
    args: {
      question: 'la question, en langage naturel',
      entier: 'facultatif — true pour la liste complète, sans le filtre du petit modèle'
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'brain_graph',
    description:
      'Suivre les liens entre notes du Brain : « quelles notes renvoient vers X » (dependents) ou « vers quoi X renvoie » (dependencies). Pour retrouver les notes liées à une décision ou une contrainte',
    args: {
      entity: 'identifiant exact, nom de note ou chemin knowledge/…md',
      direction: 'facultatif — dependents (défaut) | dependencies',
      depth: 'facultatif — 1 à 3, défaut 1',
      relation: 'facultatif — ne suivre qu’une relation (ex. links_to)'
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'brain_read',
    description:
      'Ouvrir une note curée du Brain nommée par brain_query ou brain_graph. Une note longue revient CONDENSÉE par le modèle des petites tâches sur ton besoin (conv-1469) ; entier: true rend la note brute, nécessaire pour la remplacer via remember (supersedes)',
    args: {
      path: 'chemin de la note, knowledge/…/nom.md — garde le préfixe perso: d’une note du Brain perso',
      besoin: 'ce que tu cherches dans cette note, en une phrase — sert au condensé',
      entier: 'facultatif — true pour la note brute, sans condensé'
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    // Le modèle choisit lui-même une skill : voir `skill-charger-command.ts`.
    name: 'skill_charger',
    description:
      'Charger la PROCÉDURE complète d’une skill d’Autowin (skills/<nom>/SKILL.md) que TU choisis d’appliquer, sans que l’utilisateur l’ait tapée — dès que sa demande correspond au déclencheur d’une skill listée dans skillsDisponibles. Rend le contenu à suivre et le dossier de ses fichiers compagnons. Inutile si cette procédure est déjà dans ton contexte (bloc « === SKILL <NOM> (kit) === »)',
    args: { nom: 'nom de la skill, tel que listé dans skillsDisponibles (ex. look)' },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'ticket_create',
    description:
      'Créer une fiche (work item) chez le fournisseur de tickets configuré — écrit dans le backlog de l’équipe, sous l’identité de l’utilisateur : ne l’utiliser que sur une demande explicite',
    args: {
      title: 'titre court et explicite de la fiche (obligatoire)',
      description: 'facultatif — contexte, reproduction, critère de fin',
      workItemType: 'facultatif — ex. Bug, Task, User Story ; défaut = celui du fournisseur',
      assignee: 'facultatif — identifiant de la personne assignée',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet cible)'
    },
    annotations: {
      readOnlyHint: false,
      // Non destructif (on ajoute, on ne supprime rien) mais NON idempotent : deux appels créent
      // DEUX fiches. Et `openWorldHint` : l'effet sort de l'app, chez un tiers.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'task_create',
    description:
      'Créer une tâche programmée (horaire) ou une règle de surveillance (réveil sur événement) dans le Task Manager d’Autowin — elle y est visible et l’utilisateur peut la désactiver ou la supprimer. C’est la SEULE voie : une tâche du Planificateur Windows (schtasks, Register-ScheduledTask) est refusée. ' +
      `Le "prompt" part SEUL dans la conversation, sans le fil : rédige-le sur ce modèle, un bloc par ligne — ${MODELE_PROMPT_TACHE_COURT}. Ni limite de temps, ni « boucle jusqu’au vert » ; pour une surveillance, l’app ajoute elle-même l’événement et la ligne ISSUE.`,
    args: {
      task:
        'objet JSON de la tâche, même forme que l’écran Task Manager : { "title", "prompt", "enabled": true|false, "mode": "active-only"|"windows", "destination": { "kind": "existing", "conversationId" } ou { "kind": "new", "title", "category", "provider" }, "action"?: "chat"|"veille", et SOIT "schedule": { "startDate": "AAAA-MM-JJ", "time": "HH:MM", "timeZone": "Europe/Paris", "recurrence": { "unit": "none"|"minute"|"hour"|"day"|"week"|"month", "interval": 1 } } (recurrence obligatoire ; "none" = une seule fois) SOIT "watchdog": { "source", "guards", "action" } }. Attendre la fin d’un tour d’un autre fil (au lieu de le sonder) : "source": { "kind": "app-event", "events": ["chat-turn-done"], "conversationId": "conv-N" }'
    },
    argsTypes: {
      task: {
        type: 'object',
        properties: CHAMPS_DE_TACHE,
        required: ['title', 'prompt', 'enabled', 'mode', 'destination']
      }
    },
    annotations: {
      readOnlyHint: false,
      // On ajoute, on ne supprime rien ; deux appels créent DEUX tâches. L'effet reste dans l'app.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'task_list',
    description:
      'Lister les tâches programmées et les règles de surveillance du Task Manager d’Autowin (id, titre, type, activée, mode, prochaine échéance, conversation visée) — à appeler AVANT task_create pour ne pas créer de doublon. Lecture seule.',
    args: {},
    annotations: {
      // Relecture du stockage de l'écran : rien n'est écrit, le minuteur n'est pas touché.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  /*
   * lot 3, 2026-10-31 : l'agent savait créer et lister une tâche, ni la modifier ni la
   * couper ni la supprimer. Mêmes chemins que les boutons de l'écran : `task-create-command.ts`.
   */
  {
    name: 'task_update',
    description:
      'Modifier une tâche programmée ou une règle de surveillance du Task Manager d’Autowin, comme le bouton « Enregistrer » de l’écran : seuls les champs de `patch` changent. `enabled: false` coupe la tâche sans la supprimer. Rend la tâche relue ; un identifiant inconnu échoue en citant les plus proches.',
    args: {
      id: 'identifiant de la tâche (voir task_list)',
      patch:
        'objet JSON, ou texte JSON, des seuls champs à changer parmi title, prompt, enabled, mode, destination, action, schedule, watchdog. Changer schedule ou watchdog remplace tout le déclencheur. enabled:false coupe sans supprimer'
    },
    argsTypes: { patch: { type: 'object', properties: CHAMPS_DE_TACHE } },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      // Le même `patch` rejoué mène au même état.
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'task_delete',
    description:
      'Supprimer une tâche programmée ou une règle de surveillance du Task Manager d’Autowin, comme le bouton « Supprimer » de l’écran. Irréversible, et refusé si la tâche tourne. Pour couper seulement : task_update avec enabled:false.',
    args: {
      id: 'identifiant de la tâche à supprimer (voir task_list). Irréversible ; pour couper seulement, utilise task_update avec enabled:false'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'sql_query',
    description:
      'Consulter les bases SQL en LECTURE SEULE (un seul SELECT) — pour constater un paramétrage ou une spécificité. Seules les bases EXPLOITÉES listées par le catalogue configuré (sql-catalog.json) et les bases de développement déclarées sont lisibles ; les autres sont refusées. La base catalogue est AUSSI lisible, mais « * » et toute colonne de mot de passe ou de clé y sont refusés. Toute écriture est refusée avant d’atteindre le serveur.',
    args: {
      query: 'un SELECT unique, sans point-virgule ni commentaire (obligatoire)',
      database: 'la base visée (obligatoire)',
      server:
        'facultatif — défaut : le serveur du catalogue configuré. En cas de refus, le message liste les serveurs et les bases disponibles.'
    },
    annotations: {
      // Lecture stricte : l'enveloppe annule systématiquement sa transaction. Mais `openWorldHint` —
      // la donnée vient d'une base de PRODUCTION, hors de l'app.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_get',
    description:
      'Lire UNE fiche (work item) par son numéro — à utiliser dès qu’un numéro de fiche est mentionné ; chercher ce numéro avec ticket_search ne le trouvera PAS (la recherche porte sur les titres)',
    args: {
      id: 'le numéro de la fiche (ex. 1227)',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet)'
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_update',
    description:
      'Mettre à jour une fiche existante après preuve du travail : publier un compte-rendu factuel, changer son état ou son assigné',
    args: {
      id: 'le numéro de la fiche (ex. 1227)',
      comment: 'facultatif — preuves, changements et vérifications réellement effectués',
      state: 'facultatif — état final exact accepté par le fournisseur',
      assignee: 'facultatif — personne à assigner',
      fields:
        'facultatif — champs libres à écrire, indexés par leur nom de référence exact chez le fournisseur, ex. { "Custom.DLL": "MaLib.dll" } ; c’est la seule façon d’atteindre les onglets métier (À livrer, Recette)',
      sourceId: 'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_search',
    description:
      'Lire les fiches (work items) du fournisseur de tickets configuré, avec une recherche par titre — à utiliser AVANT de créer une fiche, pour vérifier qu’un doublon n’existe pas déjà',
    args: {
      query:
        'facultatif — mots-clés cherchés dans le TITRE ; sans lui la liste part des fiches les plus anciennes',
      pageSize: 'facultatif — nombre de fiches à rendre (1 à 100, défaut 25)',
      cursor: 'facultatif — pour continuer une lecture précédente',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet)'
    },
    annotations: {
      // Lecture pure : rien n'est modifié chez le fournisseur, et deux appels identiques rendent la
      // même chose. Mais `openWorldHint` : la donnée vient d'un tiers, hors de l'app.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }
]
