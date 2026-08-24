import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Racine de données ISOLÉE pour les tests. Une seule ligne, mais elle ferme une pollution mesurée.
 *
 * MESURÉ le 2026-08-13 : `%APPDATA%utowin-os
uns\conv-1` contenait 6 396 dossiers de run et
 * 14 146 fichiers, accumulés depuis le 18 juillet. La cause n'était pas l'application : c'est la SUITE
 * DE TESTS qui écrivait dans les données réelles de l'utilisateur. Preuve par avant/après autour d'un
 * seul fichier — `src/main/commands.test.ts` crée +12 dossiers à chaque exécution (6 384 → 6 396), et
 * une première hypothèse (une boucle auto-kaizen en production) a été RÉFUTÉE par la même mesure sur un
 * autre fichier, qui n'en créait aucun.
 *
 * Trois dégâts, dont le dernier est le pire : des runs fantômes que l'application croit réels ; 14 000
 * fichiers à énumérer pour 5,8 Mo ; et surtout un test qui ÉCRIT dans l'environnement qu'il mesure —
 * de quoi faire passer au vert du code qui lit ce dossier, et fausser toute mesure de démarrage qui
 * l'énumère.
 *
 * `app-data.ts` résout sa racine via `process.env.APPDATA`, donc la fixer ici couvre TOUS les stores de
 * TOUS les tests d'un coup : conversations, tâches planifiées, coûts, runs, traces. Chemin stable et non
 * aléatoire, pour qu'un test qui écrit puis relit fonctionne, et pour qu'on puisse le vider d'un geste.
 *
 * Si un test échoue à cause de ça, c'est un FINDING et non une régression : il dépendait des données
 * réelles du poste, donc il n'était pas reproductible ailleurs.
 */
const RACINE_DONNEES_TESTS = join(tmpdir(), 'autowin-tests-appdata')

/**
 * Réglages de stabilité de la suite, sans modifier sa résolution ni son isolation.
 *
 * Pourquoi : la suite compte ~240 fichiers joués en parallèle (~150 s de temps de test cumulé). Sous
 * cette charge, un worker peut voir son event loop affamé bien au-delà du défaut vitest de 5 s — pour
 * du travail qui prend 50 ms à vide. Symptôme observé : un test rouge DIFFÉRENT à chaque passe, vert
 * en isolation. Ce n'était pas un code fragile, c'était une horloge trop serrée.
 *
 * 20 s laisse passer la contention sans jamais masquer un vrai blocage (un test réellement pendu
 * échoue toujours, 15 s plus tard). Les rares fichiers à I/O lourde (vrais dépôts git, copie d'un
 * exécutable de ~100 Mo) relèvent encore ce budget chez eux via `vi.setConfig`.
 *
 * Le pool `forks` de Vitest 3.2.7 laisse ici un appel RPC `onTaskUpdate` sans réponse jusqu'à son
 * timeout interne de 60 s, même lorsque toutes les assertions passent. Le pool `threads` conserve
 * l'isolation par fichier mais remplace le canal `child_process` fautif par un `MessagePort`.
 * Quatre workers bornent en plus la contention des tests qui créent de vrais dépôts et worktrees Git,
 * y compris quand plusieurs worktrees Autowin valident leurs chantiers en même temps.
 */
export default defineConfig({
  test: {
    /**
     * Perimetre STRICT du depot. Sans exclusion, vitest ramassait les COPIES de code que les agents
     * deposent sous `Audit/` ou `artifacts/` (instances headless, worktrees d'agents) : mesure du
     * 2026-08-11 — une commande ciblant un seul fichier a rejoué deux copies historiques et pris
     * 514 s au lieu d'environ 250 s. Mesure initiale du 2026-07-29 —
     * 323 fichiers de test collectes au lieu de ~160, dont 164 qui ne se chargeaient meme pas
     * (dependances absentes dans ces copies). Consequence : la suite paraissait massivement rouge des
     * qu'un agent tournait, et le vrai signal devenait illisible.
     */
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      'Audit/**',
      'artifacts/**',
      '**/worktrees/**',
      // LA RACINE DE DONNEES DE L'APP, en entier. L'exclusion des worktrees juste au-dessus ne
      // suffit pas : mesure le 2026-08-24, une orchestration a cree `.autowin-data/tmp-fusion-main/`
      // -- une copie COMPLETE du depot, hors de tout dossier de worktrees. La suite est passee de 737
      // a 1421 fichiers, et 4 des 5 echecs venaient de cette copie. Exactement la panne que le
      // commentaire ci-dessus decrit, par un chemin que son exclusion ne couvrait pas.
      //
      // Aucun test de SOURCE ne vit sous `.autowin-data` : c'est de la donnee d'execution.
      //
      // COMMENTAIRES DE LIGNE A DESSEIN : la premiere version de cette note etait un bloc `/* */`
      // citant un motif glob. Or ce motif contient la sous-chaine qui FERME un bloc, donc le
      // commentaire se terminait au milieu et cassait la syntaxe du fichier. `npm run typecheck` est
      // passe a zero malgre tout -- il ne couvre pas ce fichier. Seule l'execution de la suite l'a dit.
      '.autowin-data/**',
      '**/.autowin-data/**',
      '**/.claude/**',
      // Harnais Node autonome, couvert par cdp-verdict-collection.test.mjs.
      'scripts/cdp-verdict.test.mjs',
      /**
       * Tests `*.live.test.*` : ils consomment un VRAI provider (coût réel, réseau, authentification).
       * Ils répondent à une question qu'aucun mock ne tranche — « le modèle produit-il vraiment ce que
       * le renderer sait rendre ? » — mais les laisser dans la suite par défaut ferait payer un appel
       * modèle à chaque `npm test`, et rendrait la suite rouge hors ligne. Lancement EXPLICITE :
       * `npx vitest run --config vitest.live.config.ts` — `--exclude` en CLI ne surcharge PAS cette
       * liste (vérifié : « No test files found »), d'où une config dédiée plutôt qu'un drapeau.
       */
      '**/*.live.test.*'
    ],
    /**
     * HERMETICITE vis-a-vis de l'app EN COURS D'EXECUTION — meme classe de panne que l'exclusion
     * d'`Audit/` ci-dessus : la suite doit mesurer le DEPOT, jamais l'environnement qui la lance.
     *
     * `AUTOWIN_RUN_JOURNAL_ROOT` est une variable de RUNTIME : l'app la pose pour activer la survie
     * niveau 2 (CLI spawne DETACHE, sortie vers un journal sur disque). Lancer `npm run test:unit`
     * depuis un terminal issu de l'app la fait FUIR dans les workers vitest. Consequence mesuree le
     * 2026-08-07 : `claude.ts` basculait sur le chemin journal (`relay`, `stdio: 'ignore'`), donc le
     * stdout simule par les tests n'etait JAMAIS lu — 6 tests de l'adaptateur Claude rouges
     * (artefacts absents, `text` vide, erreur 529 avalee, argv reduit aux 3 args du relais), verts en
     * shell propre. Un faux rouge qui accusait le code au lieu de l'environnement.
     *
     * Valeur VIDE (donc falsy) : le code retombe sur le pipe, exactement le comportement que les
     * tests decrivent. Rien n'est modifie cote production ni cote assertions.
     */
    env: {
      AUTOWIN_RUN_JOURNAL_ROOT: '',
      // Voir `RACINE_DONNEES_TESTS` : aucun test n'écrit plus dans le %APPDATA% réel.
      APPDATA: RACINE_DONNEES_TESTS
    },
    pool: 'threads',
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
