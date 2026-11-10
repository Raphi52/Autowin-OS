#!/usr/bin/env node
/**
 * RANGE `src/main/` EN SOUS-DOSSIERS — et corrige tout ce qui pointait vers l'ancien chemin.
 *
 * Pourquoi (2026-11-06) : 1 170 fichiers posés à plat dans `src/main/`. Le rangement
 * se fait par FAMILLE : un module et tous ses tests (`x.ts`, `x.test.ts`, `x.cas.test.ts`…)
 * partagent le préfixe avant le premier point et partent ensemble dans le même dossier.
 *
 * Un script plutôt qu'un déplacement à la main : plusieurs fils écrivent dans ce dossier. Le
 * rangement se rejoue à l'identique sur l'arbre du moment, dès que personne n'a de travail en
 * cours dans `src/main/` — et se prouve d'abord dans une copie séparée.
 *
 * Ce qu'il corrige :
 *   1. les imports relatifs (`from`, `import()`, `require`, `vi.mock`, `vi.importActual`…) de tous
 *      les fichiers JS/TS du dépôt, vers ou depuis un fichier déplacé ;
 *   2. dans les TESTS déplacés, les chemins `join|resolve(__dirname, '…')` et
 *      `new URL('…', import.meta.url)` écrits en littéraux (le code de l'app garde les siens :
 *      une fois empaqueté, son `__dirname` est `out/main`, pas le dossier source) ;
 *   3. les chemins `src/main/<fichier>` écrits en texte partout (configs, scripts, docs, skills),
 *      en `/`, `\` ou `\\`, et la forme éclatée `'src', 'main', '<fichier>'`.
 *
 * Usage :
 *   node scripts/ranger-src-main.mjs                 # à blanc : plan, oublis, collisions
 *   node scripts/ranger-src-main.mjs --appliquer     # déplace (git mv) et réécrit
 *   --racine <dossier>                               # autre copie du dépôt (défaut : ce dépôt)
 *   --refuser-si-modifie                             # refuse si src/main a du travail non commité
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Dossier → familles (préfixe avant le premier point). `.` = reste à la racine de src/main. */
export const PLAN = {
  '.': ['index'],
  'agent-pilot': ['agent-pilot'],
  app: [
    'app-data', 'app-restart', 'attente-de-reglage', 'branding', 'coffre-cles', 'console-encoding', 'crash-handlers',
    'dev-sans-watch', 'env-partage-entre-tests', 'env-reload', 'experience-soignee-cablee',
    'fenetre-memoire', 'filet-navigation', 'garder-eveille', 'headless-instance', 'journal-arrets',
    'main-journal', 'native-dialog-guard', 'native-prompt-traces-readonly', 'native-registry',
    'notification-fin-de-tour', 'notification-popup', 'notification-popup-fenetre', 'observer-les-sources',
    'os', 'os-presence-main', 'point-entree-local', 'prise-en-main', 'process-identity',
    'process-stream-guards', 'raccourci-demarrer-dev', 'raccourci-global', 'redemarrage-reprise',
    'renderer-emit', 'renderer-sender-guard', 'renderer-storage-migration', 'reprise-apres-arret',
    'scripts-copie-main', 'source-process-principal', 'startup-gate', 'startup-splash', 'window'
  ],
  behaviour: ['behaviour-access', 'behaviour-composition', 'behaviour-files'],
  board: [
    'board-collegues', 'board-copie-fin-de-tour', 'board-dossier', 'board-dossiers-du-chat',
    'board-fiches-partagees', 'carte-des-besoins', 'ecarts-des-fiches', 'fiches-de-demande',
    'journal-des-besoins'
  ],
  brain: [
    'brain-condenseur', 'brain-context', 'brain-corpus-scope', 'brain-curation-run', 'brain-inbox',
    'brain-inbox-race', 'brain-index-refresh', 'brain-paths', 'brain-perso', 'brain-perso-racine',
    'brain-ponts', 'brain-protocol', 'brain-reglage', 'brain-remember', 'brain-retrieval',
    'brain-search-envelope', 'brain-server-launch', 'brain-server-supervision', 'brain-source-sha',
    'brain-titres-du-tour', 'lecon-non-retenue', 'memoire-de-tete', 'outcome-learning',
    'outcome-learning-curation', 'outcome-learning-curation-transaction', 'outcome-learning-policy',
    'outcome-learning-projector', 'outcome-learning-proposal', 'outcome-learning-supervisor',
    'portee-de-lecon', 'releve-memoire', 'session-memory-echo'
  ],
  bureau: [
    'bureau-lecture-indeterminee', 'bureau-reutilisable', 'cdp-port', 'desktop-binary-identity',
    'desktop-control', 'desktop-double-click', 'desktop-drag', 'desktop-observe-display',
    'desktop-powershell-error', 'electron-desktop-capture', 'hdesk-arbre', 'hdesk-fermer',
    'hdesk-gestion', 'hdesk-lancer', 'hdesk-tv', 'navigateur-integre', 'navigateur-page-script',
    'synchronisation-cible-bureau', 'terminal-integre', 'terminal-texte'
  ],
  chat: [
    'active-chat-turns', 'affichage-session', 'annonce-commit-local', 'annonce-edition-locale',
    'annonce-sans-action-native', 'annulation-motivee', 'ask-options', 'ask-question-liveness',
    'chat-artifact-ipc-contract', 'chat-bureau-cache-par-fil', 'chat-continuation', 'chat-ipc-contract',
    'chat-iteration-cap', 'chat-mcp', 'chat-media-protocol', 'chat-publication-verification',
    'chat-rejeu-surcharge', 'chat-session-poids', 'chat-turn-arret', 'chat-turn-messages',
    'chat-turn-publication', 'conv-1407-ne-peut-plus-se-reproduire', 'coupe-boucle', 'deux-lectures',
    'deux-lectures-appel', 'directive-dans-le-fil', 'dossier-du-tour-courant',
    'erreur-captee-en-cours-de-tour', 'etat-diff', 'etat-outil', 'etiquettes-dernier-recours',
    'gardes-reponse-anglaise', 'issue-de-refus', 'option-lecture-ou-solution', 'pilot-incident',
    'plafond-appels-chat', 'question-a-cote', 'question-posee', 'question-sans-lecture',
    'refus-identique-arrete', 'registre-outils', 'resultat-de-commande-borne', 'turn-timing'
  ],
  commands: [
    'brain-graph-command', 'brain-query-command', 'catalogue-lecture-seule', 'commands',
    'conversation-search-command', 'edit-file-autre-depot', 'edit-file-command',
    'edit-file-copie-desynchronisee', 'edit-file-portee', 'edit-file-publication-differee',
    'edit-file-reservation', 'edit-file-stoppable', 'file-ops-command', 'montrer-bloc-command',
    'portee-edition-style', 'read-file-command', 'retrospective-command', 'show-video-command',
    'skill-charger-command', 'sql-read-command', 'ticket-create-command', 'ticket-get-command',
    'ticket-search-command', 'ticket-update-command', 'verify-command'
  ],
  consignes: [
    'agents-md-faits', 'chat-pilotage-prompt', 'consigne-bureau-cache', 'consigne-plan-de-lots',
    'constitution', 'context-files', 'ordre-de-priorite-des-consignes',
    'phase-briefs', 'profil-ecrase-le-cadrage', 'rappel-cloisonnement', 'rappel-conversations',
    'rappel-securite', 'response-style', 'textes-coeur', 'think-briefing', 'vocabulaire-autowin'
  ],
  conversations: [
    'arreter-un-fil', 'bascule-dossier-conversation', 'classer-conversation', 'conversation-demandee',
    'conversation-task-contract', 'conversation-window', 'messages-entre-fils-app',
    'omniscience-inter-conversation', 'orientations-en-cours-app', 'orientations-tardives',
    'rangement-premier-message'
  ],
  fichiers: [
    'bounded-file-read', 'chemins-cites', 'chemins-complets', 'durable-json', 'exact-line-fingerprint',
    'file-encoding', 'fs-supprimer', 'lecture-encodage', 'project-files', 'proprietaire-fichier',
    'reservation-fichiers', 'reservation-fichiers-app', 'reveal-file', 'surveiller-dossier', 'temp-isole'
  ],
  gardes: [
    'arret-avant-suppression', 'autorisation-commande', 'capability-controls', 'context-isolation',
    'racine-hors-copie-agent', 'root-execution-contract', 'security-critical-fixes',
    'separation-entreprise'
  ],
  gel: [
    'ecriture-hors-fil', 'execution-hors-fil', 'gel-battement-fenetre', 'gel-fenetre', 'gel-io',
    'gel-main', 'gel-origine-des-inconnus', 'gel-reanimation', 'gel-temoin-de-vie', 'gel-tour-de-chat',
    'lancement-hors-fil', 'observabilite-non-bloquante', 'perf-lag-main', 'tour-sans-signe-de-vie'
  ],
  git: [
    'circonstance-publication', 'comparaison-a-la-base', 'depot-cite-dans-le-message', 'depot-git',
    'forge-cli-token', 'git-action-main', 'git-apres-fil', 'git-apres-fil-sans-tour', 'git-checkout-main',
    'git-cloture-porteurs', 'git-fin-de-run', 'git-graph-main', 'git-read-main', 'git-update',
    'git-update-diagnostic', 'githooks-pre-commit', 'githooks-pre-push', 'photo-du-code',
    'publications-en-vol', 'titre-bandeau-git', 'titre-de-commit', 'worktree-path-rewrite'
  ],
  ipc: ['ipc-guards', 'ipc-senders'],
  juge: [
    'agregat-juge', 'changements-juge', 'juge-lecon-reserve', 'juge-terminal-avec-learn', 'memoire-juge',
    'motif-chaine-apres-juge', 'objections-juge', 'relecture-froide', 'verdict-differentiel'
  ],
  kaizen: [
    'autowin-kaizen-context', 'kaizen-appels-echoues', 'kaizen-appui-sources-neuves',
    'kaizen-cible-injection', 'kaizen-perimetres', 'kaizen-sans-gate-humain', 'retrospective-compacte'
  ],
  knowledge: ['semantic-temporal-ipc-contract'],
  mascotte: [
    'mascotte', 'mascotte-fenetre', 'mascotte-machine-images', 'mascotte-menu', 'mascotte-personnage',
    'mascotte-reglage', 'mascotte-runs', 'quartier-presence', 'quartier-presence-collegues',
    'quartier-presence-filtre', 'quartier-presence-masques'
  ],
  media: [
    'audio-loopback', 'diarisation', 'piper-local', 'telechargement', 'transcripts', 'video-ffprobe',
    'videos-livrees', 'whisper-local'
  ],
  modeles: [
    'historique-modele', 'historique-moteurs-retires', 'model-aliases', 'model-questions', 'model-quotas',
    'model-quotas-sonde', 'model-refresh', 'model-routing-shadow', 'model-routing-shadow-optin',
    'model-routing-shadow-setting', 'model-routing-shadow-store', 'models', 'route-drift', 'shadow-router'
  ],
  mods: ['garde-mod-autowin', 'mods-autowin'],
  orchestration: [
    'arena-duels', 'arena-heal-contrat', 'arena-routable', 'boucle-reparation', 'classe-terminale-echec',
    'e2e-chaine', 'effort-par-etape', 'etape-think', 'etapes-desactivees', 'execution-quote',
    'execution-supervisor', 'execution-workspace-preference', 'facturation-remise-fidelite-cible',
    'fixture-orchestration', 'frame-cas-limites', 'garder-un-essai', 'greedy-decompose',
    'greedy-scheduler', 'grille-clean', 'intent-phase-routing', 'orchestrate-verdict-rouge',
    'orchestration-battement', 'orchestration-budget', 'orchestration-context', 'orchestration-lean',
    'orchestration-memoire', 'orchestrator', 'orchestrator-contrats', 'orchestrator-parcours-glouton',
    'orchestrator-parcours-sequentiel', 'orchestrator-run', 'petites-taches-trace', 'pipeline-discipline',
    'plans-de-lots', 'plans-de-lots-app', 'quorum', 'task-mutation-classifier',
    'task-regime', 'terrain-a-la-demande'
  ],
  preflight: [
    'preflight', 'preflight-announce', 'preflight-bin-resolution', 'preflight-ipc-contract',
    'preflight-probes', 'preflight-repair'
  ],
  prod: [
    'prod-autorite-depuis-catalogue', 'prod-gate', 'prod-guard', 'prod-guichet', 'prod-passphrase',
    'prod-passphrase-ipc', 'prod-run-guard', 'prod-sql-agent', 'prod-trois-restes', 'sql-catalog',
    'sql-read-catalog', 'sql-read-guard', 'sqlcmd-runner'
  ],
  profil: [
    'garde-profil-frontiere', 'identite-entreprise', 'identite-utilisateur', 'langue-reglage',
    'profil-utilisateur', 'profile-store', 'role-store', 'roles'
  ],
  providers: [
    'azure-cli-token', 'claude-accounts', 'claude-cli-catalog', 'claude-cli-update', 'claude-hooks',
    'claude-resets', 'claude-session', 'claude-session-renewal', 'cli-child-environment',
    'codex-model-source', 'comptes-login-cible', 'conso-autowin-vs-cli', 'dossiers-claude-cli',
    'mcp-servers', 'moteur-perime-cablage', 'provider-capabilities', 'provider-failure-diagnosis',
    'provider-login', 'provider-probe-timeout', 'provider-state-store', 'provider-status',
    'relance-auto-moteur', 'routed-providers', 'transient-overload'
  ],
  runs: ['autoclose-store', 'inventaire-runs-autowin', 'run-autoclose'],
  scout: [
    'scout-cible', 'scout-cible-contrat', 'scout-memoire', 'scout-orientation', 'scout-plafond',
    'scout-selection-correction-directe', 'scout-selection-workflow-complet', 'selection-sans-scout'
  ],
  skills: [
    'draft-choix-par-boutons', 'kit-cliquets', 'residus-signal-retrait', 'skill-doctor',
    'skill-draft-bloc-de-choix', 'skill-draft-scene-dans-carrousel', 'skill-invocation', 'skill-maj',
    'skill-node-mcp', 'skill-node-tools', 'skill-pipeline', 'skill-registry', 'skill-routing',
    'skill-slash-mal-tape', 'skills-bundled', 'skills-chemins-cites', 'skills-gel-maj', 'skills-memoire'
  ],
  tickets: [
    'liens-work-items', 'ticket-credential-store', 'ticket-search-cursor', 'ticket-source-store',
    'tickets-discussion-entiere', 'tickets-ipc', 'tickets-ipc-contract', 'tickets-service'
  ],
  topologie: [
    'runtime-topology', 'topology', 'topology-disk', 'wire-capabilities-runtime', 'wire-checkpoint-fork',
    'wire-compute-fabric', 'wire-provider-routing', 'wire-skill-runtime'
  ],
  verify: [
    'cible-de-verification', 'evidence-digest', 'lectures-git-et-typage', 'tests-deja-joues',
    'tests-view-main', 'typage-avant-publication', 'typage-avant-publication-reel', 'ui-capture-harness',
    'verification-isolee', 'verify-battement', 'verify-bureau-isole', 'verify-echec-nature',
    'verify-extinction', 'verify-portee-par-defaut', 'verify-timeout'
  ],
  workflow: [
    'workflow-defaults', 'workflow-dynamic', 'workflow-graph', 'workflow-instruction', 'workflow-isolation',
    'workflow-profile-apply', 'workflow-profiles', 'workflow-run-override', 'workflow-selection',
    'workflow-transfer', 'workflow-walk'
  ]
}

/**
 * RETOUCHES À LA MAIN — les tests qui vérifient un câblage en citant un chemin RELATIF au fichier
 * lu (« os.ts importe './store/…' ») : aucune règle générale ne sait que l'attente parle d'un AUTRE
 * fichier que le test. `fichier` = chemin AVANT rangement ; `avant` doit s'y trouver une seule fois
 * (après les réécritures automatiques), sinon le script refuse tout.
 */
export const RETOUCHES = [
  {
    fichier: 'src/main/runs/liveness-fingerprint.test.ts',
    avant: String.raw`from\s*'\.\/store\/worktree-manager'/`,
    apres: String.raw`from\s*'\.\.\/store\/worktree-manager'/`
  },
  {
    fichier: 'src/main/surveiller-dossier.test.ts',
    avant: "expect(fautifs).toEqual(['surveiller-dossier.ts'])",
    apres: "expect(fautifs).toEqual(['fichiers/surveiller-dossier.ts'])"
  },
  // `commands.ts` et `agent-pilot.ts` rejoignent LEUR dossier de modules : la lecture du dossier
  // les ramasse désormais, ils ne doivent pas y être lus une seconde fois.
  {
    fichier: 'src/main/commands/source-du-bus.test-helpers.ts',
    avant: ".filter((nom) => nom.endsWith('.ts') && !nom.includes('.test'))",
    apres: ".filter((nom) => nom.endsWith('.ts') && !nom.includes('.test') && nom !== 'commands.ts')"
  },
  {
    fichier: 'src/main/agent-pilot/source-du-pilote.test-helpers.ts',
    avant: ".filter((nom) => nom.endsWith('.ts') && !nom.includes('.test'))",
    apres: ".filter((nom) => nom.endsWith('.ts') && !nom.includes('.test') && nom !== 'agent-pilot.ts')"
  },
  // Le lecteur du « process principal » nommait `window.ts` et `ipc-senders.ts` à la racine ; le
  // second rejoint `ipc/`, que le lecteur parcourt déjà.
  {
    fichier: 'src/main/source-process-principal.test-helpers.ts',
    avant: "const nommes = ['window.ts', 'ipc-senders.ts']",
    apres: "const nommes = ['app/window.ts']"
  },
  {
    fichier: 'src/main/gel-fenetre.test.ts',
    avant: `"import { surveillerFenetreInjoignable } from './gel-fenetre'"`,
    apres: `"import { surveillerFenetreInjoignable } from '../gel/gel-fenetre'"`
  },
  {
    fichier: 'src/main/workflow-isolation.test.ts',
    avant: String.raw`\} from '\.\/selection-sans-scout'/`,
    apres: String.raw`\} from '\.\.\/scout\/selection-sans-scout'/`
  },
  {
    fichier: 'src/main/commands/methodes-du-bus.test.ts',
    avant: 'if (s.moduleSpecifier.text !== `./commands/${module}`) continue',
    apres: 'if (s.moduleSpecifier.text !== `./${module}`) continue'
  },
  {
    fichier: 'src/main/motif-chaine-apres-juge.test.ts',
    avant: "readFileSync('src/main/' + f, 'utf8')",
    apres: "readFileSync('src/main/orchestration/' + f, 'utf8')"
  },
  {
    fichier: 'src/main/shadow-router.test.ts',
    avant: "['../preload/index.ts', '../preload/index.d.ts']",
    apres: "['../../preload/index.ts', '../../preload/index.d.ts']"
  },
  {
    fichier: 'src/main/model-routing-shadow-optin.test.ts',
    avant: "['../preload/index.ts', '../preload/index.d.ts']",
    apres: "['../../preload/index.ts', '../../preload/index.d.ts']"
  },
  // Chemins d'EXEMPLE d'un test pur (aucune lecture) : une écriture en casse différente n'a pas été
  // réécrite, la paire ne se ressemblait plus. On rend les exemples d'origine.
  {
    fichier: 'src/main/bureau-reutilisable.test.ts',
    avant: "'src\\\\main\\\\commands\\\\commands.ts'",
    apres: "'src\\\\main\\\\commands.ts'"
  },
  {
    fichier: 'src/main/bureau-reutilisable.test.ts',
    avant: "['src/main/commands/commands.ts']",
    apres: "['src/main/commands.ts']"
  },
  // Ces tests lisaient le VRAI `default-gate-hooks.ts` et dépendaient de son DERNIER commit : tout
  // commit sans jeton sur ce fichier (dont ce rangement, qui n'y change qu'un import) les rougit.
  // Ils lisent désormais un fichier jetable non suivi d'un dépôt d'essai.
  {
    fichier: 'src/main/hooks/jetons-de-cause.test.ts',
    avant: "import { resolve, sep } from 'node:path'\n",
    apres:
      "import { execFileSync } from 'node:child_process'\n" +
      "import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'\n" +
      "import { tmpdir } from 'node:os'\n" +
      "import { join, resolve, sep } from 'node:path'\n"
  },
  {
    fichier: 'src/main/hooks/jetons-de-cause.test.ts',
    avant:
      "describe('jetonsDeCauseParFichier — source 3 : le jeton deja dans le fichier edite', () => {\n" +
      "  it('credite un fichier edite qui porte deja son jeton sur disque', async () => {\n" +
      "    const cible = 'src/main/hooks/default-gate-hooks.ts'\n",
    apres:
      '/**\n' +
      " * Un fichier NON SUIVI d'un dépôt jetable qui porte un `fix-ok:` — toutes ses lignes comptent comme\n" +
      ' * ajoutées. Lire le vrai `default-gate-hooks.ts` liait ces tests à son dernier commit : le rangement\n' +
      ' * de src/main, qui n’y change qu’un import, les faisait rougir.\n' +
      ' */\n' +
      'function fichierAvecJeton(): string {\n' +
      "  const dossier = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-jeton-')))\n" +
      "  execFileSync('git', ['init', '-q'], { cwd: dossier, windowsHide: true })\n" +
      "  const fichier = join(dossier, 'corrige.ts')\n" +
      "  writeFileSync(fichier, '// fix-ok: essai, la cause est nommee\\nexport const x = 1\\n', 'utf8')\n" +
      "  return fichier.split(sep).join('/')\n" +
      '}\n\n' +
      "describe('jetonsDeCauseParFichier — source 3 : le jeton deja dans le fichier edite', () => {\n" +
      "  it('credite un fichier edite qui porte deja son jeton sur disque', async () => {\n" +
      '    const cible = fichierAvecJeton()\n'
  },
  {
    fichier: 'src/main/hooks/jetons-de-cause.test.ts',
    avant: "    const cible = resolve(process.cwd(), 'src/main/hooks/default-gate-hooks.ts').split(sep).join('/')\n",
    apres: '    const cible = resolve(fichierAvecJeton()).split(sep).join(\'/\')\n'
  },
  // Le texte KAIZEN injecté nomme ses leviers par « chemin nu = sous src/main/ » : ils suivent.
  {
    fichier: 'src/main/phase-briefs.ts',
    avant: String.raw`(\`chat-pilotage-prompt.ts\`, \`phase-briefs.ts\` = ce texte, \`constitution.ts\`, \`intent-phase-routing.ts\`, \`behaviour-composition.ts\` + ses 6 sources, \`autowin-kaizen-context.ts\` = ce que kaizen recoit), mais AUSSI la boucle \`agent-pilot.ts\``,
    apres: String.raw`(\`consignes/chat-pilotage-prompt.ts\`, \`consignes/phase-briefs.ts\` = ce texte, \`consignes/constitution.ts\`, \`orchestration/intent-phase-routing.ts\`, \`behaviour/behaviour-composition.ts\` + ses 6 sources, \`kaizen/autowin-kaizen-context.ts\` = ce que kaizen recoit), mais AUSSI la boucle \`agent-pilot/*\``
  },
  {
    fichier: 'src/main/phase-briefs.ts',
    avant: String.raw`3. Outils : \`commands.ts\` (declaration`,
    apres: String.raw`3. Outils : \`commands/commands.ts\` (declaration`
  },
  {
    fichier: 'src/main/phase-briefs.ts',
    // Plafond de taille (phase-briefs.test.ts, < 2980) : le chemin de la constitution est déjà nommé
    // au levier 2, on y renvoie au lieu de le recopier.
    avant: String.raw`inventorie via \`behaviour-files.ts\`. La CONSTITUTION n'est PAS un fichier : c'est \`constitution.ts\`.`,
    apres: String.raw`inventorie via \`behaviour/behaviour-files.ts\`. La CONSTITUTION est du code (levier 2), pas un fichier.`
  },
  {
    fichier: 'src/main/phase-briefs.ts',
    avant: String.raw`code \`brain-*.ts\` — un FAIT durable`,
    apres: String.raw`code \`brain/brain-*.ts\` — un FAIT durable`
  },
  // Le sommaire de scout a un plafond de taille (scout-orientation.test.ts) : ses trois chemins
  // s'allongent de 22 octets ; « de la constitution, » doublait le nom du fichier cité juste après.
  {
    fichier: 'skills/scout/SKILL.md',
    avant: 'hard-gate CONSULTATIF de la constitution, `src/main/consignes/constitution.ts`)',
    apres: 'hard-gate CONSULTATIF de `src/main/consignes/constitution.ts`)'
  },
  // Dépôt d'essai jetable : ses chemins (et les commandes enregistrées qui les citent) ont suivi le
  // rangement ; le dossier qu'on y crée doit suivre aussi.
  {
    fichier: 'src/main/chat-turn-publication.test.ts',
    avant: "mkdirSync(join(repo, 'src', 'main'), { recursive: true })\n    const CONFIG = 'vitest.config.ts'",
    apres: "mkdirSync(join(repo, 'src', 'main', 'git'), { recursive: true })\n    const CONFIG = 'vitest.config.ts'"
  },
  {
    fichier: 'src/main/chat-turn-publication.test.ts',
    avant: "mkdirSync(join(repo, 'src', 'main'), { recursive: true })\n    const CODE = 'src/main/providers/relance-auto-moteur.ts'",
    apres: "mkdirSync(join(repo, 'src', 'main', 'providers'), { recursive: true })\n    const CODE = 'src/main/providers/relance-auto-moteur.ts'"
  },
  // Chemins HISTORIQUES : `git show <commit> -- <chemins>` sur un commit d'avant le rangement. Ils
  // désignent l'arbre de CE commit, ils ne bougent pas.
  {
    fichier: 'scripts/banc-orchestration-vs-nu.mjs',
    avant:
      "export const FICHIERS_CODE = [\n  'src/main/behaviour/behaviour-composition.ts',\n" +
      "  'src/main/consignes/chat-pilotage-prompt.ts',\n  'src/main/consignes/constitution.ts',\n" +
      "  'src/main/consignes/response-style.ts'\n]",
    apres:
      "export const FICHIERS_CODE = [\n  'src/main/behaviour-composition.ts',\n" +
      "  'src/main/chat-pilotage-prompt.ts',\n  'src/main/constitution.ts',\n" +
      "  'src/main/response-style.ts'\n]"
  },
  // Sans ce retour, `rmSync` visait dans la copie figée des chemins qui n'y existent pas : l'oracle
  // n'était plus caché au bras, et le test qui le vérifie passait quand même (faux vert).
  {
    fichier: 'scripts/banc-orchestration-vs-nu.mjs',
    avant:
      "export const FICHIERS_ORACLE = [\n  'src/main/behaviour/behaviour-composition.test.ts',\n" +
      "  'src/main/consignes/chat-pilotage-prompt.symptome-moindre-cout.test.ts',\n" +
      "  'src/main/consignes/ordre-de-priorite-des-consignes.test.ts',\n" +
      "  'src/main/consignes/response-style.test.ts'",
    apres:
      "export const FICHIERS_ORACLE = [\n  'src/main/behaviour-composition.test.ts',\n" +
      "  'src/main/chat-pilotage-prompt.symptome-moindre-cout.test.ts',\n" +
      "  'src/main/ordre-de-priorite-des-consignes.test.ts',\n" +
      "  'src/main/response-style.test.ts'"
  },
  // Les fichiers du banc existent dans SA base figée, plus forcément dans l'arbre courant.
  {
    fichier: 'scripts/banc-orchestration-vs-nu.test.mjs',
    avant: 'for (const f of FICHIERS_CODE) expect(existsSync(path.join(racine, f))).toBe(true)',
    apres: "for (const f of FICHIERS_CODE) expect(gitDans(racine, ['cat-file', '-t', `${BASE}:${f}`]).trim(), f).toBe('blob')"
  },
  {
    fichier: 'scripts/banc-orchestration-vs-nu.test.mjs',
    avant: '      expect(existsSync(path.join(racine, f))).toBe(true)\n      expect(FICHIERS_CODE).not.toContain(f)',
    apres:
      "      expect(gitDans(racine, ['cat-file', '-t', `${BASE}:${f}`]).trim(), f).toBe('blob')\n" +
      '      expect(FICHIERS_CODE).not.toContain(f)'
  },
  // Attentes de TEXTE D'IMPORT dans un autre fichier que le test : elles suivent le fichier lu.
  {
    fichier: 'src/main/brain-query-command.test.ts',
    avant: `"import { retrieveBrainContext } from './brain-retrieval'"`,
    apres: `"import { retrieveBrainContext } from '../brain/brain-retrieval'"`
  },
  {
    fichier: 'src/main/verify-command.portee-arbre.test.ts',
    avant: `"import { readGitState } from '../git-read-main'"`,
    apres: `"import { readGitState } from '../git/git-read-main'"`
  },
  {
    fichier: 'src/main/startup-splash.test.ts',
    avant: `"import { BOOT_SPLASH_DOCUMENT } from '../shared/boot-splash'"`,
    apres: `"import { BOOT_SPLASH_DOCUMENT } from '../../shared/boot-splash'"`
  },
  {
    fichier: 'src/main/shadow-router.test.ts',
    avant: String.raw`from ['"]\.\.\/main\/shadow-router['"]/`,
    apres: String.raw`from ['"]\.\.\/main\/modeles\/shadow-router['"]/`
  },
  {
    fichier: 'src/main/hooks/jetons-de-cause.sans-git-bloquant.test.ts',
    avant: "import { resolve, sep } from 'node:path'\n",
    apres:
      "import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'\n" +
      "import { tmpdir } from 'node:os'\n" +
      "import { join, sep } from 'node:path'\n"
  },
  {
    fichier: 'src/main/hooks/jetons-de-cause.sans-git-bloquant.test.ts',
    avant: "    const cible = resolve(process.cwd(), 'src/main/hooks/default-gate-hooks.ts').split(sep).join('/')\n",
    apres:
      "    // Fichier jetable non suivi : ne dépend pas du dernier commit du vrai fichier.\n" +
      "    const dossier = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-jeton-')))\n" +
      "    cp.execFileSync('git', ['init', '-q'], { cwd: dossier, windowsHide: true })\n" +
      "    const cible = join(dossier, 'corrige.ts').split(sep).join('/')\n" +
      "    writeFileSync(cible, '// fix-ok: essai, la cause est nommee\\nexport const x = 1\\n', 'utf8')\n"
  }
]

const EXT_CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const EXT_RESOLUES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']
const NON_TEXTE = /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|glb|gltf|bin|exe|dll|node|wasm|zip|7z|gz|mp3|mp4|wav|ogg|webm|woff2?|ttf|otf|pdf|onnx|blend)$/i
const ESTTEST = /\.(?:test|spec)(?:-helpers?)?\.[cm]?[jt]sx?$/

const familleDe = (nom) => nom.split('.')[0]

/** Familles → dossier, avec contrôle des doublons du plan. */
export function familleVersDossier(plan = PLAN) {
  const carte = new Map()
  for (const [dossier, familles] of Object.entries(plan)) {
    for (const f of familles) {
      if (carte.has(f)) throw new Error(`famille « ${f} » rangée deux fois (${carte.get(f)} et ${dossier})`)
      carte.set(f, dossier)
    }
  }
  return carte
}

/** Le plan concret : fichiers de la racine de src/main → nouveau chemin (relatif au dépôt, en `/`). */
export function calculerDeplacements(racine, plan = PLAN) {
  const dossierMain = join(racine, 'src', 'main')
  const carte = familleVersDossier(plan)
  const fichiers = readdirSync(dossierMain).filter((n) => statSync(join(dossierMain, n)).isFile())
  const oublies = [...new Set(fichiers.map(familleDe).filter((f) => !carte.has(f)))].sort()
  const deplacements = new Map()
  const collisions = []
  for (const nom of fichiers) {
    const dossier = carte.get(familleDe(nom))
    if (!dossier || dossier === '.') continue
    const cible = `src/main/${dossier}/${nom}`
    if (existsSync(join(racine, cible))) collisions.push(cible)
    deplacements.set(`src/main/${nom}`, cible)
  }
  const famillesAbsentes = [...carte.keys()].filter((f) => !fichiers.some((n) => familleDe(n) === f))
  return { deplacements, oublies, collisions, famillesAbsentes, total: fichiers.length }
}

const sansExt = (p) => {
  for (const e of EXT_RESOLUES) if (p.endsWith(e)) return { base: p.slice(0, -e.length), ext: e }
  return { base: p, ext: '' }
}

/** Index de résolution : chemin complet OU sans extension → nouveau chemin (même forme). */
function indexer(deplacements) {
  const complet = new Map(deplacements)
  const parBase = new Map()
  for (const [ancien, nouveau] of deplacements) {
    const a = sansExt(ancien)
    const n = sansExt(nouveau)
    if (a.ext) parBase.set(a.base, n.base)
  }
  return { complet, parBase }
}

/** Nouveau chemin (relatif au dépôt) d'une cible, si elle bouge ; sinon elle-même. */
function nouveauChemin(cibleAncienne, index) {
  if (index.complet.has(cibleAncienne)) return index.complet.get(cibleAncienne)
  const { base, ext } = sansExt(cibleAncienne)
  if (index.parBase.has(base)) return index.parBase.get(base) + ext
  if (index.parBase.has(cibleAncienne)) return index.parBase.get(cibleAncienne)
  return cibleAncienne
}

const cheminDeDisque = (cibleAncienne, index) => index.complet.get(cibleAncienne) ?? cibleAncienne

function specRelatif(depuisDossier, versChemin) {
  let r = posix.relative(depuisDossier, versChemin)
  if (!r.startsWith('.')) r = `./${r}`
  return r
}

const MOTIF_IMPORT =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire(?:\.resolve)?\s*\(\s*|\bcreateRequire\(\s*import\.meta\.url\s*\)\s*\(\s*|\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\s*(?:<[^>()]*>)?\s*\(\s*|\bimportActual\s*(?:<[^>()]*>)?\s*\(\s*)(['"`])(\.{1,2}\/[^'"`\n$]*)\2/g

/**
 * Vrai si `pos` tombe dans une chaîne ouverte plus tôt sur la même ligne : un test qui ATTEND un
 * texte d'import (`toContain("import x from '../y'")`) ou qui écrit un fichier d'essai ne parle pas
 * de SES imports — les réécrire depuis le test fausserait l'attente.
 */
function dansUneChaine(texte, pos, masque) {
  if (masque) return masque[pos] === 1
  const debut = texte.lastIndexOf('\n', pos - 1) + 1
  let ouvert = null
  for (let i = debut; i < pos; i++) {
    const c = texte[i]
    if (c === '\\') {
      i++
      continue
    }
    if (ouvert) {
      if (c === ouvert) ouvert = null
    } else if (c === "'" || c === '"' || c === '`') ouvert = c
    else if (c === '/' && texte[i + 1] === '/') return false
  }
  return ouvert !== null
}

/**
 * Carte des caractères qui sont du TEXTE de chaîne (`'…'`, `"…"`, gabarit `` `…` `` sur plusieurs
 * lignes, hors `${…}`), commentaires et expressions régulières sautés. Le code d'essai qu'un test
 * écrit dans un fichier temporaire vit dans ces chaînes : ses `import`, `new URL(…)` et
 * `join(__dirname, …)` parlent du fichier temporaire, pas du test. TSX exclu (texte JSX libre) :
 * on y retombe sur la lecture ligne à ligne.
 */
export function masqueDesChaines(t) {
  const m = new Uint8Array(t.length + 1)
  const pile = []
  let accolades = 0
  let precedent = ''
  const gabarit = (j) => {
    while (j < t.length) {
      if (t[j] === '\\') {
        m[j] = 1
        m[j + 1] = 1
        j += 2
        continue
      }
      if (t[j] === '`') return j + 1
      if (t[j] === '$' && t[j + 1] === '{') {
        pile.push(accolades)
        accolades++
        return j + 2
      }
      m[j] = 1
      j++
    }
    return j
  }
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') i++
      continue
    }
    if (c === '/' && t[i + 1] === '*') {
      const f = t.indexOf('*/', i + 2)
      i = f < 0 ? t.length : f + 2
      continue
    }
    if (c === "'" || c === '"') {
      i++
      while (i < t.length && t[i] !== c && t[i] !== '\n') {
        if (t[i] === '\\') m[i++] = 1
        m[i++] = 1
      }
      i++
      precedent = c
      continue
    }
    if (c === '`') {
      i = gabarit(i + 1)
      precedent = '`'
      continue
    }
    if (c === '/' && (precedent === '' || '(,=:[!&|?{};+-*%<>~^'.includes(precedent))) {
      i++
      let classe = false
      while (i < t.length && t[i] !== '\n') {
        if (t[i] === '\\') {
          i += 2
          continue
        }
        if (t[i] === '[') classe = true
        else if (t[i] === ']') classe = false
        else if (t[i] === '/' && !classe) break
        i++
      }
      i++
      while (i < t.length && /[a-z]/i.test(t[i])) i++
      precedent = '/'
      continue
    }
    if (c === '{') accolades++
    else if (c === '}') {
      if (pile.length && pile[pile.length - 1] === accolades - 1) {
        pile.pop()
        accolades--
        i = gabarit(i + 1)
        precedent = '`'
        continue
      }
      accolades--
    }
    if (!/\s/.test(c)) precedent = c
    i++
  }
  return m
}

const masquePour = (fichier, texte) => (/\.[jt]sx$/.test(fichier) ? null : masqueDesChaines(texte))

/** 1. Imports relatifs d'un fichier de code. */
export function reecrireImports(texte, ancienFichier, nouveauFichier, index) {
  const ancienDossier = posix.dirname(ancienFichier)
  const nouveauDossier = posix.dirname(nouveauFichier)
  let n = 0
  const masque = masquePour(ancienFichier, texte)
  const sortie = texte.replace(MOTIF_IMPORT, (tout, avant, q, spec, decalage, entier) => {
    const cibleAncienne = posix.normalize(posix.join(ancienDossier, spec))
    const cibleNouvelle = nouveauChemin(cibleAncienne, index)
    if (cibleNouvelle === cibleAncienne && ancienDossier === nouveauDossier) return tout
    if (dansUneChaine(entier, decalage, masque)) return tout
    const neuf = specRelatif(nouveauDossier, cibleNouvelle)
    if (neuf === spec) return tout
    n++
    return `${avant}${q}${neuf}${q}`
  })
  return { texte: sortie, n }
}

const LIT = String.raw`(?:'[^'\\\n]*'|"[^"\\\n]*")`
const valeurs = (args) => [...args.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)].map((m) => m[1] ?? m[2])

/**
 * 2. Chemins calculés depuis le dossier du fichier, dans un TEST (ou son aide `.test-helpers`).
 *
 * Bases reconnues : `__dirname`, `import.meta.dirname`, un alias `const ICI = dirname(fileURLToPath(
 * import.meta.url))` — ils SUIVENT le fichier — et un dossier calculé une fois
 * (`const RACINE = join(__dirname, '..', '..')`, `join(process.cwd(), 'src', 'main')`), qui reste FIXE.
 *   - `join(base, 'a', 'b')` tout en littéraux : vise la même cible, à son nouveau chemin si elle bouge ;
 *   - `join(base, '..', f)` avec une variable : garde le même dossier de départ, et les littéraux
 *     `'x.ts'` du fichier qui y désignaient un fichier EXISTANT suivent ce fichier
 *     (`['os.ts', 'index.ts'].map((f) => readFileSync(join(__dirname, f)))`, `lire('os.ts')`) ;
 *   - `new URL('./x', import.meta.url)`.
 * Le code de l'app n'y passe pas : empaqueté, son `__dirname` est `out/main`.
 */
export function reecrireCheminsDeTest(texte, ancienFichier, nouveauFichier, index, existe) {
  const ancienDossier = posix.dirname(ancienFichier)
  const nouveauDossier = posix.dirname(nouveauFichier)
  const deplace = ancienDossier !== nouveauDossier
  let n = 0
  const bases = new Map([
    ['__dirname', { suit: true }],
    ['import.meta.dirname', { suit: true }],
    ['process.cwd()', { fixe: '.' }]
  ])
  const motifIci =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)|import\.meta\.dirname|__dirname)\s*(?=[;\n])/g
  for (const m of texte.matchAll(motifIci)) bases.set(m[1], { suit: true })
  const nomsSuiveurs = [...bases.keys()].filter((k) => k !== 'process.cwd()').map(echapper).join('|')
  const motifAlias = new RegExp(
    String.raw`(?:const|let|var)\s+(\w+)\s*=\s*(?:path\.)?(?:join|resolve)\(\s*(${nomsSuiveurs}|process\.cwd\(\))((?:\s*,\s*${LIT})*)\s*\)`,
    'g'
  )
  for (const m of texte.matchAll(motifAlias)) {
    const depart = m[2] === 'process.cwd()' ? '.' : ancienDossier
    bases.set(m[1], { fixe: posix.normalize(posix.join(depart, ...valeurs(m[3]))) })
  }
  const depuis = (b, ancien) => (b.suit ? (ancien ? ancienDossier : nouveauDossier) : b.fixe)
  const noms = [...bases.keys()].sort((a, b) => b.length - a.length).map(echapper).join('|')
  const motifAppel = new RegExp(
    String.raw`\b(join|resolve)\(\s*(${noms})((?:\s*,\s*${LIT})*)(\s*,[^)]*)?\s*\)`,
    'g'
  )
  const dossiersDeLecture = new Set()
  const masque1 = masquePour(ancienFichier, texte)
  let sortie = texte.replace(motifAppel, (tout, fn, nom, args, reste, decalage, entier) => {
    if (dansUneChaine(entier, decalage, masque1)) return tout
    const b = bases.get(nom)
    const baseAncienne = depuis(b, true)
    const baseNouvelle = depuis(b, false)
    const cibleAncienne = posix.normalize(posix.join(baseAncienne, ...valeurs(args)))
    if (reste) {
      dossiersDeLecture.add(cibleAncienne)
      if (!b.suit || !deplace) return tout
      const rel = posix.relative(baseNouvelle, cibleAncienne)
      n++
      return rel === '' ? `${fn}(${nom}${reste})` : `${fn}(${nom}, '${rel}'${reste})`
    }
    // Chemin de DISQUE : correspondance exacte seulement — `join(x, 'agent-pilot')` est le dossier,
    // pas le module `agent-pilot.ts` (qu'un import sans extension désignerait).
    const cibleNouvelle = cheminDeDisque(cibleAncienne, index)
    if (cibleNouvelle === cibleAncienne && !(b.suit && deplace)) return tout
    const rel = posix.relative(baseNouvelle, cibleNouvelle)
    const neuf = rel === '' ? `${fn}(${nom})` : `${fn}(${nom}, '${rel}')`
    if (neuf === tout) return tout
    n++
    return neuf
  })
  const masque2 = masquePour(ancienFichier, sortie)
  sortie = sortie.replace(
    /new URL\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1\s*,\s*import\.meta\.url\s*\)/g,
    (tout, q, spec, decalage, entier) => {
      if (dansUneChaine(entier, decalage, masque2)) return tout
      const cibleAncienne = posix.normalize(posix.join(ancienDossier, spec))
      const cibleNouvelle = cheminDeDisque(cibleAncienne, index)
      if (cibleNouvelle === cibleAncienne && !deplace) return tout
      let neuf = posix.relative(nouveauDossier, cibleNouvelle) || '.'
      if (!neuf.startsWith('.')) neuf = `./${neuf}`
      // `new URL('../assets/', …)` désigne un DOSSIER : sa barre finale compte.
      if (spec.endsWith('/') && !neuf.endsWith('/')) neuf += '/'
      if (neuf === spec) return tout
      n++
      return `new URL(${q}${neuf}${q}, import.meta.url)`
    }
  )
  const litteraux = []
  if (dossiersDeLecture.size && existe) {
    const motifLitteral = /(['"])((?:\.{1,2}\/)?[\w./-]+\.(?:tsx?|mts|cts|mjs|cjs|js|json|md))\1/g
    const masque3 = masquePour(ancienFichier, sortie)
    sortie = sortie.replace(motifLitteral, (tout, q, val, decalage, entier) => {
      if (dansUneChaine(entier, decalage, masque3)) return tout
      const avant = entier.slice(Math.max(0, decalage - 40), decalage)
      if (/(?:\bfrom|\bimport|\brequire|mock|importActual)\s*\(?\s*(?:<[^>]*>\s*\()?\s*$/.test(avant)) return tout
      for (const dossier of dossiersDeLecture) {
        const cibleAncienne = posix.normalize(posix.join(dossier, val))
        if (!cibleAncienne.startsWith('src/') || !existe(cibleAncienne)) continue
        let neuf = posix.relative(dossier, cheminDeDisque(cibleAncienne, index))
        if (val.startsWith('./') && !neuf.startsWith('.')) neuf = `./${neuf}`
        if (neuf === val) return tout
        n++
        litteraux.push(`${val} → ${neuf}`)
        return `${q}${neuf}${q}`
      }
      return tout
    })
  }
  return { texte: sortie, n, litteraux }
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 3. Chemins `src/main/<fichier>` écrits en texte, dans n'importe quel fichier. */
export function preparerChemins(deplacements) {
  const parFamille = new Map()
  for (const [ancien, nouveau] of deplacements) {
    const nom = ancien.slice('src/main/'.length)
    parFamille.set(familleDe(nom), posix.dirname(nouveau).slice('src/main/'.length))
  }
  const familles = [...parFamille.keys()].sort((a, b) => b.length - a.length).map(echapper).join('|')
  // `src/main/<famille>` suivi d'une extension ou d'une étoile (motif) — jamais nu : `commands` et
  // `agent-pilot` sont AUSSI des dossiers, et `src/main/commands/x.ts` ne doit pas bouger.
  // Séparateurs : `/`, `\`, `\\` (chaîne JS) et `\/` (expression régulière : /src\/main\/x\.ts/).
  const motifPlat = new RegExp(String.raw`src(\\\/|\\\\|\\|\/)main\1(${familles})(?=\\?\.[A-Za-z]|\*)`, 'g')
  const motifEclate = new RegExp(String.raw`(['"])src\1(\s*,\s*)(['"])main\3(\s*,\s*)(['"])((?:${familles})\.[^'"\n]+)\5`, 'g')
  return { parFamille, motifPlat, motifEclate }
}

export function reecrireChemins(texte, prep) {
  let n = 0
  let sortie = texte.replace(prep.motifPlat, (tout, sep, famille) => {
    n++
    return `src${sep}main${sep}${prep.parFamille.get(famille)}${sep}${famille}`
  })
  sortie = sortie.replace(prep.motifEclate, (tout, q1, v1, q2, v2, q3, nom) => {
    n++
    return `${q1}src${q1}${v1}${q2}main${q2}${v2}${q3}${prep.parFamille.get(familleDe(nom))}${q3}, ${q3}${nom}${q3}`
  })
  return { texte: sortie, n }
}

function git(racine, args) {
  return execFileSync('git', args, { cwd: racine, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function fichiersDuDepot(racine) {
  const suivis = git(racine, ['ls-files', '-z']).split('\0').filter(Boolean)
  const nonSuivis = git(racine, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean)
  // `AGENTS.md` est ignoré par git (propre au poste) mais nomme les « sources uniques » par leur
  // chemin : il doit suivre le rangement, comme ceux des sous-dossiers.
  // Liste fixe : `git ls-files --ignored` parcourrait `.autowin-data/` entier (des minutes).
  const consignesIgnorees = ['', 'src/', 'src/main/', 'src/renderer/', 'scripts/', 'skills/']
    .flatMap((d) => [`${d}AGENTS.md`, `${d}CLAUDE.md`])
    .filter((f) => existsSync(join(racine, f)))
  return { suivis: new Set(suivis), tous: [...new Set([...suivis, ...nonSuivis, ...consignesIgnorees])] }
}

export function ranger({ racine, appliquer = false, refuserSiModifie = false, journal = console.error }) {
  const { deplacements, oublies, collisions, famillesAbsentes, total } = calculerDeplacements(racine)
  const rapport = { total, aDeplacer: deplacements.size, oublies, collisions, famillesAbsentes }
  if (oublies.length || collisions.length) return { ...rapport, ok: false }
  if (refuserSiModifie) {
    const sale = git(racine, ['status', '--porcelain', '--', 'src/main']).trim()
    if (sale) return { ...rapport, ok: false, refus: `src/main a ${sale.split('\n').length} fichier(s) non commité(s)` }
  }
  const index = indexer(deplacements)
  const prep = preparerChemins(deplacements)
  const { suivis, tous } = fichiersDuDepot(racine)
  const ecritures = new Map()
  const litterauxReecrits = []
  const retouchesRatees = []
  const existe = (p) => existsSync(join(racine, p))
  let nImports = 0
  let nChemins = 0
  let nTests = 0
  for (const fichier of tous) {
    if (NON_TEXTE.test(fichier) || fichier.startsWith('node_modules/') || fichier.startsWith('out/')) continue
    const absolu = join(racine, fichier)
    if (!existsSync(absolu)) continue
    let texte
    try {
      texte = readFileSync(absolu, 'utf8')
    } catch {
      continue
    }
    if (texte.includes('\0')) continue
    const nouveauFichier = deplacements.get(fichier) ?? fichier
    let neuf = texte
    if (EXT_CODE.test(fichier)) {
      const r = reecrireImports(neuf, fichier, nouveauFichier, index)
      neuf = r.texte
      nImports += r.n
      if (ESTTEST.test(fichier)) {
        const t = reecrireCheminsDeTest(neuf, fichier, nouveauFichier, index, existe)
        neuf = t.texte
        nTests += t.n
        for (const l of t.litteraux) litterauxReecrits.push(`${nouveauFichier}: ${l}`)
      }
    }
    if (!fichier.startsWith('scripts/ranger-src-main.')) {
      const c = reecrireChemins(neuf, prep)
      neuf = c.texte
      nChemins += c.n
    }
    for (const r of RETOUCHES.filter((x) => x.fichier === fichier)) {
      const nb = neuf.split(r.avant).length - 1
      if (nb !== 1) {
        retouchesRatees.push(`${fichier} : « ${r.avant.slice(0, 70)} » trouvé ${nb} fois au lieu d'une`)
        continue
      }
      neuf = neuf.replace(r.avant, () => r.apres)
    }
    if (neuf !== texte) ecritures.set(fichier, neuf)
  }
  for (const r of RETOUCHES) if (!tous.includes(r.fichier)) retouchesRatees.push(`${r.fichier} : fichier absent`)
  Object.assign(rapport, { fichiersReecrits: ecritures.size, nImports, nChemins, nTests, litterauxReecrits, retouchesRatees })
  // Une retouche qui ne trouve plus son texte veut dire que le fichier a changé depuis l'écriture du
  // plan : on refuse plutôt que de ranger à moitié.
  if (retouchesRatees.length) return { ...rapport, ok: false }
  if (!appliquer) return { ...rapport, ok: true, aBlanc: true }

  for (const [fichier, texte] of ecritures) writeFileSync(join(racine, fichier), texte, 'utf8')
  const dossiers = new Set([...deplacements.values()].map((c) => posix.dirname(c)))
  for (const d of dossiers) mkdirSync(join(racine, d), { recursive: true })
  const aSuivre = []
  for (const [ancien, nouveau] of deplacements) {
    if (suivis.has(ancien)) aSuivre.push([ancien, nouveau])
    else renameSync(join(racine, ancien), join(racine, nouveau))
  }
  // `git mv` par paquets, groupés par dossier cible : garde l'historique (renommage détecté).
  const parDossier = new Map()
  for (const [a, n] of aSuivre) {
    const d = posix.dirname(n)
    if (!parDossier.has(d)) parDossier.set(d, [])
    parDossier.get(d).push(a)
  }
  for (const [d, liste] of parDossier) {
    for (let i = 0; i < liste.length; i += 100) git(racine, ['mv', '-k', ...liste.slice(i, i + 100), d])
  }
  const manquants = [...deplacements.values()].filter((c) => !existsSync(join(racine, c)))
  journal(`déplacés : ${deplacements.size - manquants.length}/${deplacements.size}`)
  return { ...rapport, ok: manquants.length === 0, manquants }
}

const estLanceDirectement = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (estLanceDirectement) {
  const args = process.argv.slice(2)
  const iRacine = args.indexOf('--racine')
  const racine = resolve(iRacine >= 0 ? args[iRacine + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'))
  const r = ranger({
    racine,
    appliquer: args.includes('--appliquer'),
    refuserSiModifie: args.includes('--refuser-si-modifie')
  })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}
