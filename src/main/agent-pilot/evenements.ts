// Événements du pilote de chat et types de reprise d'un tour, sortis tels quels de
// agent-pilot.ts (lot 1). agent-pilot.ts les ré-exporte : ses importeurs ne changent pas.
import type { ContexteStatique } from '../../shared/contexte-detaille'
import type { PilotEventKind } from '../../shared/pilot-events'
import type { ChatArtifact } from '../../shared/artifacts'
import type {
  Message,
  PromptEnvelope,
  SendResult,
  TacheDeFondARelancer,
  Usage
} from '../providers/types'

export type TurnUsage = {
  inputTokens: number
  outputTokens: number
  costUsd?: number
  /**
   * ENTREE DU DERNIER APPEL, distincte du cumul ci-dessus.
   *
   * `inputTokens` SOMME toutes les iterations du tour : c'est ce qu'il faut pour la depense, et
   * c'est faux pour l'OCCUPATION de la fenetre — le prefixe est renvoye a chaque appel, donc la
   * somme le compte autant de fois qu'il y a eu d'iterations. Un tour de neuf appels rendait
   * 578 207 tokens pour une fenetre de 200 000, et la jauge de contexte restait collee a 100 %
   * (mesure du 2026-09-04, journal d'activite). L'occupation reelle, c'est ce que le
   * DERNIER appel a recu.
   */
  derniereEntree?: number
  /** Part du DERNIER appel relue depuis le cache — sous-ensemble de `derniereEntree`. */
  derniereEntreeCache?: number
  /**
   * MODELE ET PROVIDER SERVIS. Sans eux, `contextGauge()` ne trouve aucune fenetre et rend
   * `undefined` : la jauge de contexte ne s'affichait donc JAMAIS, ni sur le filet du champ ni
   * dans l'en-tete, alors que le journal d'activite portait bien `claude-opus-5`. Le modele est
   * celui que le provider a REELLEMENT servi (`res.model`), pas celui demande.
   */
  model?: string
  provider?: string
  /**
   * PARTIE FIXE DU CONTEXTE, mesuree par le CLI pendant le DERNIER appel (prompt systeme, outils,
   * outils MCP, fichiers memoire, skills). Ecrasee comme `derniereEntree` : le panneau « Contexte »
   * en deduit les messages. Absente pour un provider qui ne sait pas mesurer.
   */
  contexte?: ContexteStatique
}

/**
 * Union discriminée sur `kind` : chaque variante ne porte que ses champs REELS, non-optionnels
 * quand ils le sont vraiment. Avant, `PilotEvent` etait une interface a ~20 champs optionnels pour
 * 13 `kind` differents — rien n'empechait d'ecrire `{kind:'command'}` sans `name`, ou
 * `{kind:'result'}` sans `actionId` : l'erreur ne se voyait qu'a l'execution. Le typage devient
 * l'oracle : un site d'emission incomplet ne compile plus.
 *
 * `PilotEvent` (large, ci-dessous) reste exporte tel quel pour les consommateurs hors-perimetre
 * (preload/renderer/main index.ts) qui l'utilisent deja de façon structurelle — cette union est
 * assignable a `PilotEvent` (chaque champ requis d'une variante est un optionnel de meme nom/type
 * dans le large), donc `emit(e: PilotEvent)` continue d'accepter ces valeurs sans changement
 * d'API externe.
 */
export type PilotEventVariant =
  | { kind: 'delta'; streamId: string; text: string; iteration: number }
  | { kind: 'stream-reset'; streamId: string; iteration: number; conclusionSeule?: true }
  /** `iteration` : le fil en fait le flux `fallback:<iteration>` (effaçable par une relance, D2). */
  | { kind: 'think'; text: string; iteration?: number }
  /** Raisonnement LIVE du modèle pendant qu'il réfléchit — affiché, jamais persisté dans le message. */
  | { kind: 'reasoning'; text: string; iteration: number }
  | {
      kind: 'command'
      actionId: string
      name: string
      args: unknown
      /**
       * Lien de REPRISE : `actionId` d'une action de MEME nom qui a echoue plus tot dans le tour et
       * qui n'avait pas encore ete retentee. Heuristique assumee (d'ou « probable »), pas une
       * verite : le journal est append-only, on ne peut pas annoter l'echec apres coup, donc c'est
       * l'action qui rattrape qui porte le lien. Un echec sans aucune ligne pointant vers lui a
       * donc ete ABANDONNE — c'est exactement ce qu'on veut pouvoir lire.
       */
      repriseProbableDe?: string
      /** Bloc `<cmd>` casse puis repare sans ambiguite : la trace dit QUOI a ete corrige. */
      reparation?: string
    }
  /** Signe de vie d'une action LONGUE encore en cours : ne resout rien, remplace le precedent. */
  | { kind: 'action-progress'; actionId: string; text: string }
  /** Signe de vie TECHNIQUE du provider (outil, tache de fond, retry) — jamais du raisonnement. */
  | {
      kind: 'provider-status'
      text: string
      iteration: number
      /** Cible ENTIERE quand `text` l'a coupee pour tenir sur une ligne (cf. `StreamChunk.statusTarget`). */
      data?: { target: string }
      /**
       * Arguments et retour d'un outil natif FINI (cf. `StreamChunk.statusDetail`). Hors de `data`
       * exprès : le journal de tour recopie `data` (`CHAMPS_PILOTE`), seule la trace garde ce détail.
       */
      detail?: { envoye: string; retour: string }
    }
  | {
      kind: 'result'
      actionId: string
      name: string
      ok: boolean
      data?: unknown
      /** `actionId` de l'action EN ECHEC que cette reussite rattrape (meme nom, meme cible). */
      retryOf?: string
      attachments?: NonNullable<Message['attachments']>
    }
  | {
      kind: 'done'
      text: string
      usage?: TurnUsage
      /**
       * Issue d'orchestration STRUCTUREE. `text` en est la mise en forme humaine ; la trace, elle,
       * a besoin des champs (gateBlocked, valid, reused) pour etre filtrable et comptable — un
       * texte libre ne se filtre pas.
       */
      outcome?: Record<string, unknown>
    }
  | { kind: 'error'; text: string; usage?: TurnUsage }
  /**
   * ABANDON ECRIT, pas deduit. Emis une seule fois juste avant la fin du tour : la liste des
   * echecs restes sans reprise. Sans cet evenement, « abandonne » ne se lisait que par l'ABSENCE
   * d'une ligne de rattrapage — une absence ne se distingue pas d'un journal tronque.
   */
  | {
      kind: 'echecs-abandonnes'
      name: string
      data: { actionId: string; cible: string }[]
    }
  /** Commandes shell coupees par le CLI en fin de tour, que le tour de chat va RELANCER. */
  | { kind: 'taches-de-fond'; iteration: number; data: TacheDeFondARelancer[] }
  /** Tests joués par l'agent dans son terminal et leur code de sortie. */
  | {
      kind: 'tests-du-terminal'
      iteration: number
      data: Array<{ commande: string; codeDeSortie: number; changementDeDossier?: string }>
    }
  /** Les fichiers du projet qu'un appel vient d'écrire ; vide = la photo du dossier n'a rien vu changer. */
  | { kind: 'fichiers-ecrits'; iteration: number; data: string[] }
  /** Réponse coupée par le filtre de sécurité du fournisseur, une par coupure. */
  | {
      kind: 'coupure-filtre'
      iteration: number
      text: string
      data: { categorie?: string; explication?: string }
    }
  | { kind: 'retry'; iteration: number; name: string; text: string; data: unknown }
  | { kind: 'cancellation'; iteration: number; name: string; text: string; data: unknown }
  | {
      kind: 'prompt-call'
      iteration: number
      prompt: PromptEnvelope
      response: string
      status: 'completed' | 'failed'
      error?: string
      callUsage?: Usage
      callDurationMs: number
      sessionId?: string
      /** Identite concrete rapportee par le provider, distincte du modele demande. */
      resolvedModel?: string
    }
  | { kind: 'artifact'; artifact: ChatArtifact; iteration: number }

/**
 * Type LARGE historique, conserve pour la compatibilite des consommateurs hors-perimetre
 * (src/preload, src/renderer, src/main/index.ts) qui typent leurs propres event handlers dessus ou
 * le re-exportent. `AgentPilot.chat()` n'émet plus directement sur cette forme : en interne, chaque
 * évènement est construit comme `PilotEventVariant` (voir `emit()` dans `chat()`), qui est
 * structurellement assignable ici.
 */
export interface PilotEvent {
  conversationId?: string
  /**
   * Vocabulaire partagé avec le renderer (`src/shared/pilot-events.ts`). Écrit à la main des deux
   * côtés, il avait dérivé : `reasoning` et `prompt-call` manquaient côté renderer, sans que rien ne
   * le signale — la frontière IPC fait un cast non vérifié.
   */
  kind: PilotEventKind
  text?: string
  /**
   * Issue d'orchestration STRUCTUREE, portee par le `done`. `text` en est la mise en forme humaine ;
   * la trace, elle, a besoin des champs (gateBlocked, valid, reused) pour etre filtrable et
   * comptable — un texte libre ne se filtre ni ne se compte.
   */
  outcome?: Record<string, unknown>
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  /** `actionId` de l'action EN ECHEC que cette reussite rattrape (meme nom, meme cible). */
  retryOf?: string
  iteration?: number
  prompt?: PromptEnvelope
  response?: string
  status?: 'completed' | 'failed'
  error?: string
  callUsage?: Usage
  callDurationMs?: number
  sessionId?: string
  streamId?: string
  /** `stream-reset` : ne retirer que le dernier passage du flux (`rangsEffacesParLeReset`). */
  conclusionSeule?: true
  actionId?: string
  /** Heure de l'evenement (ms), posee a sa reception par le chat : rail du tour. */
  at?: number
  /** Cf. la variante `command` : action echouee que cette action retente (heuristique). */
  repriseProbableDe?: string
  artifact?: ChatArtifact
  /** Modele concret rapporte par le provider pour un appel termine. */
  resolvedModel?: string
  /** Pieces jointes brutes du resultat, durables cote main mais retirees avant l'IPC renderer. */
  attachments?: NonNullable<Message['attachments']>
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: TurnUsage
  /** Arguments et retour d'un outil natif fini (variante `provider-status`) : trace seule. */
  detail?: { envoye: string; retour: string }
}

/**
 * Résultat terminal d'un appel provider qui a fini pendant l'absence du main Electron. Le pilote
 * repart à l'itération enregistrée : il consomme ce résultat une fois, sans respawn équivalent.
 */
export interface RecoveredPilotProviderCall {
  iteration: number
  attempt: number
  streamId: string
  /** Préfixe déjà persisté dans le message avant le redémarrage : il ne doit pas être réémis. */
  streamedPrefix: string
  /** Résultats déjà persistés pour cette réponse provider : ne jamais rejouer leurs commandes. */
  settledActions?: RecoveredPilotActionResult[]
  result: SendResult
}

export interface RecoveredPilotActionResult {
  actionId: string
  name: string
  ok: boolean
  data?: unknown
  attachments?: NonNullable<Message['attachments']>
}

/** Barrière durable du chat direct, publiée par l'adaptateur avant son spawn. */
export interface PilotProviderJournalLink {
  provider: string
  token: string
  journalPath: string
  iteration: number
  attempt: number
  streamId: string
  requestId: string
}
