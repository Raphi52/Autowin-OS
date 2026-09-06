/**
 * REGISTRE DES POINTS D'APPEL BRAIN — la liste que l'Observatory prétend exhaustive.
 *
 * Le mot « exhaustif » n'a de valeur que s'il est FALSIFIABLE : ce fichier déclare, un par un, les
 * endroits du produit qui parlent au Brain (lecture, écriture) ou qui INJECTENT du savoir Brain dans
 * un prompt. `brain-injection-points.test.ts` relit les sources et casse dès qu'un appel Brain
 * existe sans être déclaré ici — ou qu'un point déclaré n'émet plus sa trace. Un quatrième trou ne
 * peut donc plus s'ouvrir en silence : il devient un test rouge, pas une absence invisible.
 */

/** Nature de l'appel, telle que l'Observatory l'affiche. */
export type BrainPointKind =
  /** Contexte préchargé par un run (RAG de tâche). */
  | 'automatic'
  /** Commande explicite du modèle (`brain_query`). */
  | 'query'
  /** Empreinte durable du dépôt chargée à chaque run (skill `think`). */
  | 'empreinte'
  /** Contexte poussé au tour de chat avant l'appel provider. */
  | 'push'
  /** Recherche déclenchée à la main dans l'interface. */
  | 'search'
  /** Dépôt de savoir vers le Brain (`POST /ingest`). */
  | 'write'
  /** Couche de transport partagée : tracée par ses appelants, jamais deux fois. */
  | 'transport'

/** Emplacement exact d'un appel, vérifié à la lettre par l'invariant. */
export interface BrainCallSite {
  file: string
  /** Fragment EXACT de la ligne d'appel ; sa disparition casse le test. */
  anchor: string
}

export interface BrainInjectionPoint {
  id: string
  label: string
  kind: BrainPointKind
  /** Le contenu récupéré part-il dans un prompt envoyé à un modèle ? */
  injecte: boolean
  /**
   * `spool` = ce point écrit une trace lisible par l'Observatory ;
   * `porte-par-appelant` = couche partagée, tracée par les points qui l'appellent ;
   * `non-trace` = TROU DÉCLARÉ : l'appel existe et n'écrit AUCUNE trace. Il est nommé ici plutôt
   *   que passé sous silence — `manque` dit ce qu'il faudrait pour le combler. Un point `non-trace`
   *   sans `manque` est refusé par l'invariant : un trou se documente ou n'existe pas.
   */
  emission: 'spool' | 'porte-par-appelant' | 'non-trace'
  /** Obligatoire quand `emission = 'non-trace'` : ce qui manque pour que ce point soit tracé. */
  manque?: string
  sites: BrainCallSite[]
  /** Où la trace est réellement émise (vérifié par l'invariant quand `emission = 'spool'`). */
  trace?: BrainCallSite
  pourquoi: string
}

export const BRAIN_INJECTION_POINTS: readonly BrainInjectionPoint[] = [
  {
    id: 'orchestration-task-rag',
    label: 'Run · RAG de tâche',
    kind: 'automatic',
    injecte: true,
    emission: 'spool',
    sites: [
      {
        file: 'src/main/orchestrator.ts',
        anchor: ': await (this.deps.retrieveBrain ?? retrieveBrainContext)(task, {'
      }
    ],
    trace: { file: 'src/main/orchestrator.ts', anchor: 'onBrainRetrieved?.({' },
    pourquoi: 'Savoir curé injecté en tête de contexte de chaque phase du run.'
  },
  {
    id: 'orchestration-empreinte-depot',
    label: 'Run · empreinte du dépôt (skill think)',
    kind: 'empreinte',
    injecte: true,
    emission: 'spool',
    sites: [
      {
        file: 'src/main/orchestrator.ts',
        anchor: 'const chargee = await (this.deps.retrieveBrain ?? retrieveBrainContext)('
      }
    ],
    trace: { file: 'src/main/orchestrator.ts', anchor: "kind: 'empreinte'" },
    pourquoi: "Chargée à CHAQUE run et injectée en tête de contexte : une seconde injection Brain, invisible tant qu'elle n'était pas tracée."
  },
  {
    id: 'command-brain-query',
    label: 'Commande · brain_query',
    kind: 'query',
    injecte: true,
    emission: 'spool',
    sites: [
      {
        file: 'src/main/commands.ts',
        anchor: ': await this.retrieveBrain(decision.query, { corpus })'
      }
    ],
    trace: { file: 'src/main/commands.ts', anchor: "kind: 'query'" },
    pourquoi: 'Récupération à la demande du modèle, rendue dans le résultat de commande.'
  },
  {
    id: 'chat-context-push',
    label: 'Chat · contexte poussé avant l’appel provider',
    kind: 'push',
    injecte: true,
    emission: 'spool',
    sites: [
      { file: 'src/main/amitel-context.ts', anchor: '? retrieveBrain(boundedQuery)' },
      { file: 'src/main/amitel-context.ts', anchor: '${origin}/query`' }
    ],
    trace: { file: 'src/main/amitel-context.ts', anchor: "kind: 'pousse'" },
    pourquoi:
      "Voie poussée du chat (`sources: ['brain']`) : injecte un bloc Brain dans le prompt sans passer par le run."
  },
  {
    id: 'ui-brain-search',
    label: 'Interface · recherche Brain manuelle',
    kind: 'search',
    injecte: false,
    emission: 'spool',
    sites: [
      // Ancre volontairement AMPUTEE du prefixe `ipcMain.` : ecrire le motif complet ferait passer
      // ce registre pour un declarant de canal IPC aux yeux de la garde de securite, qui relit les
      // sources. Une liste d'inventaire ne doit pas se faire prendre pour la surface qu'elle decrit.
      { file: 'src/main/ipc/brain.ts', anchor: "handle('os:searchBrain'" },
      { file: 'src/preload/index.ts', anchor: "ipcRenderer.invoke('os:searchBrain'" }
    ],
    trace: { file: 'src/main/ipc/brain.ts', anchor: "kind: 'recherche'" },
    pourquoi:
      'Appel réel au Brain déclenché par l’humain (GraphView, banc de retrieval) : consomme le même retriever que les runs.'
  },
  {
    id: 'command-brain-remember',
    label: 'Commande · brain_remember (dépôt)',
    kind: 'write',
    injecte: false,
    emission: 'spool',
    sites: [{ file: 'src/main/commands.ts', anchor: 'outcome = await rememberFact(a, {' }],
    trace: { file: 'src/main/commands.ts', anchor: "kind: 'depot'" },
    pourquoi: 'Écriture vers le Brain demandée par le modèle : un appel Brain, dans l’autre sens.'
  },
  {
    id: 'learning-proposal-release',
    label: 'Apprentissage · leçon promue au Brain',
    kind: 'write',
    injecte: false,
    emission: 'non-trace',
    sites: [{ file: 'src/main/commands.ts', anchor: 'const deposited = await rememberFact(' }],
    manque:
      "le dépôt d'une leçon promue passe par `rememberFact` sans `appendBrainTrace` : seule la " +
      'commande `remember` explicite est tracée, la promotion automatique reste muette.',
    pourquoi: 'Dépôt automatique d’une leçon validée par les preuves du run.'
  },
  {
    id: 'brain-http-transport',
    label: 'Transport · /challenge + /query-secure',
    kind: 'transport',
    injecte: false,
    emission: 'porte-par-appelant',
    sites: [
      { file: 'src/main/brain-retrieval.ts', anchor: '${origin}/challenge`' },
      { file: 'src/main/brain-retrieval.ts', anchor: '${origin}/query-secure`' }
    ],
    pourquoi:
      'Couche partagée par tous les points de lecture : la tracer ici doublerait chaque récupération.'
  },
  {
    id: 'brain-ingest-transport',
    label: 'Transport · /ingest',
    kind: 'transport',
    injecte: false,
    emission: 'porte-par-appelant',
    sites: [{ file: 'src/main/brain-remember.ts', anchor: '${origin}/ingest`' }],
    pourquoi: 'Couche partagée par les deux points d’écriture ci-dessus.'
  }
]

/** Identifiants déclarés, pour typer les traces sans dupliquer la liste. */
export type BrainPointId = (typeof BRAIN_INJECTION_POINTS)[number]['id']

export function brainInjectionPoint(id: string): BrainInjectionPoint | undefined {
  return BRAIN_INJECTION_POINTS.find((point) => point.id === id)
}
