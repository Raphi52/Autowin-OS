import { tableDeTextes } from '../textes'

/**
 * TEXTES — SETTINGS — PAGES SKILLS, HOOKS, GATES, MODS, TOOLS, BEHAVIOUR, ROUTAGE, RULES (traduction anglaise, conv-1170, 2026-10-27).
 *
 * Écrans couverts : CapabilitiesView, BehaviourView, RouterView, RulesView, SettingsView, BrainSettings,
 * InterfaceView, protection de prod, routage fantôme, seuils du mode auto, copie d’exécution — ce que
 * la table principale (`textes.ts`) ne porte pas déjà.
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 *
 * Préfixes : `capacites.` (CapabilitiesView : Skills, Hooks, Gates, Mods, Tools), `behaviour.`
 * (BehaviourView), `routeur.` (RouterView), `prod.` (ProdProtectionSettings), `shadow.`
 * (ShadowRoutingPilotSettings), `modeAuto.` (ModeAutoSeuilsSettings), `rules.` (RulesView).
 * SettingsView, BrainSettings, ExecutionWorkspaceSettings et InterfaceView sont déjà portés par la
 * table principale (`textes.ts`, conv-1146) : rien ici pour eux.
 *
 * Restent en dur dans les écrans, identiques dans les deux langues : les noms des sections (Skills,
 * Hooks, Gates, Mods, Tools, Behaviour), « Sources », « Global », « Active »/« Inactive », « Matcher »,
 * « relation(s) », « System prompt », « Cockpit », « Direct », « Mode », « Auto », « Simulation »,
 * « Confirmation », « Production », les noms de providers (Claude, Codex, Kimi, Gemini) et ce qui
 * vient du moteur (raisons, erreurs, statuts lus tels quels).
 */
export const TEXTES_FR = {
  // — CapabilitiesView : en-tête et registres
  'capacites.eyebrow': 'Capacités connectées',
  'capacites.recherche': 'Rechercher une capacité…',
  'capacites.skills.description': 'Les procédures que les agents peuvent suivre dans chaque run.',
  'capacites.skills.vide': 'Aucune skill trouvée.',
  'capacites.hooks.description':
    'Les scripts lancés tout seuls à certains moments d’un run, côté Claude ou Codex.',
  'capacites.hooks.vide': 'Aucun hook configuré.',
  'capacites.gates.description': 'Les contrôles de fin de run, écrits en code.',
  'capacites.gates.vide': 'Aucun contrôle de fin de run.',
  'capacites.tools.description':
    'Les outils que les agents ont vraiment utilisés, et le catalogue local.',
  'capacites.tools.vide': 'Aucun toolset trouvé.',
  'capacites.plugins.description': 'Les mods et plugins installés et déclarés.',
  'capacites.plugins.vide': 'Aucun mod ni plugin enregistré.',
  'capacites.redemarrage': 'Changement enregistré · nouvelle session ou redémarrage requis.',

  // — CapabilitiesView : sources des relations (nommées quand l'une manque)
  'capacites.relations.hooksClaude': 'Hooks Claude',
  'capacites.relations.hooksCodex': 'Hooks Codex',
  'capacites.relations.hooksAutowin': 'Hooks Autowin',
  'capacites.relations.toolsAutowin': 'Tools Autowin',

  // — CapabilitiesView : colonne des sources et filtre d'état
  'capacites.toutes': 'Toutes',
  'capacites.registreSynchronise': 'Registre synchronisé',
  'capacites.sourceFuture': '＋ Source future',
  'capacites.hooksDe': 'Hooks {source}',
  'capacites.actionsReelles': 'Actions réelles',
  'capacites.executeesParAgents': 'Exécutées par les agents',
  'capacites.catalogueLocal': 'Catalogue local',
  'capacites.decoratif': 'Décoratif · non invoqué',
  'capacites.registreLocal': 'Registre local',
  'capacites.gates.source': 'Contrôles de fin de run (code)',
  'capacites.plugins.source': 'Mods et plugins installés et déclarés',
  'capacites.etat': 'État',
  'capacites.actives': 'Actives',
  'capacites.desactivees': 'Désactivées',

  // — CapabilitiesView : liste
  'capacites.disponibles': '{titre} disponibles',
  'capacites.resultat': '{n} résultat',
  'capacites.resultats': '{n} résultats',
  'capacites.lecture': 'Lecture des sources…',
  'capacites.masquee': '{n} capacité existe mais est masquée par le filtre d’état.',
  'capacites.masquees': '{n} capacités existent mais sont masquées par le filtre d’état.',
  'capacites.afficherDesactivees': 'Afficher les {n} désactivées',
  'capacites.afficherActives': 'Afficher les {n} actives',
  'capacites.projet': 'Projet',
  'capacites.occurrences': 'Occurrences observées',
  'capacites.basculerOutil': 'Activer ou désactiver cet outil dans le registre natif',
  'capacites.etatLu': 'État lu du registre (lecture seule)',
  'capacites.actif': 'Actif',
  'capacites.inactif': 'Inactif',
  'capacites.associes': 'Hooks & tools associés à {nom}',
  'capacites.relationsPartiel': 'Catalogue de relations partiel : {liste} indisponible.',
  'capacites.relationsPartielPluriel': 'Catalogue de relations partiel : {liste} indisponibles.',
  'capacites.aucuneRelation': 'Aucune relation explicite détectée dans les déclarations.',

  // — CapabilitiesView : inspecteur
  'capacites.inspecteur': 'Inspecteur',
  'capacites.desactivee': 'Désactivée',
  'capacites.origine': 'Origine',
  'capacites.portee': 'Portée',
  'capacites.globale': 'Globale',
  'capacites.evenement': 'Événement',
  'capacites.lieeA': 'Liée à',
  'capacites.gestion': 'Gestion',
  'capacites.registreNatif': 'Registre natif',
  'capacites.lectureSeule': 'Lecture seule',
  'capacites.impact': 'Impact du changement',
  'capacites.impact.tools':
    'Modifie le registre natif ; peut nécessiter une nouvelle session pour prise en compte.',
  'capacites.impact.lectureSeule':
    'Capacité en lecture seule ici : son état est lu du registre, non modifiable depuis cette vue.',
  'capacites.selectionner': 'Sélectionne une capacité pour afficher ses détails.',

  // — BehaviourView : en-tête, workspace et apprentissage
  'behaviour.eyebrow': "Tout ce qui influe sur le comportement du chat — et rien d'autre",
  'behaviour.description': 'Configure ce qui influence les réponses et les décisions du Chat.',
  'behaviour.workspace': 'Workspace : {chemin}',
  'behaviour.chargement': 'chargement…',
  'behaviour.selection': 'Sélection…',
  'behaviour.choisir': 'Choisir un workspace',
  'behaviour.apprentissage': 'Apprentissage Brain des runs',
  'behaviour.brainDesRuns': 'Brain des runs : {n} événements audités ·',
  'behaviour.arrete': 'arrêté',
  'behaviour.modeAria': 'Mode d’apprentissage Brain',
  'behaviour.inbox': 'Inbox uniquement',
  'behaviour.annuler': 'Annuler {action} · {id}',
  'behaviour.plusDeCurations': 'Afficher plus de curations',
  'behaviour.journal': 'Journal détaillé · {n} plus récents',
  'behaviour.journalAria': 'Journal outcome-learning détaillé',
  'behaviour.enregistre': 'enregistré',

  // — BehaviourView : chemins et inventaire des instructions
  'behaviour.chemin': 'Chemin de chat',
  'behaviour.chatVisible': '(chat visible)',
  'behaviour.orchestre': 'Orchestré',
  'behaviour.reessayer': 'Réessayer',
  'behaviour.chargementComposition': 'Chargement de la composition…',
  'behaviour.inspectionAria': 'Instructions du workspace inspecté',
  'behaviour.aucunFichier': 'Aucun fichier d’instructions découvert dans ce workspace.',
  'behaviour.instructionsLues': 'Instructions réellement lues · {n}{suite}',
  'behaviour.nonChargee': ' · {n} non chargée',
  'behaviour.nonChargees': ' · {n} non chargées',
  'behaviour.source': "Source dans le code (preuve d'effet réel)",
  'behaviour.texteInjecte': 'texte injecté',

  // — BehaviourView : chemin cockpit
  'behaviour.cockpit.note':
    'Le chat principal visible passe par AgentPilot : il reçoit la CONSTITUTION, le contexte projet et un RAG dynamique Brain avant de pouvoir piloter l’application.',
  'behaviour.cockpit.systemPrompt': 'composition réellement envoyée au modèle du cockpit',
  'behaviour.cockpit.rag': 'RAG dynamique',
  'behaviour.cockpit.rag.aide':
    'récupéré pour le dernier message utilisateur, avec fallbacks indépendants',
  'behaviour.cockpit.tour': 'Contexte du tour',
  'behaviour.cockpit.tour.aide':
    'commandes, état, historique, pièces jointes et bornes réellement appliqués',
  'behaviour.modeleRole': 'Modèle / rôle',
  'behaviour.cockpit.modele.aide': 'binding utilisé par AgentPilot',

  // — BehaviourView : chemin orchestré
  'behaviour.orch.note':
    'Le vrai pipeline (os:orchestrate) : le system prompt VARIE par phase, du contexte est injecté, le modèle/rôle est choisi, le régime décide des phases, des garde-fous encadrent.',
  'behaviour.orch.systemPrompt': 'A · System prompt par phase',
  'behaviour.orch.systemPrompt.aide': 'blocs concaténés dans `system`, différents selon la phase',
  'behaviour.orch.contexte': 'B · Contexte injecté',
  'behaviour.orch.contexte.aide':
    'ajouté au message (hors system) : Brain, tâche, portage, session-resume',
  'behaviour.orch.modele': 'C · Modèle / rôle / effort',
  'behaviour.orch.modele.aide':
    "qui répond, avec quel modèle — y compris la redirection d'exécution",
  'behaviour.orch.topologie': 'C2 · Topologie / fan-out',
  'behaviour.orch.topologie.aide':
    'panels vivants scout, frame, terrain et judge, avec règle de quorum',
  'behaviour.orch.regime': 'D · Régime → phases',
  'behaviour.orch.regime.aide': 'quelles phases tournent selon la tâche (heuristique déterministe)',
  'behaviour.orch.gardeFous': 'E · Garde-fous',
  'behaviour.orch.gardeFous.aide': 'ce qui borne ou coupe le tour (déterministe)',

  // — BehaviourView : chemin direct
  'behaviour.direct.note':
    'Le chat direct (os.chat) : beaucoup plus simple — pas de phases, pas de Brain, pas de garde-fous. Son system prompt par défaut vient de la CONSTITUTION.',
  'behaviour.direct.systemPrompt.aide':
    'CONSTITUTION (source commune au chat direct et aux phases orchestrées)',
  'behaviour.direct.modele.aide':
    'binding du rôle si aucun provider explicite ; sinon override provider seul',

  // — RouterView : statuts et consignes de reconnexion
  'routeur.statut.authenticated': 'Authentifié',
  'routeur.statut.expired': 'Expiré · à reconnecter',
  'routeur.statut.installedUntested': 'Installé · validité non testée',
  'routeur.statut.absent': 'Non connecté',
  'routeur.statut.unknown': 'Indéterminé',
  'routeur.statut.standby': 'En standby',
  'routeur.reauth.claude':
    'CLI Claude introuvable ou non authentifié — installer/authentifier Claude, puis relance « Tester ».',
  'routeur.reauth.codex':
    'CLI Codex ou session OAuth indisponible — installe/reconnecte Codex, puis rouvre la page.',
  'routeur.reauth.kimi':
    'CLI Kimi introuvable — installer/authentifier Kimi, puis relance « Tester ».',
  'routeur.reauth.gemini':
    'Session Gemini absente — reconnecte le compte Google, puis relance « Tester ».',

  // — RouterView : en-tête, modèle du chat et des petites tâches
  'routeur.eyebrow': 'Providers et modèles connectés',
  'routeur.titre': 'Routeur',
  'routeur.description': 'Choisis les providers et modèles utilisés par chaque rôle.',
  'routeur.defaut.titre': 'Modèle par défaut du chat',
  'routeur.defaut.aide': 'le provider/modèle qui répond quand tu écris dans le Chat',
  'routeur.petites.titre': 'Modèle des petites tâches',
  'routeur.petites.aide':
    'choix du workflow · deux lectures · rangement du premier message · arbitrage d’une dérive',
  'routeur.petites.regle': 'Réglé',
  'routeur.petites.parDefaut': 'Par défaut',
  'routeur.petites.application':
    'S’applique au prochain choix de workflow, aux deux lectures, au rangement du premier message et à l’arbitrage d’une dérive.',
  'routeur.petites.nonRegle': 'Non réglé : Haiku par défaut, en effort low.',
  'routeur.petites.revenir': 'Revenir au défaut (Haiku)',

  // — RouterView : carte d'un provider et comptes Claude
  'routeur.dernierTest': 'Dernier test : {statut}',
  'routeur.test': 'Test…',
  'routeur.tester': 'Tester',
  'routeur.reconnecter': 'Se reconnecter',
  'routeur.enregistrement': 'Enregistrement…',
  'routeur.reactiver': 'Réactiver',
  'routeur.mettreEnStandby': 'Mettre en standby',
  'routeur.actionImpossible': 'Action impossible : {raison}',
  'routeur.comptes': 'Comptes',
  'routeur.retirer': 'Retirer {nom}',
  'routeur.ajouterCompte': '+ Ajouter un compte',
  'routeur.comptes.aide':
    'Chaque compte garde sa propre session : basculer ne redemande pas de connexion. Ajouter un compte ouvre un terminal de login dédié.',
  'routeur.standby.aide':
    'Aucun test ni login automatique. Les modèles restent disponibles dans le catalogue.',
  'routeur.loginLance':
    'Login lancé dans un terminal — termine l’authentification, puis clique « Tester ».',
  'routeur.dernierTestReel': 'Dernier test réel : {date}',
  'routeur.aucunModele': 'Aucun modèle listé pour ce provider.',
  'routeur.catalogueErreur': 'Chargement du catalogue impossible : {raison}',
  'routeur.reessayer': 'Réessayer',
  'routeur.chargement': 'Chargement des providers…',
  'routeur.aucunProvider': 'Aucun provider détecté.',

  // — ProdProtectionSettings : messages
  'prod.propositionEchec': "La proposition n'a pas pu être calculée.",
  'prod.niveauRefuse': 'Niveau refusé.',
  'prod.niveauEchec': "Le niveau n'a pas pu être changé.",
  'prod.saisiesDifferentes': 'Les deux saisies ne correspondent pas.',
  'prod.phraseChangee': 'Phrase changée. Les autorisations en cours sont annulées.',
  'prod.protectionActivee':
    'Protection activée. Tout geste de production demandera désormais cette phrase.',
  'prod.reglageEchec': "Le réglage n'a pas pu être enregistré.",
  'prod.inconnu': 'Inconnu',
  'prod.etatIllisible': "L'état de la protection n'a pas pu être lu.",

  // — ProdProtectionSettings : faits sur la déclaration
  'prod.cibleDeclaree': 'cible déclarée',
  'prod.ciblesDeclarees': 'cibles déclarées',
  'prod.toutEnProd':
    '— **tout** sera traité comme de la production, maquettes comprises, dès que la phrase existera.',
  'prod.fichierDeclaration': 'Fichier de déclaration :',
  'prod.lignesEcartees': 'ligne(s) écartée(s) : {liste}',

  // — ProdProtectionSettings : proposition depuis le catalogue SQL
  'prod.lectureCatalogue': 'Lecture du catalogue…',
  'prod.proposer': 'Proposer la liste depuis le catalogue SQL',
  'prod.resume':
    'Le catalogue déclare **{exploitees}** base(s) exploitée(s). **{ajoutees}** base(s) à ajouter (**{enProd}** en production, **{horsProd}** hors production) · **{passees}** passée(s) en production · **{conservees}** entrée(s) actuelle(s) reprise(s).',
  'prod.passeesEnProd':
    'Déclarées hors production mais exploitées selon le catalogue, donc passées en production : **{liste}**',
  'prod.nonRepris': 'Non repris de ton fichier actuel : {liste}',
  'prod.couvreDeja': 'Ta déclaration **couvre déjà tout le catalogue** : rien à changer.',
  'prod.copie': 'Copié',
  'prod.copier': 'Copier',
  'prod.copieEchec': 'La copie a échoué : sélectionne le texte ci-dessus à la main.',
  'prod.noteCatalogue':
    'Autowin n’écrit jamais ce fichier : colle ce contenu dans le fichier de déclaration indiqué plus haut, puis rouvre cet écran pour vérifier le nombre de cibles déclarées.',

  // — ProdProtectionSettings : niveaux et phrase de passe
  'prod.niveaux': 'Ce qu’Autowin demande avant d’agir sur une base de production',
  'prod.niveau.confirmation': 'Une fenêtre « voulez-vous continuer ? »',
  'prod.niveau.confirmation.note': 'Recommandé',
  'prod.niveau.phrase': 'La phrase de passe',
  'prod.niveau.phrase.note': 'Postes partagés',
  'prod.niveau.aucun': 'Rien du tout',
  'prod.niveau.aucun.note': 'Protection désactivée',
  'prod.phraseActuelle': 'Phrase de passe actuelle',
  'prod.nouvellePhrase': 'Nouvelle phrase ({n} caractères minimum)',
  'prod.phraseDePasse': 'Phrase de passe ({n} caractères minimum)',
  'prod.changerPhrase': 'Changer la phrase',
  'prod.activer': 'Activer la protection',
  'prod.notePhrase':
    'La phrase n’est jamais enregistrée en clair, ni envoyée à un modèle. Changer la phrase annule les autorisations déjà accordées.',

  // — ShadowRoutingPilotSettings
  'shadow.nonExpose': "Le pilote de routage shadow n'est pas exposé par l'application.",
  'shadow.lectureEchec': "Le réglage n'a pas pu être lu : {raison}",
  'shadow.basculeNonExposee': "La bascule n'est pas exposée par l'application.",
  'shadow.mesureActive':
    'Mesure active : chaque appel modèle est désormais rapproché de l’issue vérifiée de son run.',
  'shadow.mesureArretee': 'Mesure arrêtée : aucune nouvelle observation n’est enregistrée.',
  'shadow.enregistrementEchec': 'L’enregistrement a échoué : {raison}',
  'shadow.aria': 'Pilote de routage shadow',
  'shadow.eyebrow': 'Apprentissage du routage',
  'shadow.titre': 'Mesure des routes (pilote shadow)',
  'shadow.description':
    'Cochez pour que l’application mesure elle-même **quelle route tient le vert au coût le plus bas** : pour chaque appel modèle, elle enregistre le fournisseur, le modèle, la phase, le coût, la durée, puis l’issue **vérifiée** du run. L’Observatory peut alors comparer les routes observées. Rien n’est appliqué automatiquement : la recommandation reste un avis.',
  'shadow.reessayer': 'Réessayer',
  'shadow.case': 'Mesurer les routes (pilote shadow) — décoché, aucune donnée n’est collectée',
  'shadow.env':
    'La variable d’environnement AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED force actuellement le pilote à {etat} : elle l’emporte sur ce réglage jusqu’au prochain démarrage sans elle.',
  'shadow.actif': 'ACTIF',
  'shadow.inactif': 'INACTIF',

  // — ModeAutoSeuilsSettings
  'modeAuto.quotaInvalide': 'Le seuil de quota doit être un entier entre 1 et 100.',
  'modeAuto.toursInvalides': 'Le nombre de tours doit être un entier entre 1 et 1000.',
  'modeAuto.enregistres': 'Seuils enregistrés : ils valent dès le prochain tour automatique.',
  'modeAuto.aria': 'Arrêt automatique du mode ∞',
  'modeAuto.eyebrow': 'Protection du mode ∞',
  'modeAuto.titre': 'Arrêt automatique de la chaîne',
  'modeAuto.description':
    'Le mode ∞ d’un fil s’arrête tout seul, avec un message dans le fil, dès que le quota hebdomadaire Claude atteint le seuil, ou après ce nombre de tours automatiques d’affilée sans message de ta part. Défauts : {quota} % et {tours} tours.',
  'modeAuto.quota': 'Quota hebdomadaire Claude (%)',
  'modeAuto.tours': 'Tours automatiques d’affilée',
  'modeAuto.enregistrer': 'Enregistrer',

  // — RulesView
  'rules.aria': 'Rules d’Autowin OS'
} as const

export type CleSettings = keyof typeof TEXTES_FR

export const TEXTES_EN: Record<CleSettings, string> = {
  'capacites.eyebrow': 'Connected capabilities',
  'capacites.recherche': 'Search for a capability…',
  'capacites.skills.description': 'The procedures the agents can follow in each run.',
  'capacites.skills.vide': 'No skill found.',
  'capacites.hooks.description':
    'The scripts started automatically at certain moments of a run, on the Claude or Codex side.',
  'capacites.hooks.vide': 'No hook configured.',
  'capacites.gates.description': 'End-of-run checks, written in code.',
  'capacites.gates.vide': 'No end-of-run check.',
  'capacites.tools.description': 'The tools the agents actually used, and the local catalogue.',
  'capacites.tools.vide': 'No toolset found.',
  'capacites.plugins.description': 'Installed and declared mods and plugins.',
  'capacites.plugins.vide': 'No mod or plugin registered.',
  'capacites.redemarrage': 'Change saved · new session or restart required.',

  'capacites.relations.hooksClaude': 'Claude hooks',
  'capacites.relations.hooksCodex': 'Codex hooks',
  'capacites.relations.hooksAutowin': 'Autowin hooks',
  'capacites.relations.toolsAutowin': 'Autowin tools',

  'capacites.toutes': 'All',
  'capacites.registreSynchronise': 'Synced registry',
  'capacites.sourceFuture': '＋ Future source',
  'capacites.hooksDe': '{source} hooks',
  'capacites.actionsReelles': 'Real actions',
  'capacites.executeesParAgents': 'Run by the agents',
  'capacites.catalogueLocal': 'Local catalogue',
  'capacites.decoratif': 'Decorative · not invoked',
  'capacites.registreLocal': 'Local registry',
  'capacites.gates.source': 'End-of-run checks (code)',
  'capacites.plugins.source': 'Installed and declared mods and plugins',
  'capacites.etat': 'State',
  'capacites.actives': 'Active',
  'capacites.desactivees': 'Disabled',

  'capacites.disponibles': '{titre} available',
  'capacites.resultat': '{n} result',
  'capacites.resultats': '{n} results',
  'capacites.lecture': 'Reading the sources…',
  'capacites.masquee': '{n} capability exists but is hidden by the state filter.',
  'capacites.masquees': '{n} capabilities exist but are hidden by the state filter.',
  'capacites.afficherDesactivees': 'Show the {n} disabled',
  'capacites.afficherActives': 'Show the {n} active',
  'capacites.projet': 'Project',
  'capacites.occurrences': 'Observed occurrences',
  'capacites.basculerOutil': 'Enable or disable this tool in the native registry',
  'capacites.etatLu': 'State read from the registry (read-only)',
  'capacites.actif': 'Active',
  'capacites.inactif': 'Inactive',
  'capacites.associes': 'Hooks & tools linked to {nom}',
  'capacites.relationsPartiel': 'Partial relation catalogue: {liste} unavailable.',
  'capacites.relationsPartielPluriel': 'Partial relation catalogue: {liste} unavailable.',
  'capacites.aucuneRelation': 'No explicit relation detected in the declarations.',

  'capacites.inspecteur': 'Inspector',
  'capacites.desactivee': 'Disabled',
  'capacites.origine': 'Origin',
  'capacites.portee': 'Scope',
  'capacites.globale': 'Global',
  'capacites.evenement': 'Event',
  'capacites.lieeA': 'Linked to',
  'capacites.gestion': 'Management',
  'capacites.registreNatif': 'Native registry',
  'capacites.lectureSeule': 'Read-only',
  'capacites.impact': 'Impact of the change',
  'capacites.impact.tools': 'Changes the native registry; may need a new session to take effect.',
  'capacites.impact.lectureSeule':
    'Read-only capability here: its state is read from the registry, not editable from this view.',
  'capacites.selectionner': 'Select a capability to see its details.',

  'behaviour.eyebrow': 'Everything that affects the chat’s behaviour — and nothing else',
  'behaviour.description': 'Configure what influences the Chat’s answers and decisions.',
  'behaviour.workspace': 'Workspace: {chemin}',
  'behaviour.chargement': 'loading…',
  'behaviour.selection': 'Selecting…',
  'behaviour.choisir': 'Choose a workspace',
  'behaviour.apprentissage': 'Brain learning from runs',
  'behaviour.brainDesRuns': 'Runs Brain: {n} audited events ·',
  'behaviour.arrete': 'stopped',
  'behaviour.modeAria': 'Brain learning mode',
  'behaviour.inbox': 'Inbox only',
  'behaviour.annuler': 'Undo {action} · {id}',
  'behaviour.plusDeCurations': 'Show more curations',
  'behaviour.journal': 'Detailed log · {n} most recent',
  'behaviour.journalAria': 'Detailed outcome-learning log',
  'behaviour.enregistre': 'recorded',

  'behaviour.chemin': 'Chat path',
  'behaviour.chatVisible': '(visible chat)',
  'behaviour.orchestre': 'Orchestrated',
  'behaviour.reessayer': 'Retry',
  'behaviour.chargementComposition': 'Loading the composition…',
  'behaviour.inspectionAria': 'Instructions of the inspected workspace',
  'behaviour.aucunFichier': 'No instruction file found in this workspace.',
  'behaviour.instructionsLues': 'Instructions actually read · {n}{suite}',
  'behaviour.nonChargee': ' · {n} not loaded',
  'behaviour.nonChargees': ' · {n} not loaded',
  'behaviour.source': 'Source in the code (proof of real effect)',
  'behaviour.texteInjecte': 'injected text',

  'behaviour.cockpit.note':
    'The main visible chat goes through AgentPilot: it receives the CONSTITUTION, the project context and a dynamic Brain RAG before it can drive the application.',
  'behaviour.cockpit.systemPrompt': 'composition actually sent to the cockpit model',
  'behaviour.cockpit.rag': 'Dynamic RAG',
  'behaviour.cockpit.rag.aide': 'retrieved for the last user message, with independent fallbacks',
  'behaviour.cockpit.tour': 'Turn context',
  'behaviour.cockpit.tour.aide':
    'commands, state, history, attachments and limits actually applied',
  'behaviour.modeleRole': 'Model / role',
  'behaviour.cockpit.modele.aide': 'binding used by AgentPilot',

  'behaviour.orch.note':
    'The real pipeline (os:orchestrate): the system prompt VARIES per phase, context is injected, the model/role is chosen, the regime decides the phases, guardrails frame it all.',
  'behaviour.orch.systemPrompt': 'A · System prompt per phase',
  'behaviour.orch.systemPrompt.aide': 'blocks concatenated into `system`, different per phase',
  'behaviour.orch.contexte': 'B · Injected context',
  'behaviour.orch.contexte.aide':
    'added to the message (outside system): Brain, task, carry-over, session-resume',
  'behaviour.orch.modele': 'C · Model / role / effort',
  'behaviour.orch.modele.aide': 'who answers, with which model — including execution redirection',
  'behaviour.orch.topologie': 'C2 · Topology / fan-out',
  'behaviour.orch.topologie.aide':
    'live scout, frame, terrain and judge panels, with a quorum rule',
  'behaviour.orch.regime': 'D · Regime → phases',
  'behaviour.orch.regime.aide': 'which phases run depending on the task (deterministic heuristic)',
  'behaviour.orch.gardeFous': 'E · Guardrails',
  'behaviour.orch.gardeFous.aide': 'what bounds or cuts the turn (deterministic)',

  'behaviour.direct.note':
    'The direct chat (os.chat): much simpler — no phases, no Brain, no guardrails. Its default system prompt comes from the CONSTITUTION.',
  'behaviour.direct.systemPrompt.aide':
    'CONSTITUTION (shared source for the direct chat and the orchestrated phases)',
  'behaviour.direct.modele.aide':
    'role binding if no explicit provider; otherwise provider override only',

  'routeur.statut.authenticated': 'Authenticated',
  'routeur.statut.expired': 'Expired · reconnect needed',
  'routeur.statut.installedUntested': 'Installed · validity not tested',
  'routeur.statut.absent': 'Not connected',
  'routeur.statut.unknown': 'Undetermined',
  'routeur.statut.standby': 'On standby',
  'routeur.reauth.claude':
    'Claude CLI not found or not authenticated — install/authenticate Claude, then run “Test” again.',
  'routeur.reauth.codex':
    'Codex CLI or OAuth session unavailable — install/reconnect Codex, then reopen the page.',
  'routeur.reauth.kimi': 'Kimi CLI not found — install/authenticate Kimi, then run “Test” again.',
  'routeur.reauth.gemini':
    'Gemini session missing — reconnect the Google account, then run “Test” again.',

  'routeur.eyebrow': 'Connected providers and models',
  'routeur.titre': 'Router',
  'routeur.description': 'Choose the providers and models each role uses.',
  'routeur.defaut.titre': 'Chat default model',
  'routeur.defaut.aide': 'the provider/model that answers when you write in the Chat',
  'routeur.petites.titre': 'Small-tasks model',
  'routeur.petites.aide':
    'workflow choice · two readings · filing of the first message · drift arbitration',
  'routeur.petites.regle': 'Set',
  'routeur.petites.parDefaut': 'Default',
  'routeur.petites.application':
    'Applies to the next workflow choice, to the two readings, to the filing of the first message and to drift arbitration.',
  'routeur.petites.nonRegle': 'Not set: Haiku by default, at low effort.',
  'routeur.petites.revenir': 'Back to the default (Haiku)',

  'routeur.dernierTest': 'Last test: {statut}',
  'routeur.test': 'Testing…',
  'routeur.tester': 'Test',
  'routeur.reconnecter': 'Sign in again',
  'routeur.enregistrement': 'Saving…',
  'routeur.reactiver': 'Reactivate',
  'routeur.mettreEnStandby': 'Put on standby',
  'routeur.actionImpossible': 'Action not possible: {raison}',
  'routeur.comptes': 'Accounts',
  'routeur.retirer': 'Remove {nom}',
  'routeur.ajouterCompte': '+ Add an account',
  'routeur.comptes.aide':
    'Each account keeps its own session: switching does not ask you to sign in again. Adding an account opens a dedicated login terminal.',
  'routeur.standby.aide':
    'No test and no automatic login. The models stay available in the catalogue.',
  'routeur.loginLance': 'Login started in a terminal — finish signing in, then click “Test”.',
  'routeur.dernierTestReel': 'Last real test: {date}',
  'routeur.aucunModele': 'No model listed for this provider.',
  'routeur.catalogueErreur': 'The catalogue could not be loaded: {raison}',
  'routeur.reessayer': 'Retry',
  'routeur.chargement': 'Loading the providers…',
  'routeur.aucunProvider': 'No provider detected.',

  'prod.propositionEchec': 'The suggestion could not be computed.',
  'prod.niveauRefuse': 'Level refused.',
  'prod.niveauEchec': 'The level could not be changed.',
  'prod.saisiesDifferentes': 'The two entries do not match.',
  'prod.phraseChangee': 'Passphrase changed. The current authorisations are cancelled.',
  'prod.protectionActivee':
    'Protection enabled. Every production action will now ask for this passphrase.',
  'prod.reglageEchec': 'The setting could not be saved.',
  'prod.inconnu': 'Unknown',
  'prod.etatIllisible': 'The protection state could not be read.',

  'prod.cibleDeclaree': 'declared target',
  'prod.ciblesDeclarees': 'declared targets',
  'prod.toutEnProd':
    '— **everything** will be treated as production, mock-ups included, as soon as the passphrase exists.',
  'prod.fichierDeclaration': 'Declaration file:',
  'prod.lignesEcartees': 'line(s) discarded: {liste}',

  'prod.lectureCatalogue': 'Reading the catalogue…',
  'prod.proposer': 'Suggest the list from the SQL catalogue',
  'prod.resume':
    'The catalogue declares **{exploitees}** database(s) in use. **{ajoutees}** database(s) to add (**{enProd}** in production, **{horsProd}** outside production) · **{passees}** moved to production · **{conservees}** current entry(ies) carried over.',
  'prod.passeesEnProd':
    'Declared outside production but in use according to the catalogue, so moved to production: **{liste}**',
  'prod.nonRepris': 'Not carried over from your current file: {liste}',
  'prod.couvreDeja': 'Your declaration **already covers the whole catalogue**: nothing to change.',
  'prod.copie': 'Copied',
  'prod.copier': 'Copy',
  'prod.copieEchec': 'The copy failed: select the text above by hand.',
  'prod.noteCatalogue':
    'Autowin never writes this file: paste this content into the declaration file shown above, then reopen this screen to check the number of declared targets.',

  'prod.niveaux': 'What Autowin asks for before acting on a production database',
  'prod.niveau.confirmation': 'A “do you want to continue?” window',
  'prod.niveau.confirmation.note': 'Recommended',
  'prod.niveau.phrase': 'The passphrase',
  'prod.niveau.phrase.note': 'Shared workstations',
  'prod.niveau.aucun': 'Nothing at all',
  'prod.niveau.aucun.note': 'Protection disabled',
  'prod.phraseActuelle': 'Current passphrase',
  'prod.nouvellePhrase': 'New passphrase ({n} characters minimum)',
  'prod.phraseDePasse': 'Passphrase ({n} characters minimum)',
  'prod.changerPhrase': 'Change the passphrase',
  'prod.activer': 'Enable the protection',
  'prod.notePhrase':
    'The passphrase is never stored in clear text, nor sent to a model. Changing it cancels the authorisations already granted.',

  'shadow.nonExpose': 'The shadow routing pilot is not exposed by the application.',
  'shadow.lectureEchec': 'The setting could not be read: {raison}',
  'shadow.basculeNonExposee': 'The switch is not exposed by the application.',
  'shadow.mesureActive':
    'Measurement on: each model call is now matched with the verified outcome of its run.',
  'shadow.mesureArretee': 'Measurement off: no new observation is recorded.',
  'shadow.enregistrementEchec': 'Saving failed: {raison}',
  'shadow.aria': 'Shadow routing pilot',
  'shadow.eyebrow': 'Routing learning',
  'shadow.titre': 'Route measurement (shadow pilot)',
  'shadow.description':
    'Tick so that the application measures by itself **which route stays green at the lowest cost**: for each model call, it records the provider, the model, the phase, the cost, the duration, then the **verified** outcome of the run. The Observatory can then compare the observed routes. Nothing is applied automatically: the recommendation stays an opinion.',
  'shadow.reessayer': 'Retry',
  'shadow.case': 'Measure the routes (shadow pilot) — unticked, no data is collected',
  'shadow.env':
    'The environment variable AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED currently forces the pilot to {etat}: it overrides this setting until the next start without it.',
  'shadow.actif': 'ACTIVE',
  'shadow.inactif': 'INACTIVE',

  'modeAuto.quotaInvalide': 'The quota threshold must be a whole number between 1 and 100.',
  'modeAuto.toursInvalides': 'The number of turns must be a whole number between 1 and 1000.',
  'modeAuto.enregistres': 'Thresholds saved: they apply from the next automatic turn.',
  'modeAuto.aria': 'Automatic stop of ∞ mode',
  'modeAuto.eyebrow': '∞ mode protection',
  'modeAuto.titre': 'Automatic stop of the chain',
  'modeAuto.description':
    'A thread’s ∞ mode stops by itself, with a message in the thread, as soon as the weekly Claude quota reaches the threshold, or after this number of automatic turns in a row without a message from you. Defaults: {quota} % and {tours} turns.',
  'modeAuto.quota': 'Weekly Claude quota (%)',
  'modeAuto.tours': 'Automatic turns in a row',
  'modeAuto.enregistrer': 'Save',

  'rules.aria': 'Autowin OS rules'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<CleSettings, string>>> = {}

export const { useTextes: useTextesSettings, traduire: traduireSettings } = tableDeTextes(
  TEXTES_FR,
  TEXTES_EN
)
