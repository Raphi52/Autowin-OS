/**
 * Le vocabulaire des évènements du pilote — SOURCE UNIQUE, partagée par le main et le renderer.
 *
 * Pourquoi ce fichier existe : la liste des `kind` était écrite DEUX FOIS à la main, dans
 * `src/main/agent-pilot/agent-pilot.ts` et dans `src/renderer/src/components/ChatView.tsx`, et elle avait déjà
 * DÉRIVÉ — le main émettait `reasoning` et `prompt-call`, absents de la liste du renderer. Comme la
 * frontière IPC fait un cast non vérifié (`raw as PilotEvent`), rien ne signalait l'écart : le
 * renderer se contentait de ne jamais reconnaître ces deux évènements.
 *
 * Ce qui est mis en commun est le VOCABULAIRE, pas la forme complète. Les deux côtés lisent
 * légitimement des champs différents (le renderer n'a que faire de `prompt`/`callUsage`), et le type
 * large du main dépend de `PromptEnvelope`/`Usage` qui vivent dans `src/main/providers` : les faire
 * descendre ici pour unifier la forme entière échangerait une dérive contre une inversion de couches.
 */
export type PilotEventKind =
  | 'delta'
  | 'stream-reset'
  | 'think'
  /** Raisonnement LIVE du modèle pendant qu'il réfléchit — affiché, jamais persisté. */
  | 'reasoning'
  /**
   * Décodage d'image de la skill look : le raisonnement émis APRÈS le chargement de `look` dans le tour.
   * Affiché dans son propre bloc, jamais dans le bloc « Raisonnement » ni dans la réponse.
   */
  | 'look-decode'
  | 'command'
  /** Signe de vie d'une action LONGUE encore en cours : ne resout rien. */
  | 'action-progress'
  /**
   * Signe de vie TECHNIQUE du provider (outil en cours, tache de fond, retry API). N'est PAS du
   * raisonnement : il remplace le precedent au lieu de s'accumuler, et ne va jamais dans le bloc
   * « Reflexion » — constat utilisateur du 2026-09-01 : « il m'ecrit encore des trucs useless ».
   */
  | 'provider-status'
  | 'result'
  | 'done'
  | 'error'
  | 'retry'
  | 'cancellation'
  | 'prompt-call'
  | 'artifact'
  /**
   * Bilan de fin de tour : les echecs restes SANS reprise. Ecrit dans le journal du tour pour que
   * « abandonne » soit un fait, et non l'absence d'une ligne de rattrapage.
   */
  | 'echecs-abandonnes'
  /**
   * Commandes shell que le CLI a coupées en fin de tour et que l'app RELANCE hors du tour
   * (`src/main/chat/relance-taches-de-fond.ts`). Consommé par le main ; jamais affiché tel quel.
   */
  | 'taches-de-fond'
  /**
   * Tests joués par l'agent dans son terminal et leur code de sortie (`data` : `TestDuTerminal[]`),
   * relayés dès leur résultat. Le tour les garde ; la carte du fil les lit comme des vérifications.
   */
  | 'tests-du-terminal'
  /**
   * Réponse coupée par le filtre de sécurité du fournisseur (`data` : catégorie et explication),
   * relayée à chaque coupure. Écrite au journal du tour pour la rétrospective et le
   * kaizen ; l'avis lisible, lui, est déjà dans la réponse.
   */
  | 'coupure-filtre'

// fix-ok: cause mesurée — la couverture de l'union n'était vérifiée par aucun contrôle compilé : un genre fantôme ajouté à `PilotEventKind` passait `npm run typecheck:web` (code 0) et vitest (3/3). Ce Record, lu par le typage du renderer et du main, le fait échouer.
/**
 * Garde de COMPILATION du vocabulaire : une clé par genre de `PilotEventKind`, ni plus ni moins.
 * Ajouter un genre à l'union sans l'ajouter ici fait échouer `npm run typecheck` sur cette ligne
 * (« Property '<genre>' is missing »). Elle vit dans ce fichier et non dans un test : les `*.test.ts`
 * de `src/shared` ne sont lus par aucun tsconfig, alors que celui-ci l'est (le renderer et le main
 * l'importent). Le test `pilot-events.test.ts` fige le contenu de ce Record.
 */
export const GENRES_DU_PILOTE: Record<PilotEventKind, true> = {
  delta: true,
  'stream-reset': true,
  think: true,
  reasoning: true,
  'look-decode': true,
  command: true,
  'action-progress': true,
  'provider-status': true,
  result: true,
  done: true,
  error: true,
  retry: true,
  cancellation: true,
  'prompt-call': true,
  artifact: true,
  'echecs-abandonnes': true,
  'taches-de-fond': true,
  'tests-du-terminal': true,
  'coupure-filtre': true
}
