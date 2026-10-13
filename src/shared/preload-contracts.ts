/**
 * Types du CONTRAT IPC preload<->renderer qui n'ont pas d'équivalent côté main — soit parce que la
 * forme est propre au pont (pièce jointe AVANT persistance, avec `content`/`kind` bruts), soit parce
 * que main délègue le travail à un worker générique (le graphe brain) dont le typage précis vit côté
 * normalisation (`main/viz/graph.ts`), pas au point d'entrée IPC. Tout type qui a un équivalent exporté
 * dans `src/main/**` doit être IMPORTÉ de là — jamais dupliqué ici.
 */

/** Pièce jointe telle qu'envoyée par le renderer à `pilotChat` — avant tout stockage. */
export interface ChatAttachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  content: string
  thumbnail?: string
}

/**
 * `SlotBinding`/`AgentTopology` DÉLIBÉRÉMENT LÂCHES (reasoningEffort: string, pas la union littérale
 * `ReasoningEffort` de `main/topology.ts`). `AgentsTopologyView.tsx` (renderer, hors périmètre des
 * sessions qui maintiennent ce contrat) manipule ce state comme un `string` avant de le renvoyer à
 * `setTopology` — resserrer vers le type main cassait sa compilation. Contrat preload volontairement
 * distinct du type main, pas un oubli : ne PAS remplacer par un import de `main/topology`.
 */
export interface SlotBinding {
  slotId: string
  provider: string
  modelId: string
  reasoningEffort: string
}
export interface AgentTopology {
  version: number
  orchestrator: SlotBinding
  subagents: SlotBinding[]
  panels: {
    scout: SlotBinding[]
    frame: SlotBinding[]
    terrain: SlotBinding[]
    judge: SlotBinding[]
  }
}

/**
 * `NativePreflightTrace` DÉLIBÉRÉMENT DIVERGENT de `main/activity/native-preflight.ts` : le `source`
 * réel y est le littéral unique `'native'`, alors que ce contrat déclare depuis toujours
 * 'plugin-hook' | 'request-dump' — et `ObservatoryView.tsx` (renderer, hors périmètre) caste vers ses
 * propres types locaux sur la base de CETTE union. Incohérence main/preload PRÉEXISTANTE (le `source`
 * réel ne colle à aucune des deux valeurs déclarées ici) : signalée, non corrigée (fichier renderer
 * hors scope). Ne PAS remplacer par un import du type main sans traiter aussi ObservatoryView.tsx.
 */
export interface NativePreflightTrace {
  schema: 'autowin.native-preflight/v1'
  timestamp: string
  sessionId: string
  turnId: string
  apiRequestId: string
  provider: string
  model: string
  apiMode?: string
  conversationId?: string
  fidelity: 'exact-redacted'
  boundary: 'native.pre_api_request'
  source: 'plugin-hook' | 'request-dump'
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
}

/** Le dossier de travail : le dépôt sur lequel les runs s'exécutent (vu depuis l'interface). */
/**
 * Le Brain renseigné dans les Réglages : un chemin et/ou un dépôt git (`src/main/brain-reglage.ts`).
 * Sans dépôt, c'est un simple dossier : Autowin n'y lance aucune commande git.
 */
export interface BrainReglageState {
  /** Dossier du Brain au démarrage de cette session. */
  actif: string
  /** Dossier qu'Autowin utilise compte tenu du réglage enregistré. */
  effectif: string
  /** Le réglage enregistré, ou `null` : résolution automatique (variables, installation du poste). */
  choisi: { chemin?: string; depot?: string } | null
  /** Vrai seulement si un dépôt est renseigné : la clôture des runs y commite leurs notes. */
  estUnDepot: boolean
  /** Le dossier effectif diffère de celui du démarrage : redémarrer Autowin. */
  redemarrageNecessaire: boolean
  /** Dossier que sert le serveur Brain déjà lancé, s'il répond. */
  serveurRacine: string | null
  /** Le serveur lancé sert un AUTRE dossier : tant qu'il tourne, les notes déposées y partent. */
  serveurSurUnAutreDossier: boolean
  /** Raison d'un enregistrement refusé (chemin introuvable, clonage raté…). */
  erreur?: string
}

export interface ExecutionWorkspaceState {
  /** Le dossier ACTIF pour cette session — figé au démarrage. */
  path: string
  /** Le dossier choisi et enregistré, s'il y en a un. */
  chosen: string | null
  /** Faux = pas un dépôt git : les copies de travail isolées seront désactivées. */
  isGitRepo: boolean
  /** Vrai quand le choix enregistré diffère de l'actif : il faut redémarrer. */
  restartRequired: boolean
}
