import { rappelSansDejaEnvoye } from './rappel-conversations'
import type { ContexteStatique } from '../shared/contexte-detaille'
import { forgetChatSession, loadChatSessions, saveChatSession } from './runs/chat-session-store'
import {
  deposerCompteRenduNonVu,
  lireCompteRenduNonVu,
  oublierCompteRenduNonVu
} from './runs/compte-rendu-non-vu-store'
import {
  deciderRejeuDeChat,
  deciderRepliApresRefus,
  dormirAnnulable,
  estCrashDExecutionDuCli
} from './chat-rejeu-surcharge'
import { classifierRefusDeReprise, refusDeRepriseEstTransitoire } from './runs/resume-refusal'
import { chargerMurs, enregistrerMur } from './runs/murs-store'
import type { ProviderRegistry } from './providers/registry'
import { basculeApresQuota } from './providers/registry'
import type { RoleBinding, RoleModelConfig } from './roles'
import type { AppCommandBus, CommandResult } from './commands'
import {
  ProviderCallError,
  type Message,
  type PromptEnvelope,
  type SendOptions,
  type SendResult,
  type TacheDeFondARelancer,
  type Usage
} from './providers/types'
import { parseModelQuestion, type ModelQuestion } from './model-questions'
import {
  askFaitChoisirUneProposition,
  boucleDraftEnCours,
  REFUS_ASK_DRAFT,
  STATUT_REFUS_ASK_DRAFT
} from './draft-choix-par-boutons'
import { coupesParPoids } from './chat-session-poids'
import { loadConvActivity } from './activity/conv-activity'
import {
  appendShellWriteTraces,
  appendWorkspaceMutationTrace,
  captureMutationTraceBase
} from './activity/trace-workspace-mutation'
import { evictedCount, rememberedFacts, sessionMemoryBlock } from './session-memory-echo'
import { blocProfilUtilisateur } from './profil-utilisateur'
import { blocLangueDeReponse } from './langue-reglage'
import { lireLigneDErreur } from '../shared/erreur-d-action'
import { avertirSiLeconNonRetenue, ecritUnFichierDeMemoire } from './lecon-non-retenue'
import {
  buildTurnMessageBlocks,
  exigeAgirPasAnnoncer,
  consigneApresEchec,
  exigeCorrigerEtPoursuivre,
  cleDEchec,
  signatureDEchec,
  exigeDireLEchec,
  exigeUnChiffreVerifie,
  RELANCE_CHIFFRE_NON_VERIFIE,
  commandeAObserveLeReel,
  exigePreuveAvantDePromettre,
  RELANCE_PREUVE_AVANT_DE_PROMETTRE,
  exigeFaireLeGeste,
  RELANCE_FAIRE_LE_GESTE,
  blocVisuelNonFerme,
  RELANCE_BLOC_VISUEL_NON_FERME,
  questionPoseeSansAvoirLu,
  bilanDesOutilsNatifsRecuperes,
  statusEstUneAction,
  statusEstUneLecture,
  statutComplet,
  RELANCE_QUESTION_SANS_LECTURE,
  exigeUneConclusion,
  compactionsAbouties,
  motsUtilisateur,
  baliserRelanceAutomatique
} from './chat-turn-messages'
import {
  invokedSkillId,
  noteSkillInconnue,
  skillInstruction,
  skillNommeeSansBarre
} from './skill-pipeline'
import { VisibleStreamFilter } from '../shared/stream-markup-filter'
import { suivreBlocsDeCode } from '../shared/bloc-de-code'
import { FLUX_LECTURE_RETENUE } from '../shared/lecture-retenue'
import { randomUUID } from 'node:crypto'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { CONSTITUTION } from './constitution'
import { routeSkillRequest } from './skill-routing'
import { nativeSkills } from './native-registry'
import {
  AVIS_DEUX_LECTURES,
  CONSIGNE_DEUX_LECTURES,
  annonceDeLaLectureRetenue,
  chargeDeuxLectures,
  commandesCitees,
  consigneDeLectureRetenue,
  demandeDeChangementDeRendu,
  dernierMessageAgent,
  lectureAAnnoncer,
  lireLesLectures,
  meriteUneLecture,
  questionDesDeuxLectures,
  suitUneQuestionDesLectures,
  tacheAvecLectureRetenue,
  type IssueDesLectures
} from './deux-lectures'
import { estUneRepriseAutomatique } from './chat/relance-taches-de-fond'
import { estUnPromptDOrdre } from './messages-entre-fils-app'
import { estUnMessageDuPlan } from '../shared/plan-de-lots'
import { blocsSystemeEcran, buildChatPilotagePrompt } from './chat-pilotage-prompt'
import {
  conversationPretendueInaccessible,
  correctionConversationLisible,
  correctionOutilsPresents,
  outilsFaussementAbsents
} from '../shared/outil-pretendu-absent'
import { startTurnTimer } from './turn-timing'
import { avecAvisEnTete, avisOrientationsTardives } from './orientations-tardives'
import { claudeActiveAccountId } from './claude-accounts'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'
import {
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele,
  isDeliveredOrchestrationOutcome,
  orchestrationEnEchec,
  ORCHESTRATION_ALREADY_ISSUED_REFUSAL,
  type OrchestrationOutcome
} from '../shared/orchestration-outcome'
import type { ChatArtifact } from '../shared/artifacts'

/**
 * CAP D'ITÉRATIONS d'un tour de chat — UNE seule valeur par défaut, exportée.
 *
 * Relevé de 6 à 12 le 2026-07-29 : sur un blocage réel, l'agent consommait 4 itérations en
 * `edit_file` ratés avant même de pouvoir chercher une autre voie, puis s'arrêtait sur « cap atteint
 * sans réponse finale » en laissant des mutations partielles.
 *
 * Cette constante existe parce que le relèvement N'ATTEIGNAIT PAS l'application : le chat interactif
 * repliait sur un `?? 6` codé en dur (`index.ts`), et comme aucune police n'est fournie quand un
 * humain tape dans le composer, la production tournait à 6 pendant que la signature affichait 12.
 * Mesuré le 2026-08-19 en pilotant l'app : un scout a rendu « Cap d'itérations (6) atteint » et
 * aucun livrable. Deux valeurs par défaut concurrentes pour un même fait — le commentaire qui
 * justifiait 12 décrivait un monde qui n'existait pas.
 */
/*
 * RELEVÉ DE 12 À 40 le 2026-09-03 : demande utilisateur mesurée dans conv-37. La boucle réelle d'une
 * correction pilotée depuis le chat (chercher la règle → lire le fichier → éditer → naviguer →
 * observer → lire la capture → revenir) dépense à elle seule une dizaine d'appels ; à 12, le tour se
 * coupait AVANT la phrase de clôture et l'app affichait « Réponse interrompue avant la fin ».
 *
 * SUPPRIMÉ le 2026-09-04, demande explicite de l'utilisateur (conv-233, « ENLEVE CE PUTAIN DE
 * BLOQUAGE DE BUDGET ») : relever la borne ne faisait que déplacer la coupure. Ce compteur coupait
 * des tours ENGAGÉS alors qu'il ne mesure RIEN du coût réel — un tour de 41 appels bon marché était
 * tué, un tour de 5 appels ruineux passait. Le seul frein qui reste est l'annulation manuelle : le
 * budget du tour de chat a lui aussi été supprimé le 2026-09-16, sur demande de l'utilisateur
 * (« aucun blocage ») ; le coût est désormais MESURÉ et écrit, jamais coupé.
 * Avec l'infini, les injections « budget du tour » et « dernière itération » ne se déclenchent plus :
 * leurs conditions comparent l'index à une borne finie.
 */
export const CAP_ITERATIONS_TOUR = Number.POSITIVE_INFINITY
import type { PilotEventKind } from '../shared/pilot-events'
import { blocEtatSuivant, type EtatPrompt } from './etat-diff'
import { protegerRappel } from './observabilite-non-bloquante'
import { bornerResultatDeCommande } from './resultat-de-commande-borne'
import { pagesHtmlEnTexte } from '../shared/pages-html-pour-le-modele'
import { CONSIGNE_CLASSES_PAGES_HTML } from '../shared/classes-pages-html'
import {
  cleAppelNatif,
  estUnOutilDirectDuChat,
  ouvrirOutilsNatifsDuChat,
  type OuvertureOutilsNatifs
} from './chat-mcp'
import { cleDeVideo, videosLivreesDuTour } from './videos-livrees'

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
type TurnUsage = {
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
   * (mesure du 2026-09-04 sur conv-240, journal d'activite). L'occupation reelle, c'est ce que le
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
   * en deduit les messages (conv-1000). Absente pour un provider qui ne sait pas mesurer.
   */
  contexte?: ContexteStatique
}

export function resolveLatestUserMessage(
  history: Array<Pick<Message, 'role' | 'content'>>,
  routingUserMessageOverride?: string
): string | undefined {
  return (
    routingUserMessageOverride ??
    [...history].reverse().find((message) => message.role === 'user')?.content
  )
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
  | { kind: 'stream-reset'; streamId: string; iteration: number }
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
  /** Tests joués par l'agent dans son terminal et leur code de sortie (conv-1059). */
  | {
      kind: 'tests-du-terminal'
      iteration: number
      data: Array<{ commande: string; codeDeSortie: number }>
    }
  /** Réponse coupée par le filtre de sécurité du fournisseur, une par coupure (conv-1161). */
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
  actionId?: string
  /** Heure de l'evenement (ms), posee a sa reception par le chat : rail du tour (conv-338). */
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

/** Réussite visible de l'action, distincte de la seule réussite du transport IPC. */
export function commandResultSucceeded(result: CommandResult): boolean {
  if (!result.ok) return false
  if (!result.data || typeof result.data !== 'object') return true
  const data = result.data as Record<string, unknown>
  if (data.ok === false || data.valid === false || data.gateBlocked === true) return false
  /*
   * UN REFUS TRANSPORTE DANS UN SUCCES EST UN ECHEC — decision utilisateur du 2026-09-01 (conv-52).
   *
   * Plusieurs commandes rendent `{ok:true}` en portant un REFUS dans leur charge : `remember`
   * (`stored:false`, portee/type/source invalides, doublon), `verify` et `brain_query`
   * (`allowed:false`, rien n'a tourne). Le test ne regardait que `ok`/`valid`/`status`/`exitCode` :
   * ces resultats passaient pour des reussites, donc AUCUNE des gardes en aval ne s'armait — ni la
   * pastille rouge de l'action, ni le mur enregistre, ni la relance « corrige, puis poursuis ». Le
   * modele annoncait « je retiens ca » et rien n'etait ecrit. Le fait porteur est ce que la commande
   * dit d'ELLE-MEME (`stored` / `allowed` / `refused`), jamais la reussite du transport.
   */
  /*
   * SAUF le doublon VOULU (`dejaConnu`, brain-remember.ts) : le fait est DEJA en memoire, il n'y a
   * rien a corriger. Compte comme un echec, il relancait le tour (« ta dernière action a ÉCHOUÉ »)
   * deux fois pour rien — conv-1114, 2026-10-23.
   */
  if (data.stored === false && data.dejaConnu !== true) return false
  if (data.allowed === false || data.refused === true) return false
  /*
   * MEME FAMILLE, deux champs qui manquaient — mesure conv-244 (2026-09-04) sur les traces reelles :
   * `run` refuse rend `{ok:true, data:{lance:false, detail:"Commande refusee : ..."}}` et
   * `restart_app` indisponible rend `{redemarre:false}`. Rien n'a tourne, pourtant la trace causale
   * enregistrait ces resultats en `status:"completed"` — donc aucune garde d'echec ne s'armait.
   */
  if (data.lance === false || data.redemarre === false) return false
  if (data.status === 'failed' || data.status === 'red') return false
  return typeof data.exitCode !== 'number' || data.exitCode === 0
}

/**
 * Motif d'un depot memoire QUI N'A RIEN ECRIT, ou `undefined` quand la memoire est bien deposee.
 *
 * Mesure conv-33 (2026-09-01) : le Brain a rendu `{ok:true, data:{allowed:true, stored:false,
 * detail:"refuse par le Brain : not found"}}`. Ce resultat passe `commandResultSucceeded` — aucun
 * `ok:false`, aucun statut rouge, aucun exitCode — donc la garde de visibilite ne s'armait pas : le
 * tour s'est cloture sur « je depose la lecon » alors que RIEN n'etait ecrit, et l'utilisateur a lu
 * un tour qui semblait bloque. Le fait porteur est `stored`, jamais la reussite du transport : c'est
 * la meme lecture que `skill-node-mcp` fait deja cote MCP (« RIEN ECRIT »).
 */
/** Consigne unique de relance quand un tour qui a AGI ne conclut pas. Partagee par les DEUX
 *  chemins de cloture : la branche sans commande ET le raccourci `remember` auxiliaire. */
const RELANCE_CONCLUSION_ABSENTE =
  'SYSTÈME: ta réponse ne CONCLUT pas. Reformule-la MAINTENANT, SANS aucune commande, en ' +
  'terminant par ce bloc, court et concret : « ✅ Fait » (liste NUMÉROTÉE 1., 2., 3. de ce ' +
  'que tu as réellement fait, une ligne par action avec son résultat), puis l’état en trois lignes — 📍 Maintenant / ⏳ Reste à faire / 👉 ' +
  'Recommandé. N’écris aucune étiquette technique du type « [a exécuté … ] » et ' +
  'n’annonce pas ce que tu vas faire : le travail est déjà fait, dis ce qu’il a donné. ' +
  'Cette nouvelle réponse REMPLACE la précédente à l’écran : écris-la en entier, sans ' +
  'renvoyer à ce que tu avais écrit. ' +
  'N’écris PAS le mot « rien » seul dans une rubrique pour la remplir : ce mot éteint le mode ' +
  'auto du chat. Réserve-le au travail réellement terminé ; sinon dis le fait en clair.'

function motifDepotMemoireNonAbouti(result: CommandResult): string | undefined {
  if (!result.ok) return String(result.error ?? 'refus')
  const data = result.data as Record<string, unknown> | undefined
  if (!data || typeof data !== 'object') return undefined
  if (data.stored !== false) return undefined
  return typeof data.detail === 'string' && data.detail.trim()
    ? data.detail.trim()
    : JSON.stringify(data)
}

function failedOrchestrationOutcome(error: unknown): Record<string, unknown> {
  return {
    status: 'failed',
    valid: false,
    error: String(error ?? 'raison non rapportee')
  }
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

const CONTROL_RE = /<(cmd|question)>\s*([\s\S]*?)\s*<\/\1>/g
const REJECTED_QUESTION_RE = /<question>[\s\S]*?(?:<\/question>|$)/gi
const REJECTED_QUESTION_MARKER = '[question modèle refusée et masquée]'

export type OrderedPilotToken =
  | { kind: 'text'; text: string }
  | {
      kind: 'command'
      name: string
      args: Record<string, unknown>
      /** Le bloc recu etait casse et a ete repare SANS ambiguite (voir `reparerAccoladeFinaleManquante`). */
      reparation?: string
    }
  /**
   * Bloc `<cmd>` PRESENT mais inexploitable (JSON invalide, ou valide sans `name`). Avant, ces deux
   * cas etaient avales silencieusement : le modele croyait avoir agi, l'utilisateur recevait une
   * conclusion, et AUCUNE action n'avait eu lieu. Un faux « c'est fait » est le pire defaut possible
   * pour un agent — l'echec doit etre visible et corrigible.
   */
  | { kind: 'invalid'; raw: string; reason: string }

function filterVisibleText(raw: string): string {
  const filter = new VisibleStreamFilter()
  return filter.push(raw) + filter.finish()
}

/**
 * T1b — reconstruction du texte déjà streamé, FACTORISÉE. `chat()` doit émettre en `delta` le texte
 * final moins ce qui a déjà été streamé pendant l'appel provider (pour ne jamais dupliquer à
 * l'écran) — cette logique de `startsWith` vivait EN DOUBLE (cas « pas de commande » sur le texte
 * entier joint, et cas « ordered tokens » consommé token par token). Une seule fonction pure, les
 * deux mêmes 3 branches partout : le reste du texte déjà couvert par le préfixe streamé, le préfixe
 * restant à consommer, ou aucun recouvrement (le préfixe streamé ne correspond plus au texte final —
 * on ne réémet rien plutôt que de deviner).
 */
export function consumeStreamedPrefix(
  text: string,
  prefixRemaining: string
): { visible: string; prefixRemaining: string } {
  if (!prefixRemaining) return { visible: text, prefixRemaining: '' }
  if (prefixRemaining.startsWith(text)) {
    return { visible: '', prefixRemaining: prefixRemaining.slice(text.length) }
  }
  if (text.startsWith(prefixRemaining)) {
    return { visible: text.slice(prefixRemaining.length), prefixRemaining: '' }
  }
  return { visible: '', prefixRemaining: '' }
}

/**
 * COLLAGE DES DELTAS — deux textes émis à la suite sur le MÊME `streamId` sont concaténés tels quels
 * par le réducteur de tour (`reduceChatTurn`). Quand le premier ne finit pas par un saut de ligne et
 * que le suivant OUVRE une fence (« Voici :» + « ```html-render »), la fence se retrouve en milieu
 * de ligne : le rendu Markdown ne la reconnaît plus et l'utilisateur lit du HTML brut.
 *
 * La séparation est décidée à l'ÉMISSION, sur le texte DÉJÀ émis pour ce flux — on n'insère rien
 * quand le texte finit déjà par un saut de ligne, et JAMAIS au milieu d'un mot en cours de stream.
 */
export function separationDeltaCollee(dejaEmis: string, suivant: string): string {
  if (!dejaEmis || !suivant) return ''
  if (/\n[ \t]*$/.test(dejaEmis)) return ''
  // Seule une OUVERTURE de fence en tête du nouveau delta justifie de couper une ligne en cours.
  return /^[ \t]*(?:```|~~~)/.test(suivant) ? '\n\n' : ''
}

/**
 * FENCE SOUDEE EN MILIEU DE LIGNE — la moitie que `separationDeltaCollee` ne peut PAS voir.
 *
 * MESURE DU 2026-09-03 (conv-8, signalement utilisateur « le html ne s'est pas render ») : le
 * journal du tour porte un SEUL delta (`0:0:ordered:4`, 4 925 car.) dont le texte est
 * « …est bien branchee.```html-render
<!doctype html> ». Le collage n'est donc pas a la JOINTURE
 * de deux deltas — il est DEJA dans le texte d'un delta unique, assemble en amont de l'emission.
 * `DeltaCollageTracker` n'inspecte que la frontiere entre deux deltas : il ne pouvait rien y faire,
 * et CommonMark, qui exige une fence en debut de ligne, a rendu 4 900 caracteres de HTML en prose.
 *
 * La regle est volontairement ETROITE, parce que le prompt de chat parle lui-meme de
 * « ```html-render » au milieu de ses phrases : transformer ces mentions en vraies fences serait une
 * regression pire que le defaut. On ne coupe donc que si les QUATRE conditions d'une vraie
 * OUVERTURE sont reunies :
 *   (1) le marqueur est precede, sur la meme ligne, par autre chose que de l'espace ;
 *   (2) il est suivi d'une etiquette de langage d'un seul mot (`html-render`, `ts`, `json`) ;
 *   (3) cette etiquette TERMINE la ligne — une mention en prose se poursuit par des mots ;
 *   (4) on n'est pas DEJA dans une fence ouverte, ou ``` est du contenu.
 */
export function detacherFenceCollee(texte: string): string {
  if (!texte.includes('```') && !texte.includes('~~~')) return texte
  const lignes = texte.split(/(\r?\n)/u)
  const suivi = suivreBlocsDeCode()
  for (let index = 0; index < lignes.length; index += 2) {
    const ligne = lignes[index]
    if (suivi.delimiteur(ligne) || suivi.dansUnBloc) continue
    const soudure = /^(.*[^\s`~])(`{3,}|~{3,})([A-Za-z][\w-]*)[ \t]*$/u.exec(ligne)
    if (!soudure) continue
    lignes[index] = `${soudure[1]}\n\n${soudure[2]}${soudure[3]}`
    suivi.delimiteur(`${soudure[2]}${soudure[3]}`)
  }
  return lignes.join('')
}

/**
 * SOUDURE DE DEUX PHRASES — mesure du 2026-09-03 (signalement utilisateur, 6 occurrences dans
 * `conversations.json` : « je lance la vérification ciblée.Maintenant le côté écriture »). Le texte
 * d'une itération et celui de la suivante tombent dans la MÊME part ; quand le premier finit sur un
 * point et que le second commence par une lettre, la phrase suivante se colle au point et l'espace
 * manque à l'écran. Ce n'est PAS un défaut de rédaction du modèle : c'est le recollage des flux.
 *
 * La règle reste étroite pour ne pas couper ce qui se poursuit vraiment : rien si l'un des deux
 * côtés porte déjà une espace, rien si la phrase n'est pas terminée, rien devant un CHIFFRE (un
 * « version 1. » + « 2.3 » n'est pas une nouvelle phrase).
 */
const FIN_DE_PHRASE = /[.!?…][»”"')\]]*$/u
const DEBUT_DE_PHRASE = /^[\p{L}«“"'(#*\->`]/u

export function soudureDePhrases(precedent: string, suivant: string): boolean {
  if (!precedent || !suivant) return false
  if (/\s$/u.test(precedent) || /^\s/u.test(suivant)) return false
  return FIN_DE_PHRASE.test(precedent) && DEBUT_DE_PHRASE.test(suivant)
}

/**
 * Mémoire du texte déjà émis par `streamId`, pour deux cas de collage :
 * (1) un delta qui ouvre une fence juste après un préambule sans saut de ligne ;
 * (2) un delta qui REPREND un streamId après qu'un autre flux ait parlé — la reprise est recollée
 *     dans la même part alors que le lecteur attend un nouveau paragraphe.
 * À l'intérieur d'une fence déjà ouverte, aucune séparation n'est insérée : ``` y est du contenu.
 */
export class DeltaCollageTracker {
  private readonly emis = new Map<string, string>()
  private dernierStreamId: string | undefined

  separation(streamId: string, texte: string): string {
    const dejaEmis = this.emis.get(streamId) ?? ''
    const changementDeFlux = this.dernierStreamId !== undefined && this.dernierStreamId !== streamId
    /**
     * Le texte qui PRECEDE reellement ce delta dans la part rendue. Au premier delta d'un flux
     * NEUF, `dejaEmis` est vide par definition : lire ce flux-la ne pouvait donc rien separer,
     * et la fence arrivait collee a la phrase du flux precedent (mesure conv-1517).
     */
    const precedent = changementDeFlux
      ? (this.emis.get(this.dernierStreamId as string) ?? '')
      : dejaEmis
    let separation = ''
    if (precedent && !this.fenceOuverte(precedent)) {
      separation = changementDeFlux
        ? dejaEmis
          ? // REPRISE d’un flux deja parle : le lecteur attend un nouveau paragraphe.
            /\n[ \t]*$/.test(dejaEmis)
            ? ''
            : '\n\n'
          : // Flux NEUF : couper si le delta OUVRE une fence, ou si la phrase precedente est
            // TERMINEE et que le nouveau texte viendrait se souder a son point final. Hors de ces
            // deux cas on ne coupe rien — le modele peut simplement poursuivre sa phrase.
            separationDeltaCollee(precedent, texte) ||
            (soudureDePhrases(precedent, texte) ? '\n\n' : '')
        : separationDeltaCollee(dejaEmis, texte)
    }
    this.emis.set(streamId, dejaEmis + separation + texte)
    this.dernierStreamId = streamId
    return separation
  }

  private fenceOuverte(texte: string): boolean {
    const suivi = suivreBlocsDeCode()
    for (const ligne of texte.split('\n')) suivi.delimiteur(ligne)
    return suivi.dansUnBloc
  }
}

function retirerConclusionBloquantePrematuree(texte: string): string {
  let resultat = texte
  while (true) {
    const marqueurs =
      /^[ \t]*(?:(?:>[ \t]*)|(?:[-*+][ \t]+)|(?:\d+[.)][ \t]+))*(?:#{1,6}[ \t]+)?(?:(?:\*\*|__)[ \t]*)?⛔\uFE0F?[ \t]+Bloqué(?:[ \t]*(?:\*\*|__))?(?<suite>[^\r\n]*)/gimu
    let marqueur: RegExpExecArray | null
    let retrait: { debut: number; fin: number } | undefined
    while ((marqueur = marqueurs.exec(resultat)) !== null) {
      const suite = marqueur.groups?.suite ?? ''
      if (!/^[ \t]*(?:\p{P}|$)/u.test(suite)) continue
      const depuisMarqueur = resultat.slice(marqueur.index)
      const paragrapheSuivant = /\r?\n[ \t]*\r?\n/.exec(depuisMarqueur)
      retrait = {
        debut: marqueur.index,
        fin:
          paragrapheSuivant && paragrapheSuivant.index !== undefined
            ? marqueur.index + paragrapheSuivant.index + paragrapheSuivant[0].length
            : resultat.length
      }
      break
    }
    if (!retrait) return resultat
    const avant = resultat.slice(0, retrait.debut).trimEnd()
    const apres = resultat.slice(retrait.fin).trimStart()
    resultat = [avant, apres].filter(Boolean).join('\n\n')
  }
}

/**
 * `<cmd>` A LA FERMETURE ERRONEE — mesure conv-686, tour `6185f7e7-88fa-4add-bf84-c51741d1b8b0`
 * (2026-09-18) : le modele emet `<cmd>{...JSON complet...}</invoke>
</function_calls>` puis sa
 * phrase de cloture. Sans `</cmd>`, CONTROL_RE ne matchait rien : l'orchestration n'etait PAS
 * lancee et tout le texte depuis `<cmd>` (conclusion comprise) etait masque — l'utilisateur lisait
 * « Aucune reponse produite pour ce tour. ». fix-ok: fermeture `</invoke>` au lieu de `</cmd>`.
 * On recupere un objet JSON EQUILIBRE et PARSABLE juste apres `<cmd>`, on le referme proprement et
 * on retire les fermetures parasites qui le suivent. Un JSON incomplet reste intact (chemin invalid).
 */
export function normaliserFermeturesCmd(raw: string): string {
  let out = ''
  let i = 0
  while (true) {
    const start = raw.indexOf('<cmd>', i)
    if (start < 0) return out + raw.slice(i)
    const apresOuverture = start + 5
    let j = apresOuverture
    while (j < raw.length && /\s/.test(raw[j])) j++
    const fin = raw[j] === '{' ? finObjetJson(raw, j) : -1
    if (fin < 0) {
      out += raw.slice(i, apresOuverture)
      i = apresOuverture
      continue
    }
    const json = raw.slice(j, fin)
    const reste = raw.slice(fin)
    if (/^\s*<\/cmd>/.test(reste)) {
      out += raw.slice(i, fin)
      i = fin
      continue
    }
    try {
      JSON.parse(json)
    } catch {
      out += raw.slice(i, apresOuverture)
      i = apresOuverture
      continue
    }
    const parasites = /^(?:\s*<\/(?:invoke|function_calls|parameter|antml:[a-z_]+)>)*/.exec(reste)
    out += raw.slice(i, start) + '<cmd>' + json + '</cmd>'
    i = fin + (parasites ? parasites[0].length : 0)
  }
}

function finObjetJson(raw: string, debut: number): number {
  let profondeur = 0
  let dansChaine = false
  for (let k = debut; k < raw.length; k++) {
    const c = raw[k]
    if (dansChaine) {
      if (c === '\\') k++
      else if (c === '"') dansChaine = false
    } else if (c === '"') dansChaine = true
    else if (c === '{') profondeur++
    else if (c === '}' && --profondeur === 0) return k + 1
  }
  return -1
}

/** Un objet `{name, args?}` que le dispatch sait executer. */
function commandeExploitable(valeur: unknown): boolean {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const { name, args } = valeur as { name?: unknown; args?: unknown }
  if (typeof name !== 'string' || !name.trim()) return false
  return args === undefined || (!!args && typeof args === 'object' && !Array.isArray(args))
}

/** Au-dela, essayer chaque position couterait trop : le bloc reste `invalid` et la relance agit. */
const REPARATION_BUDGET_CARACTERES = 20_000_000

/**
 * `<cmd>` A UNE ACCOLADE FERMANTE PRES — mesure conv-159, tour
 * `b60bf535-44e5-47e8-b43a-e3260ddc74ef` (2026-10-10, journal `run-stdout/a18bb1fb…`) : le modele
 * ecrit `<cmd>{"name":"brain_query","args":{"question":"…"}</cmd>`, deux `{` pour une seule `}`.
 * Rejete en « JSON illisible ». La relance unique (posee pour conv-1472, tour `c73fd638`, MEME
 * defaut) n'a pas suffi : le modele a attribue la position de l'erreur aux accents (raisonnement de
 * l'iteration 1), a re-emis la MEME forme en ASCII, et le tour s'est clos sur « renvoie ton message ».
 * Lapsus RECURRENT du modele : la cause est hors depot.
 *
 * Ce que fait Autowin : quand UNE seule `}` manque et qu'il n'existe qu'UNE facon de la placer qui
 * donne une commande executable, l'intention est univoque — on l'execute, comme
 * `recupererCmdFermeeEnOutilNatif` (providers/claude.ts). On essaie CHAQUE position hors chaine : deux lectures
 * differentes (une `}` oubliee au milieu d'`args` imbriques) = ambigu -> `undefined`, le bloc reste
 * `invalid` et la relance s'en charge. Rien d'autre n'est repare (guillemet, virgule, `]`).
 */
export function reparerAccoladeFinaleManquante(bloc: string): string | undefined {
  const texte = bloc.trim()
  if (!texte.startsWith('{')) return undefined
  const positions: number[] = []
  const pile: string[] = []
  let dansChaine = false
  for (let k = 0; k < texte.length; k++) {
    const c = texte[k]
    if (dansChaine) {
      if (c === '\\') k++
      else if (c === '"') dansChaine = false
      continue
    }
    positions.push(k)
    if (c === '"') dansChaine = true
    else if (c === '{') pile.push('}')
    else if (c === '[') pile.push(']')
    else if ((c === '}' || c === ']') && pile.pop() !== c) return undefined
  }
  // Seule la racine reste ouverte : exactement UNE `}` manque, aucun `]`, aucune chaine ouverte.
  if (dansChaine || pile.length !== 1 || pile[0] !== '}') return undefined
  positions.push(texte.length)
  if (positions.length * texte.length > REPARATION_BUDGET_CARACTERES) return undefined
  const lectures = new Map<string, string>()
  for (const position of positions) {
    const candidat = `${texte.slice(0, position)}}${texte.slice(position)}`
    let lu: unknown
    try {
      lu = JSON.parse(candidat)
    } catch {
      continue // cette position ne donne pas de JSON : on essaie la suivante
    }
    if (!commandeExploitable(lu)) continue
    const cle = JSON.stringify(lu)
    if (!lectures.has(cle)) lectures.set(cle, candidat)
    if (lectures.size > 1) return undefined
  }
  return lectures.size === 1 ? [...lectures.values()][0] : undefined
}

/**
 * conv-686, tours `6185f7e7-88fa-4add-bf84-c51741d1b8b0` et `30876029-68c5-43c8-948c-59786b28a081`
 * (saisies ts 1789711890089 et 1789712145048) : le modele a emis une commande `<cmd>` illisible,
 * rien n'a ete lance, et l'ecran disait « Aucune reponse produite » — l'utilisateur a renvoye le
 * meme message sans savoir qu'une commande avait ete perdue. Le repli le dit desormais.
 */
export function texteCmdIlisible(): string {
  return (
    'J’ai voulu lancer une action, mais ma commande était mal formée : rien n’a été lancé. ' +
    'Renvoie ton message pour relancer.'
  )
}

export function parseOrderedPilotTokens(input: string): OrderedPilotToken[] {
  const raw = normaliserFermeturesCmd(input)
  const tokens: OrderedPilotToken[] = []
  let cursor = 0
  CONTROL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTROL_RE.exec(raw)) !== null) {
    const visible = filterVisibleText(raw.slice(cursor, match.index))
    if (visible) tokens.push({ kind: 'text', text: visible })
    if (match[1] === 'cmd') {
      const rawBlock = match[2]
      let lisible = rawBlock
      let reparation: string | undefined
      try {
        JSON.parse(rawBlock)
      } catch (erreurDeLecture) {
        const repare = reparerAccoladeFinaleManquante(rawBlock)
        if (repare) {
          lisible = repare
          reparation = 'accolade fermante manquante ajoutée (une seule lecture possible)'
        } else {
          tokens.push({
            kind: 'invalid',
            raw: rawBlock,
            reason: `JSON illisible : ${erreurDeLecture instanceof Error ? erreurDeLecture.message : String(erreurDeLecture)}`
          })
          cursor = match.index + match[0].length
          continue
        }
      }
      try {
        const parsed = JSON.parse(lisible) as {
          name?: string
          args?: Record<string, unknown>
        }
        // `name` doit être une STRING non vide : un `if (parsed.name)` laissait passer tout truthy
        // (`42`, `{}`, `[]`) → un token `command` portait un nom non-string, et le dispatch en aval
        // (comparaison/normalisation de nom) cassait sur une entrée qu'un modèle peut produire.
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
        if (name) {
          // `args` doit être un objet simple : un tableau/scalaire produirait un sac d'arguments
          // invalide côté exécution → on retombe sur un objet vide plutôt que de propager.
          const args =
            parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
              ? parsed.args
              : {}
          tokens.push(
            reparation ? { kind: 'command', name, args, reparation } : { kind: 'command', name, args }
          )
        } else {
          // JSON valide mais sans `name` exploitable : deuxieme trou silencieux du parseur d'origine.
          tokens.push({
            kind: 'invalid',
            raw: rawBlock,
            reason:
              parsed.name === undefined || parsed.name === null
                ? 'champ « name » absent'
                : 'champ « name » invalide (chaîne non vide attendue)'
          })
        }
      } catch (error) {
        tokens.push({
          kind: 'invalid',
          raw: rawBlock,
          reason: `JSON illisible : ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }
    cursor = match.index + match[0].length
  }
  const trailing = filterVisibleText(raw.slice(cursor))
  if (trailing) tokens.push({ kind: 'text', text: trailing })
  return tokens
}

/**
 * Capture avant/apres du dossier du tour, ABANDONNEE des qu'on annule : elle coute ~200 ms de git
 * sur un gros depot, et un Stop ne doit jamais attendre l'observabilite. Rend `undefined` = pas de
 * trace pour ce tour, jamais une erreur.
 */
async function captureSaufAnnulation(
  workspace: string,
  signal?: AbortSignal
): Promise<Awaited<ReturnType<typeof captureMutationTraceBase>>> {
  if (signal?.aborted) return undefined
  if (!signal) return captureMutationTraceBase(workspace, [])
  return new Promise((resolve) => {
    const abandon = (): void => resolve(undefined)
    signal.addEventListener('abort', abandon, { once: true })
    captureMutationTraceBase(workspace, [])
      .then(resolve, () => resolve(undefined))
      .finally(() => signal.removeEventListener('abort', abandon))
  })
}

function waitForAnswer(answer: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return answer
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason ?? 'aborted')))
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error(String(signal.reason ?? 'aborted')))
    signal.addEventListener('abort', abort, { once: true })
    answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

type PieceJointeDuFil = NonNullable<Message['attachments']>[number] & { thumbnail?: string }

/** Le binaire est-il REELLEMENT la ? Un `content` vide produirait un fichier vide chez le provider. */
function aPieceJointeLisible(piece: PieceJointeDuFil | undefined): boolean {
  return typeof piece?.content === 'string' && piece.content.length > 0
}

/**
 * Repli sur la MINIATURE persistee quand l'original n'a pas survecu a la relecture du fil.
 *
 * Le fil ne persiste que `AttachmentMeta` : nom, type, taille, miniature. Rouvrir une conversation
 * perd donc le binaire d'origine. La miniature, elle, est une vraie image (data URL) : degradee mais
 * LISIBLE. Le nom porte la mention pour que le modele ne prenne jamais la reduction pour la source.
 */
function replierSurLaMiniature(piece: PieceJointeDuFil | undefined): PieceJointeDuFil | undefined {
  const thumbnail = piece?.thumbnail
  if (!piece || typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image/'))
    return undefined
  const virgule = thumbnail.indexOf(',')
  const mimeType = thumbnail.slice(5, thumbnail.indexOf(';')) || 'image/png'
  const content = virgule >= 0 ? thumbnail.slice(virgule + 1) : ''
  if (!content) return undefined
  return {
    ...piece,
    name: `${piece.name} (miniature — original non conserve)`,
    mimeType,
    kind: 'image',
    size: content.length,
    content
  }
}

/**
 * L'identite du fil injectee au modele est celle du TOUR, jamais celle de l'onglet AFFICHE.
 * `snapshotForPrompt()` porte `activeConversationId`, pose par le renderer au changement d'onglet.
 * Un tour qui se joue dans conv-A pendant que l'utilisateur regarde conv-B faisait donc lire au
 * modele l'id de conv-B : il se croyait dans un autre fil, declarait son historique vide, et pouvait
 * partir chercher « le vrai fil » avec `conversation_search` — alors que l'historique, lui, etait
 * correctement transmis. Mesure (conv-526) : reponse « cet echange arrive dans un fil
 * different (conv-533)… ce fil-ci est vide » rendue DANS conv-526.
 */
export function snapshotDuTour<T extends { activeConversationId?: string }>(
  snapshot: T,
  conversationId?: string
): T {
  return conversationId ? { ...snapshot, activeConversationId: conversationId } : snapshot
}

/**
 * La description (SKILL.md) des commandes citées, pour le contrôle des deux lectures. Même source
 * que la palette `/`. Une lecture du disque qui échoue rend `{}` : le contrôle lit alors sans elles.
 */
function descriptionsDesCommandes(noms: readonly string[]): Record<string, string> {
  if (!noms.length) return {}
  try {
    const parNom = new Map(
      nativeSkills().map((skill) => [skill.id.toLowerCase(), skill.description])
    )
    return Object.fromEntries(
      noms.flatMap((nom) => {
        const description = parNom.get(nom)
        return description ? [[nom, description]] : []
      })
    )
  } catch {
    return {}
  }
}

export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus,
    private readonly retrieveContext?: (
      query: string,
      /** Identite du tour : sans elle, le contexte pousse ne laisse aucune trace lisible. */
      meta?: { conversationId?: string; turnId?: string }
    ) => Promise<string>,
    /**
     * Contexte projet plié (CLAUDE.md/AGENTS.md du workspace), MÊME source que les phases
     * orchestrées (context-files). Défaut vide → le chat reste fonctionnel sans workspace.
     */
    private readonly projectContext: (conversationId?: string) => string = () => '',
    /**
     * Dossier de travail DU TOUR, resolu depuis la conversation courante (plus de dossier global fige
     * au demarrage). Sert au cwd du CLI, a la cle de session et au filtrage des faits provisoires.
     */
    private readonly executionWorkspace: (conversationId?: string) => string = () => '',
    /**
     * Servir AUSSI les commandes du chat comme outils directs du modele (MCP, `chat-mcp.ts`), en
     * plus du texte `<cmd>`. Faux par defaut : seul `index.ts` l'active, les fixtures et les tests
     * existants restent au texte seul. Un objet sert aux tests a injecter le demarrage du serveur.
     */
    private readonly outilsNatifs: boolean | Pick<OuvertureOutilsNatifs, 'demarrer'> = false,
    /**
     * Le petit modèle qui lit la demande AVANT un run payant ou un changement d'affichage, et dit
     * si elle a deux lectures plausibles (`deux-lectures.ts`, conv-1092). Absent = aucun contrôle :
     * seul `index.ts` le branche, les fixtures et les tests existants gardent leurs appels exacts.
     */
    private readonly demanderDeuxLectures?: (systeme: string, charge: string) => Promise<string>
  ) {}

  /**
   * Sessions CLI du CHAT, par conversation (levier coût — mesure 2026-07-28 : 1,85 M de tokens de
   * cache_write en 1h, ~79 k de contexte re-payé à chaque tour). Même levier que le session-resume
   * chaîné de l'orchestrateur : quand le provider rend un sessionId, le tour suivant REPREND cette
   * session — l'historique est déjà connu du CLI, on n'envoie donc que le nouveau message.
   *
   * La clé inclut provider+modèle : un changement de binding INVALIDE la session (reprendre une
   * session ouverte avec un autre modèle n'a pas de sens). Cache mémoire volontairement : le gain
   * visé est intra-session d'app (les tours consécutifs), et une session CLI ne survit de toute
   * façon pas indéfiniment — pas de sessionId réutilisable ⇒ retour au comportement actuel.
   */
  private readonly chatSessions = new Map<string, { key: string; sessionId: string }>()

  /**
   * Comptes-rendus de tours executes SANS le modele, en attente d'etre reinjectes au tour suivant.
   *
   * Le trou constate par l'utilisateur le 2026-08-14 : la route `explicit-skill` ci-dessous lance
   * l'orchestration elle-meme puis rend la main AVANT tout appel au modele. Le tour suivant reprend la
   * session CLI et n'envoie que le dernier message — donc ce tour n'existe nulle part pour lui, et il
   * repond « la trace ne contient ni son runId, ni ses phases, ni son resultat ». Reponse honnete face
   * a un trou ; le defaut etait le trou.
   *
   * DURABLE depuis conv-989 (2026-10-16) : la carte memoire est doublee d'un fichier a part
   * (`runs/compte-rendu-non-vu-store.ts`). Avant, un redemarrage entre les deux tours perdait la
   * note alors que la session, elle, etait rehydratee depuis le disque — le trou revenait. Les
   * methodes ci-dessous sont le SEUL acces : memoire d'abord, disque ensuite, oubli des deux.
   */
  private readonly comptesRendusNonVus = new Map<string, string>()

  /**
   * AJOUTE la note a celle qui attend encore, au lieu de la remplacer (conv-989) : un `/scout` suivi
   * d'un `/frame` sans message entre les deux ne laissait au modele que le `/frame`. Le cumul reste
   * sous la borne de tout resultat injecte (conv-312).
   */
  private deposerCompteRendu(conversationId: string, texte: string): void {
    let enAttente = this.comptesRendusNonVus.get(conversationId)
    try {
      enAttente ??= lireCompteRenduNonVu(conversationId)
    } catch {
      /* cache illisible : la note du jour reste, seule l'ancienne serait perdue */
    }
    const cumul = enAttente
      ? bornerResultatDeCommande('orchestrate', `${enAttente}\n\n---\n\n${texte}`)
      : texte
    this.comptesRendusNonVus.set(conversationId, cumul)
    try {
      deposerCompteRenduNonVu(conversationId, cumul)
    } catch {
      /* cache non ecrit : seul un redemarrage avant le prochain tour perdrait la note */
    }
  }

  /** Rend la note en attente PUIS l'oublie : elle n'est remise qu'une fois. */
  private consommerCompteRendu(conversationId: string): string | undefined {
    let texte = this.comptesRendusNonVus.get(conversationId)
    this.comptesRendusNonVus.delete(conversationId)
    try {
      texte ??= lireCompteRenduNonVu(conversationId)
      oublierCompteRenduNonVu(conversationId)
    } catch {
      /* cache illisible = aucune note : le tour part sans, comme avant ce correctif */
    }
    return texte
  }

  /**
   * DERNIER etat de l'app deja pousse dans chaque conversation.
   *
   * Sert a n'envoyer QUE le changement quand la session du modele est reprise : cet etat part
   * cote MESSAGE, il change a chaque tour, donc il nest jamais mis en cache et se repaie PLEIN
   * TARIF. Mesure (conv-614) : 3 043 caracteres par tour, dont 2 821 pour la seule
   * liste des skills, identique dun tour a lautre.
   */
  private readonly dernierEtatPousse = new Map<string, unknown>()

  /** Extraits de rappel deja envoyes dans la session courante de chaque conversation. */
  private readonly rappelDejaEnvoye = new Map<string, Set<string>>()

  /**
   * L'index memoire ci-dessus est HYDRATE une fois depuis le disque, puis maintenu en miroir.
   *
   * Sans cela, le gain de la reprise de session s'evaporait a CHAQUE redemarrage de l'app : la `Map`
   * repartait vide, donc le premier tour de chaque conversation re-payait l'historique entier. Le
   * chiffrage est dans le commentaire de `chat()` plus bas (mesure du 2026-07-28 : ~79 k tokens
   * re-payes par tour, 1,85 M de `cache_write` par heure).
   *
   * TOUT est en fail-open : la persistance est un CACHE, jamais une autorite. Un disque plein, un
   * fichier verrouille ou un JSON corrompu doivent couter un renvoi d'historique — cher, jamais faux —
   * et surtout PAS casser le tour de l'utilisateur. D'ou les `try/catch` muets ici, qui seraient une
   * faute sur une frontiere de securite et sont le bon choix sur un cache.
   */
  private chatSessionsHydrated = false

  private hydrateChatSessions(): void {
    if (this.chatSessionsHydrated) return
    this.chatSessionsHydrated = true
    try {
      for (const [conversationId, record] of Object.entries(loadChatSessions())) {
        // Ne JAMAIS ecraser une entree memoire plus fraiche que le disque.
        if (!this.chatSessions.has(conversationId)) this.chatSessions.set(conversationId, record)
      }
    } catch {
      /* cache indisponible = aucune session connue : on renverra l'historique, c'est correct */
    }
  }

  private persistChatSession(conversationId: string, key: string, sessionId: string): void {
    try {
      saveChatSession(conversationId, key, sessionId)
    } catch {
      /* cache non ecrit : le prochain demarrage re-paiera l'historique, rien de faux */
    }
  }

  private forgetPersistedChatSession(conversationId: string): void {
    try {
      forgetChatSession(conversationId)
    } catch {
      /* best-effort : une entree perimee sur disque sera de toute facon rejetee par sa `key` */
    }
  }

  /**
   * Mode CONVERSATION (chat transparent) : l'agent parle À l'utilisateur ET peut
   * piloter l'app dans le même tour. Le texte hors-commande est sa réponse parlée ;
   * les `<cmd>` sont exécutées et rendues comme des actions inline. L'historique
   * complet est réinjecté pour un vrai multi-tours. Un tour peut enchaîner plusieurs
   * itérations (agir → constater → répondre) jusqu'à ce qu'il ne reste plus de commande.
   */
  async chat(
    history: Message[],
    onEvent: (e: PilotEvent) => void,
    ask?: (question: ModelQuestion) => Promise<string>,
    /**
     * Cap d'iterations d'un tour. Releve de 6 a 12 le 2026-07-29 : sur un blocage reel, l'agent avait
     * consomme 4 iterations en `edit_file` rates avant meme de pouvoir chercher une autre voie, puis
     * s'est arrete sur « cap atteint sans reponse finale » — en laissant des mutations partielles.
     * La regle anti-abandon lui demande desormais de CHERCHER, ESSAYER puis NETTOYER : il faut de quoi
     * le faire. Le cout n'est plus borne du tout depuis la suppression du budget du tour
     * (2026-09-16) : il est MESURE et ecrit, jamais coupe.
     */
    maxIter = CAP_ITERATIONS_TOUR,
    conversationId?: string,
    signal?: AbortSignal,
    /** Directives injectées par l'utilisateur PENDANT le tour — drainées à chaque itération. */
    drainDirectives?: () => string[],
    /** Binding figé pour ce tour uniquement (ex. tâche planifiée), sans mutation du rôle global. */
    bindingOverride?: RoleBinding,
    /** Identité causale du tour créée par le contrôleur de chat. */
    turnId?: string,
    /** Snapshot du runtime affiche pour ce tour ; distinct de l'override des commandes orchestrees. */
    runtimeBinding?: RoleBinding,
    /** Appel déjà payé à reprendre sans invoquer une seconde fois le provider. */
    recoveredProviderCall?: RecoveredPilotProviderCall,
    /** Persistance du lien tour → journal avant le spawn d'un chat direct. */
    onProviderJournal?: (link: PilotProviderJournalLink) => void,
    /** Bornes provider propres a ce tour de fond, distinctes des preferences du role. */
    sendLimits?: Pick<SendOptions, 'maxBudgetUsd'> & {
      /** Profil minimal du triage automatique : aucune commande, aucun pipeline, aucun gros kit. */
      systemProfile?: 'watchdog-read-only'
      /**
       * Tour lancé sans humain devant (tâche planifiée, veille). Personne ne répondrait à une
       * question : le contrôle des deux lectures ne joue pas.
       */
      tourDeFond?: boolean
    },
    /** Dernière vraie demande humaine, quand le dernier message transport est une instruction interne. */
    routingUserMessageOverride?: string,
    /** Ce tour REPREND un tour coupe net pour laisser passer le dernier message utilisateur. */
    tourCoupePourCeMessage?: boolean,
    /**
     * Exiger le BLOC DE CLOTURE et l'aveu d'echec — politique d'EXPERIENCE, pas regle du pilote.
     *
     * Demandee par l'utilisateur le 2026-08-15 apres lecture de ses conversations : « y'en a pas une
     * qui a fini avec le bloc fait / a faire, c'est pas du tout l'experience que je veux offrir ».
     *
     * En OPTION plutot qu'en dur, parce qu'elle appartient a la SURFACE de chat et non au coeur du
     * tour : imposee a tous, elle changeait le contrat de tours internes (recuperation, streaming,
     * contrat de tour) dont les fixtures figent un nombre d'appels precis. L'expliciter dit QUI la
     * veut, au lieu de la faire subir a tout le monde.
     */
    exigerExperienceSoignee = false
  ): Promise<void> {
    // Chronométrage des jalons jusqu'au PREMIER token : c'est la latence réellement perçue au clic.
    const timer = startTurnTimer('chat', {
      ...(turnId ? { turnId } : {}),
      ...(conversationId ? { conversationId } : {})
    })
    // Frontière de typage T2 : chaque évènement construit ici doit correspondre EXACTEMENT à une
    // variante de `PilotEventVariant` (excess-property-check compris) avant d'atteindre le
    // consommateur externe `onEvent: (e: PilotEvent) => void`.
    // Anti-collage : un delta qui ouvre une fence, ou qui reprend un flux interrompu, doit tomber
    // sur une ligne NEUVE — sinon la fence ```html-render finit en milieu de ligne (HTML brut à l'écran).
    const collage = new DeltaCollageTracker()
    /*
     * UN GEL DE L'INTERFACE NE FAIT PLUS REPAYER LE TOUR.
     *
     * MESURE DU 2026-09-02 (journaux de la journee) : 14 appels « reprise du tour interrompu » pour
     * 13,62 $, dont 3,44 $ sur un seul (conv-96, 04:19) — un tour deja paye, relance du debut.
     *
     * Le consommateur de ces evenements ECRIT : trace causale, journal du tour, activite. Pendant un
     * gel, l'ecriture de la trace attend un verrou de sequence (`withSequenceLock`,
     * activity/trace-store.ts) qui JETTE passe son budget. Or `onEvent` etait appele A NU : ce jet
     * remontait ici et tuait un tour par ailleurs sain. `run-pilot-chat.ts` protege pourtant ses
     * ecritures une par une (« best-effort : ne jamais casser un tour ») — mais pas celles de
     * l'appel provider ni des actions, et un oubli ligne par ligne se reproduira.
     *
     * On applique donc a la SOURCE le contrat deja retenu pour le pipeline le meme jour (commit
     * d2f1f97d, `protegerRappel`) : l'observabilite d'un tour de chat n'est plus fatale. Ce n'est pas
     * un catch avale — l'echec est signale — il cesse seulement d'emporter le tour.
     */
    const publier = protegerRappel<[PilotEvent]>('chat:onEvent', onEvent) ?? onEvent
    /**
     * ECHECS EN ATTENTE DE REPRISE — nom d'action -> `actionId` du dernier echec non retente.
     * Alimente le champ `repriseProbableDe` pose sur la commande suivante de meme nom.
     */
    const echecsNonRepris = new Map<string, string>()
    /**
     * `actionId` -> clef CIBLEE de l'action. L'evenement `result` ne porte pas ses arguments : la
     * clef est donc calculee a l'emission de la commande et retrouvee ici. Sans cela le lien
     * reposerait sur le seul NOM d'action et affirmerait qu'un `edit_file` rate sur `a.ts` a ete
     * repris par un `edit_file` reussi sur `b.ts` — la reponse inverse a la question posee.
     */
    const clefParAction = new Map<string, string>()
    /*
     * Rempli plus bas, des que le registre des echecs existe. `emit` ne peut pas lire ce registre
     * (il est declare apres lui, et certains chemins emettent avant), d'ou ce relais : la seule
     * facon de couvrir TOUS les points de sortie du tour sans en oublier un.
     */
    let emettreEchecsAbandonnes: (() => void) | undefined
    /**
     * Le tour a rendu sa fin (`done` ou `error`). La ligne « Lecture retenue » lue EN PARALLÈLE du
     * modèle (conv-1240) ne s'écrit plus après : elle arriverait sous un message déjà clos.
     */
    let tourClos = false
    const emit = (e: PilotEventVariant): void => {
      if (e.kind === 'done' || e.kind === 'error') {
        tourClos = true
        const dire = emettreEchecsAbandonnes
        emettreEchecsAbandonnes = undefined
        dire?.()
      }
      if (e.kind === 'result' && e.name) {
        const clef = clefParAction.get(e.actionId) ?? e.name
        if (e.ok) echecsNonRepris.delete(clef)
        else echecsNonRepris.set(clef, e.actionId)
      }
      if (e.kind === 'command' && e.name) {
        const clef = cleDEchec(e.name, e.args as Record<string, unknown> | undefined)
        clefParAction.set(e.actionId, clef)
        const echec = echecsNonRepris.get(clef)
        if (echec !== undefined && echec !== e.actionId) {
          echecsNonRepris.delete(clef)
          publier({ ...e, repriseProbableDe: echec })
          return
        }
      }
      if (e.kind === 'delta' && e.streamId && e.text) {
        // Deux collages DISTINCTS, dans cet ordre. D'abord celui qui vit DANS le texte du delta
        // (fence soudee a la phrase precedente, cf. detacherFenceCollee), sinon la separation
        // calculee juste apres porterait sur un texte deja fautif. Ensuite celui de la JOINTURE
        // avec le delta precedent, que seul le tracker connait.
        const texte = detacherFenceCollee(e.text)
        const separation = collage.separation(e.streamId, texte)
        if (separation || texte !== e.text) {
          publier({ ...e, text: separation + texte })
          return
        }
      }
      publier(e)
    }
    let timingWritten = false
    const binding = runtimeBinding ?? bindingOverride ?? this.roles.getBinding('orchestrator')
    const execCommand = (
      name: string,
      args: Record<string, unknown>,
      onProgress?: (text: string) => void
    ): Promise<CommandResult> => {
      /*
       * NE PAS BOURRER LA FIN D'ARGUMENTS `undefined`.
       *
       * L'ajout d'`onProgress` avait rendu l'appel TOUJOURS a six arguments, la queue comblee par
       * des `undefined`. Or `bus.exec` est espionne par onze tests qui asservissent l'appel EXACT --
       * un appel a trois arguments cessait d'en etre un, et la suite du pilote est passee au rouge
       * sur la branche partagee (mesure le 2026-08-25 : 11 echecs, tous des decalages d'arite, aucune
       * regression fonctionnelle).
       *
       * On ne touche donc ni aux assertions ni au comportement : on rend simplement a l'appel sa
       * forme MINIMALE quand il n'y a rien de plus a passer. Un argument optionnel absent ne doit
       * pas s'ecrire.
       */
      const binding = bindingOverride
      if (onProgress) {
        return binding
          ? this.bus.exec(name, args, conversationId, binding, turnId, onProgress)
          : this.bus.exec(name, args, conversationId, undefined, turnId, onProgress)
      }
      if (binding) {
        return turnId
          ? this.bus.exec(name, args, conversationId, binding, turnId)
          : this.bus.exec(name, args, conversationId, binding)
      }
      return turnId
        ? this.bus.exec(name, args, conversationId, undefined, turnId)
        : this.bus.exec(name, args, conversationId)
    }
    /**
     * Une commande qui JETTE est un echec comme un autre — sauf l'annulation.
     *
     * Trouve par l'audit du 2026-08-21 : `execCommand` n'avait aucun try/catch. Un timeout, un gate
     * implemente par un `throw` plutot que par un `{ok:false}`, ou n'importe quelle exception d'un
     * outil faisait remonter l'erreur HORS du tour — sans reprise, sans aveu, sans enregistrement du
     * mur. C'est exactement la classe de cas que ce chantier devait couvrir, et elle passait
     * entierement a cote du mecanisme parce que celui-ci ne regarde que `commandResultSucceeded`.
     *
     * L'ANNULATION, elle, doit continuer a remonter. C'est le piege de ce correctif : elle voyage
     * elle aussi par exception (`signal.throwIfAborted`), et l'avaler ferait repartir l'agent —
     * « corrige la cause et reprends la tache » — sur un travail que l'utilisateur vient d'arreter.
     */
    const estUneAnnulation = (erreur: unknown): boolean =>
      signal?.aborted === true ||
      (typeof erreur === 'object' &&
        erreur !== null &&
        (erreur as { name?: string }).name === 'AbortError')
    const execCommandTolerante = async (
      name: string,
      args: Record<string, unknown>,
      onProgress?: (text: string) => void
    ): Promise<CommandResult> => {
      try {
        return await execCommand(name, args, onProgress)
      } catch (erreur) {
        if (estUneAnnulation(erreur)) throw erreur
        return { ok: false, error: erreur instanceof Error ? erreur.message : String(erreur) }
      }
    }
    const provider = binding.provider
    // Autorite du tour : une demande utilisateur ne peut ouvrir qu'un run. Une reparation ou reprise
    // appartient au controleur du run courant ; un second run exige un nouveau message utilisateur.
    let orchestrationIssued = false
    /**
     * L'ISSUE de l'orchestration jouee dans ce tour, gardee pour la joindre au `done` FINAL.
     *
     * Le tour n'est plus clos mecaniquement sur cette issue (le modele redige desormais la cloture),
     * mais la comptabilite en aval — persistance du texte de cloture, cout, tracabilite — lit
     * `done.outcome`. La perdre en rendant la parole au modele aurait casse ces consommateurs sans
     * qu'aucun texte affiche ne le montre.
     */
    let orchestrationOutcome: Record<string, unknown> | undefined
    /**
     * Le REFUS d'un `remember` auxiliaire, garde pour ne pas etre avale par la cloture muette.
     *
     * `onlyAuxiliaryRemember` clot le tour sans rendre la main au modele — economie voulue. Mais
     * il jetait AUSSI l'issue du depot : un refus deterministe (type inconnu, source invalide,
     * Brain injoignable) disparaissait, et le modele venait d'ecrire « je retiens ca ». Vecu le
     * 31/08 (conv-1569) : deux tentatives, aucun retour, l'utilisateur constate « ca a pas marche »
     * alors que rien dans le fil ne le disait. On ne repaie pas une generation : on AJOUTE la
     * verite au texte deja livre.
     */
    let refusRememberAuxiliaire: string | undefined
    /** Un `remember` accepté ou une note de mémoire écrite CE tour : une « Leçon : » est retenue. */
    let depotMemoireCeTour = false
    /** Le raccourci `remember` a AVALE la garde de cloture : une relance est due (voir plus bas). */
    let consigneClotureApresRemember = false
    /**
     * UN DEPOT REFUSE SE CORRIGE, il ne se CONSTATE pas. Bornee a une reprise.
     *
     * Mesure conv-49 (2026-09-01, capture de l'utilisateur) : `remember` refuse pour « portee
     * manquante », tour CLOS sur « ⚠️ Memoire NON deposee ». Le motif partait a l'utilisateur mais
     * JAMAIS au modele, qui ne pouvait donc pas ajouter la portee manquante — un refus pourtant
     * reparable en un seul argument. Verdict de l'utilisateur : « il doit se rendre compte quand ca
     * foire et corriger avant de passer a la suite ». On rend la main aux commandes UNE fois ; si la
     * reprise echoue a son tour, la cloture dit le refus comme avant.
     */
    let repriseRememberRefuseDisponible = true
    /** La consigne de reprise du depot refuse, poussee au bout de l'iteration. */
    let consigneRepriseRemember: string | undefined
    /**
     * Le compte-rendu AUTORITATIF de cette orchestration, garde comme REPLI.
     *
     * Contrepartie indispensable de la parole rendue au modele : un modele qui n'ecrit rien — ou qui
     * s'obstine a redemander une orchestration, refusee par `orchestrationIssued` — brulait les
     * iterations jusqu'a « Cap d'iterations atteint sans reponse finale », et l'utilisateur perdait le
     * compte-rendu qu'il avait AVANT ce changement, au prix d'un run complet. Le modele a la parole ;
     * il n'a pas le pouvoir de faire disparaitre le resultat.
     */
    let compteRenduOrchestration: string | undefined
    const catalog = this.bus.catalog()
    // Sous-jalons : `snapshot` recouvre trois lectures (runs, bureaux, recensement git). Les
    // marquer sépare la cause de l'effet dans l'onglet Latence de la vue Tests.
    const snapshot = snapshotDuTour(
      await this.bus.snapshotForPrompt((nom) => timer.mark(nom)),
      conversationId
    )
    timer.mark('snapshot')

    const latestUserMessage = resolveLatestUserMessage(history, routingUserMessageOverride)
    // Une continuation réutilise le vrai prompt pour les permissions et le RAG, jamais pour
    // déclencher une seconde fois son raccourci /skill : ce geste exige un nouveau message humain.
    const directRoute =
      routingUserMessageOverride === undefined && latestUserMessage
        ? routeSkillRequest(latestUserMessage)
        : undefined
    // COURT-CIRCUIT reserve a la demande EXPLICITE (« /scout … », « /build … »).
    //
    // L'ancienne branche heuristique (`workspace-action`, deduite d'un verbe + une cible) est RETIREE.
    // MESURE sur 251 messages reels : elle se declenchait 8 fois, dont 6 a tort — precision 25 %,
    // rappel 2 % — alors que le MODELE a decide correctement dans 101 cas. Deviner dans le code
    // court-circuitait `chat()` AVANT le modele, donc aucune consigne de prompt ne pouvait corriger
    // l'erreur : c'est le mecanisme exact de la regression du 2026-07-28, qui etait toujours arme.
    // Une commande explicite, elle, ne devine RIEN : l'utilisateur a nomme la phase.
    // Seule une PHASE nommee (`/scout`, `/build`...) court-circuite vers l'orchestration. Une skill
    // hors pipeline (`/look`, `/think`, `/remake`...) est reconnue comme commande — elle garde le fil
    // courant — mais reste jouee par le MODELE avec le corps de sa skill injecte : la router vers un
    // run payant serait une orchestration que l'utilisateur n'a jamais demandee.
    /*
     * DEUX LECTURES PLAUSIBLES → UNE QUESTION, AVANT DE PAYER (deux-lectures.ts, conv-1092).
     *
     * Trois points de passage, un seul appel au petit modèle par tour (promesse mémorisée) :
     * le `/scout …` routé ci-dessous SANS modèle (conv-767 : 2,47 $ sur une mauvaise lecture), une
     * demande qui change l'affichage (lue AVANT de passer la main au modèle, dont les éditions
     * natives ne sont pas interceptables), et l'`orchestrate` émis par le modèle. Jamais sur une
     * reprise interne, un tour de fond ni la réponse à cette même question.
     */
    /*
     * LUE À CHAQUE MESSAGE D'UN HUMAIN (conv-1240) : la ligne « Lecture retenue » s'affiche à chaque
     * tour, demande de l'utilisateur (« met le tout le temps »). La QUESTION garde ses filtres
     * d'avant : jamais sur une relance ou un message de moins de quatre mots, jamais deux fois.
     */
    const lectureDuTourArmee =
      Boolean(this.demanderDeuxLectures) &&
      routingUserMessageOverride === undefined &&
      !sendLimits?.tourDeFond &&
      sendLimits?.systemProfile !== 'watchdog-read-only' &&
      // Le tour de reprise d'une tâche de fond est écrit par Autowin, pas par l'utilisateur
      // (conv-1118) : il n'a rien à départager.
      !estUneRepriseAutomatique(latestUserMessage) &&
      // Même chose pour le message d'un lot, d'un ordre entre fils ou du réveil du chef : composé par
      // l'app ou un agent, sans humain pour cliquer. conv-1192 (2026-10-27) s'y est arrêté net.
      !estUnMessageDuPlan(latestUserMessage) &&
      !estUnPromptDOrdre(latestUserMessage)
    const questionPermise =
      meriteUneLecture(latestUserMessage) && !suitUneQuestionDesLectures(history)
    let lecturesMemorisees: Promise<IssueDesLectures | undefined> | undefined
    const deuxLecturesDuTour = (): Promise<IssueDesLectures | undefined> => {
      const demande = latestUserMessage?.trim() ? latestUserMessage : undefined
      const demander = this.demanderDeuxLectures
      if (!lectureDuTourArmee || !demande || !demander) return Promise.resolve(undefined)
      // Ce que font les commandes citées (`/scout`, `/arena`) : sans elles, le petit modèle a lu
      // conv-767 comme nette — rejeu sur le vrai modèle du 2026-10-22, 0 question sur 3 cas visés.
      const descriptions = descriptionsDesCommandes(commandesCitees(demande))
      lecturesMemorisees ??= demander(
        CONSIGNE_DEUX_LECTURES,
        chargeDeuxLectures(demande, dernierMessageAgent(history), descriptions)
      )
        .then((reponse) => {
          const issue = lireLesLectures(reponse, demande)
          // Une relance, ou la réponse à la question d'avant : la ligne, jamais une question.
          return issue && !questionPermise ? lectureAAnnoncer(issue) : issue
        })
        // Un contrôle en panne ne bloque jamais le travail : il part comme avant.
        .catch(() => undefined)
      return lecturesMemorisees
    }
    const poserLaQuestionDesLectures = async (
      actionId: string,
      lectures: [string, string]
    ): Promise<void> => {
      const args = questionDesDeuxLectures(lectures, latestUserMessage ?? '')
      emit({ kind: 'command', actionId, name: 'ask', args })
      const reponse = await execCommand('ask', args)
      emit({
        kind: 'result',
        actionId,
        name: 'ask',
        ok: commandResultSucceeded(reponse),
        data: reponse.ok ? reponse.data : reponse.error
      })
    }
    const fermerSurLaQuestionDesLectures = async (
      actionId: string,
      lectures: [string, string]
    ): Promise<void> => {
      await poserLaQuestionDesLectures(actionId, lectures)
      emit({
        kind: 'done',
        text: AVIS_DEUX_LECTURES,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      })
    }
    /*
     * UNE LECTURE DOMINE → ELLE PART, ANNONCÉE EN UNE LIGNE (conv-1123). Émise en vrai `delta`, pas
     * seulement dans le `done` : le renderer jette le texte du `done` quand le tour a déjà parlé, et
     * l'utilisateur doit voir la lecture AVANT la fin du travail pour pouvoir corriger. Une seule
     * fois par tour : les trois points de passage partagent la même décision mémorisée.
     */
    let lectureRetenue: Extract<IssueDesLectures, { kind: 'retenue' }> | undefined
    const annoncerLaLectureRetenue = (
      issue: Extract<IssueDesLectures, { kind: 'retenue' }>
    ): void => {
      if (lectureRetenue) return
      lectureRetenue = issue
      emit({
        kind: 'delta',
        streamId: FLUX_LECTURE_RETENUE,
        text: `${annonceDeLaLectureRetenue(issue.retenue, issue.ecartee)}\n\n`,
        iteration: 0
      })
    }
    let tacheDeLaRoute = directRoute?.task ?? ''
    if (directRoute?.reason === 'explicit-skill' && directRoute.explicitPhase) {
      const issueDeLaRoute = await deuxLecturesDuTour()
      if (issueDeLaRoute?.kind === 'question') {
        await fermerSurLaQuestionDesLectures('lectures:0', issueDeLaRoute.lectures)
        return
      }
      if (issueDeLaRoute?.kind === 'retenue') {
        annoncerLaLectureRetenue(issueDeLaRoute)
        tacheDeLaRoute = tacheAvecLectureRetenue(
          tacheDeLaRoute,
          issueDeLaRoute.retenue,
          issueDeLaRoute.ecartee
        )
      }
    }
    if (directRoute?.reason === 'explicit-skill' && directRoute.explicitPhase) {
      const actionId = 'route:0'
      const args = { task: tacheDeLaRoute }
      emit({ kind: 'command', actionId, name: 'orchestrate', args })
      signal?.throwIfAborted()
      const result = await execCommand('orchestrate', args)
      emit({
        kind: 'result',
        actionId,
        name: 'orchestrate',
        ok: commandResultSucceeded(result),
        data: result.ok ? result.data : result.error
      })
      // Le /skill vient déjà de consommer l'unique orchestration autorisée pour ce tour. Une
      // orientation arrivée pendant l'attente ne peut pas être injectée rétroactivement dans ce
      // run : surtout ne pas la transformer silencieusement en second run payant.
      const lateDirectives: string[] = []
      for (;;) {
        const directives = drainDirectives?.() ?? []
        if (!directives.length) break
        lateDirectives.push(...directives)
      }
      const directiveNotice = avisOrientationsTardives(lateDirectives)
      // Les FAITS, pas une formule : statut, validite, blocage de gate, cout, run et resultat sont
      // tous rendus par l'orchestrateur et etaient jetes (conv-76 : 18 sous-agents, 10,05 $, le fil
      // n'affichait que « Workflow Autowin execute. »).
      const issueDuRun = result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined
      const erreurDuRun = result.ok ? undefined : String(result.error ?? '')
      const compteRendu = avecAvisEnTete(
        formatOrchestrationOutcome(result.ok, issueDuRun, erreurDuRun),
        directiveNotice
      )
      /**
       * Ce tour n'a JAMAIS atteint le modele : on garde son compte-rendu pour le lui donner au tour
       * suivant. Sans ce depot, il se voit demander « on a bien fait tout le processus ? » a propos
       * d'un tour dont rien, dans sa session, ne porte la trace.
       *
       * Le depot porte le resultat ENTIER, pas la bulle coupee a 4 000 caracteres (conv-914 : 6 pistes
       * trouvees, une seule visible pour l'agent). Seule la borne de tout resultat injecte s'applique.
       * Les pages `html-render` du run y passent en texte visible AVANT la borne : ce compte-rendu reste
       * ensuite dans la session du modele pour tous les tours suivants (conv-1074).
       */
      if (conversationId)
        this.deposerCompteRendu(
          conversationId,
          bornerResultatDeCommande(
            'orchestrate',
            pagesHtmlEnTexte(
              avecAvisEnTete(
                formatOrchestrationOutcomePourLeModele(result.ok, issueDuRun, erreurDuRun),
                directiveNotice
              )
            )
          )
        )
      emit({
        kind: 'done',
        text: compteRendu,
        outcome: result.ok
          ? ((result.data as Record<string, unknown> | undefined) ?? undefined)
          : failedOrchestrationOutcome(result.error),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      })
      return
    }
    // Lancée AVANT la recherche Brain et attendue après : son délai se cache derrière elle.
    const lecturesAvantRendu = demandeDeChangementDeRendu(latestUserMessage)
      ? deuxLecturesDuTour()
      : undefined
    /*
     * TOUS LES AUTRES TOURS (conv-1240) : la lecture court EN PARALLÈLE du modèle, sans l'attendre.
     * Mesure sur turn-timing.jsonl du 2026-10-28 : le petit modèle répond en ~4 s, le premier jeton du
     * modèle du chat arrive en 24 s (médiane) et en moins de 5 s pour 5 % des tours seulement.
     * L'attendre aurait rallongé CHAQUE réponse ; la ligne arrive presque toujours avant le texte, et
     * le fil la range de toute façon en tête du message (`chat-view-model.ts`). Si le modèle demande
     * ensuite un run, la même lecture mémorisée le garde (question à quasi-égalité, tâche précisée).
     */
    if (!lecturesAvantRendu)
      void deuxLecturesDuTour().then((issue) => {
        if (issue && !tourClos) annoncerLaLectureRetenue(lectureAAnnoncer(issue))
      })
    const retrievedContext =
      this.retrieveContext && latestUserMessage
        ? await this.retrieveContext(latestUserMessage, { conversationId, turnId }).catch(() => '')
        : ''
    timer.mark('ragBrain')
    const issueDuRendu = await lecturesAvantRendu
    if (issueDuRendu?.kind === 'question') {
      await fermerSurLaQuestionDesLectures('lectures:0', issueDuRendu.lectures)
      return
    }
    if (issueDuRendu?.kind === 'retenue') annoncerLaLectureRetenue(issueDuRendu)

    // MÊME config que les phases orchestrées : la CONSTITUTION (soul/réflexes) est la source
    // UNIQUE partagée ; le chat y ajoute seulement ce qui lui est propre (pilotage par commandes).
    const watchdogReadOnly = sendLimits?.systemProfile === 'watchdog-read-only'
    // OPEN BAR (choix utilisateur explicite 2026-08-14) : un tour PILOTÉ PAR L'UTILISATEUR reçoit
    // TOUJOURS le catalogue complet — jamais un catalogue réduit derrière une classification
    // « lecture seule » du message. Cette classification (`classifyMutationConfidence`) starvait des
    // tours qui devaient agir, mesuré à répétition (dont le scout de veille conv-1154→1157). L'utilisateur
    // ASSUME la perte de garde-fou, dans la continuité du retrait du sandbox (décision C, 2026-08-06) :
    // dans SON chat, si une demande d'analyse amène le modèle à écrire ou supprimer, c'est permis.
    //
    // La SEULE porte conservée est `watchdog-read-only` : le triage interne d'Auto-Kaizen, imposé par
    // le SYSTÈME (pas par l'utilisateur) sur un incident. L'ouvrir laisserait un run échoué déclencher
    // des écritures automatiques — hors du périmètre demandé, et son pilote refuse l'exec de toute façon.
    const directReadOnly = false
    const commandFreeReadOnly = watchdogReadOnly || directReadOnly
    // Le dossier du tour est RESOLU depuis la conversation (le dossier global fige au demarrage n'est
    // plus qu'un repli, cf. `dossierDeTravailDuTour`). Meme valeur que le cwd envoye au CLI, sinon la
    // session est reclamee depuis un autre dossier et le tour meurt a 0 message (conv-48, 2026-09-06).
    const workspaceDuTour =
      this.executionWorkspace(conversationId).trim() || (process.env[AUTOWIN_WORKSPACE_ENV] ?? '')
    const providerLimits: Pick<SendOptions, 'maxBudgetUsd' | 'toolProfile' | 'workspaceCwd'> = {
      ...(sendLimits?.maxBudgetUsd ? { maxBudgetUsd: sendLimits.maxBudgetUsd } : {}),
      ...(commandFreeReadOnly ? { toolProfile: 'watchdog-read-only' as const } : {}),
      ...(workspaceDuTour ? { workspaceCwd: workspaceDuTour } : {})
    }
    /**
     * Un tour LECTURE SEULE n'est plus SANS COMMANDES : il garde les commandes `readOnlyHint`.
     *
     * L'allègement d'origine (pas de catalogue sur un tour read-only) datait d'un catalogue où
     * TOUTES les commandes mutaient quelque chose. Depuis `read_file`/`find_in_files`, c'est
     * l'inverse : une ANALYSE est exactement le tour qui a besoin de lire. Mesuré sur 4 runs réels
     * du scout de veille (conv-1154→1157) : classé read-only, il recevait zéro outil et répondait
     * honnêtement « je n'ai pas pu exécuter les lectures obligatoires ». Le triage Watchdog, lui,
     * reste volontairement sans commandes (son pilote refuse tout exec de toute façon).
     */
    const catalogueLectureSeule = catalog.filter((commande) => commande.annotations?.readOnlyHint)
    const pilotage = watchdogReadOnly
      ? ''
      : directReadOnly
        ? catalogueLectureSeule.length > 0
          ? buildChatPilotagePrompt(catalogueLectureSeule)
          : ''
        : buildChatPilotagePrompt(catalog)
    /**
     * PRÉFIXE SYSTEM STABLE = condition du cache (mesure 2026-07-28 : cache_read = 0 sur 100 % des
     * appels, ~16 k de cache_write REÉCRITS à chaque tour, ~0,32 $ pour répondre une phrase).
     *
     * Le contexte Brain est un résultat de recherche qui DÉPEND du message de l'utilisateur : tant
     * qu'il était concaténé ici, le system prompt changeait à chaque tour et aucun préfixe ne pouvait
     * être réutilisé. Il est désormais passé dans le MESSAGE (voir `convo`) : même information remise
     * au modèle, mais le system redevient identique d'un tour à l'autre, donc cachable.
     *
     * Fonction du texte de pilotage (conv-1229) : un envoi qui reçoit les outils directs prend la
     * consigne SANS les commandes déjà servies en outils (`systemeAvecOutilsDirects`, plus bas).
     */
    const systemPartsAvec = (pilotage: string): Array<{ name: string; text: string }> =>
      watchdogReadOnly
        ? [
            {
              name: 'watchdog-read-only',
              text:
                "Tu es le triage automatique non invasif d'Autowin OS. Reponds en francais, " +
                'directement et en moins de 250 mots. Tu observes un incident en LECTURE SEULE : ' +
                "n'emets aucune commande Autowin, ne lance aucune orchestration, ne modifie rien et " +
                'ne cree aucun worktree. Utilise au plus les lectures locales strictement necessaires. ' +
                'Si le contexte ne cite aucun artefact ou chemin precis, ne fouille pas le depot au hasard : ' +
                'distingue les faits, la cause seulement si elle est prouvee, puis la preuve manquante. ' +
                'Respecte exactement toute derniere ligne ISSUE demandee par le message utilisateur.\n'
            }
          ]
        : directReadOnly
          ? [
              {
                name: 'direct-read-only',
                text:
                  "Tu es le chat direct d'Autowin OS. Reponds en francais a la demande exacte de " +
                  "l'utilisateur, sans preambule inutile. Ce tour est strictement en LECTURE SEULE : " +
                  "n'emets aucune commande qui MODIFIE quoi que ce soit, ne lance aucune orchestration, " +
                  'ne modifie rien et ne cree aucun worktree. Utilise uniquement les lectures locales ' +
                  'strictement necessaires. Distingue les faits observes des deductions et respecte tout ' +
                  'format de sortie explicitement demande. Si le message dit « reponds exactement X », ' +
                  'ta sortie ENTIERE doit etre exactement X, sans note, explication ni mise en forme en plus. ' +
                  'EXPRESSION VISUELLE : hors format strict demande, des que ta reponse a une STRUCTURE ' +
                  '(comparaison, etapes, statuts, chiffres, recapitulatif), prefere un bloc ferme ' +
                  '```html-render en DIRECTION « transparence totale » (choix utilisateur) : aucun ' +
                  'panneau ni fond opaque, typographie sur le fond de l’app, mise en page COMPACTE ' +
                  '(interlignes 1.45-1.55, marges de section <=10px, aucun grand vide vertical), jamais de ' +
                  'halos ; sans JavaScript ni URL externe. ' +
                  // Les classes de l'app remplacent la recette de couleurs en dur (conv-1074).
                  CONSIGNE_CLASSES_PAGES_HTML +
                  ' Garde le texte simple pour une ou deux phrases.\n'
              },
              // Les commandes de LECTURE restent servies : une analyse est exactement le tour qui a
              // besoin de lire (mesure : scout de veille, conv-1154→1157, zero outil, zero candidat).
              // `pilotage` est deja reduit au catalogue readOnlyHint dans ce cas ('' si vide).
              { name: 'pilotage-lecture', text: pilotage }
            ]
          : [
              { name: 'constitution', text: CONSTITUTION },
              { name: 'pilotage', text: pilotage },
              { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
              // Le profil personnel suit le contexte projet : stable entre deux ajouts (conv-1098).
              {
                name: 'projectContext',
                text:
                  this.projectContext(conversationId) +
                  blocProfilUtilisateur() +
                  blocLangueDeReponse()
              },
              /**
               * DERNIERS blocs (`blocsSystemeEcran`, chat-pilotage-prompt.ts) : l'ecran de l'utilisateur,
               * TOUJOURS servi et identique pour tous les fils (kaizen conv-835, tour
               * ac1d0434-51c7-4dee-adf9-a8cb0a8e41f8 : « envoi un message teams… » n'avait aucun mot
               * visuel, le chat n'a donc pas recu la regle et a ouvert Teams sur l'ecran reel), puis les
               * regles de travail visuel, conditionnelles (conv-614) — image jointe comprise (conv-742).
               *
               * En DERNIER a dessein : le cache du provider vaut par son PREFIXE. Seule la queue
               * visuelle apparait ou disparait d'un tour a l'autre.
               */
              ...blocsSystemeEcran(
                latestUserMessage ?? '',
                (history.at(-1)?.attachments ?? []).some((piece) => piece.kind === 'image'),
                conversationId ?? ''
              )
            ]
    const assemblerSysteme = (
      texte: string
    ): { system: string; systemBlocks: Array<{ name: string; chars: number }> } => {
      const parts = systemPartsAvec(texte)
      return {
        system: parts.map((p) => p.text).join(''),
        systemBlocks: parts
          .filter((p) => p.text)
          .map((p) => ({ name: p.name, chars: p.text.length }))
      }
    }
    // Le système COMPLET (liste entière des commandes) : défaut de chaque envoi, et seul servi quand
    // les outils directs ne démarrent pas — le texte `<cmd>` est alors le seul chemin du modèle.
    const { system, systemBlocks } = assemblerSysteme(pilotage)
    /**
     * LISTE DES COMMANDES SANS DOUBLON (conv-1229, 2026-10-28). Mesure sur le texte réellement envoyé
     * (prompt-observability, conv-1229) : 46 des 55 commandes de la liste étaient AUSSI servies en
     * outils directs, avec la même description et des arguments plus détaillés
     * (`outilsPublies`, skill-node-mcp.ts) — 18 830 caractères payés deux fois à chaque requête.
     * Quand les outils directs sont servis, la consigne ne détaille plus que les commandes texte seul.
     * Calculé au premier envoi servi, puis réutilisé : même texte d'un envoi à l'autre, donc cachable.
     */
    let systemeOutilsDirects:
      | { cle: string; system: string; systemBlocks: Array<{ name: string; chars: number }> }
      | undefined
    const systemeAvecOutilsDirects = (
      noms: readonly string[]
    ): { system: string; systemBlocks: Array<{ name: string; chars: number }> } => {
      // Surveillance (aucune commande) et lecture seule (catalogue réduit) gardent leur consigne.
      if (watchdogReadOnly || directReadOnly || noms.length === 0) return { system, systemBlocks }
      const cle = noms.join(',')
      if (systemeOutilsDirects?.cle !== cle) {
        systemeOutilsDirects = {
          cle,
          ...assemblerSysteme(buildChatPilotagePrompt(catalog, { outilsDirects: noms }))
        }
      }
      return systemeOutilsDirects
    }

    // Reconstruit le fil : historique de la conversation + état courant de l'app.
    // Session-resume du CHAT (levier coût) : si la conversation a déjà une session CLI ouverte avec
    // le MÊME binding, on la reprend — l'historique y est déjà, on n'envoie donc que le dernier
    // message + l'état courant de l'app (qui, lui, a pu changer). Sinon : fil complet, inchangé.
    /**
     * LE COMPTE FAIT PARTIE DE L'IDENTITE DE LA SESSION.
     *
     * Une session CLI Claude vit DANS le `CLAUDE_CONFIG_DIR` du compte qui l'a ouverte. Apres une
     * bascule de compte, `--resume <id>` pointe sur une session absente du nouveau dossier : le CLI
     * rend `No conversation found with session ID` et le tour meurt a 0 message — symptome vecu le
     * 2026-08-30 (compte `max` selectionne, chaque prompt sans reponse). Mettre l'id de compte dans
     * la cle fait retomber la conversation sur le chemin deja ecrit pour un changement de binding :
     * la session perimee est oubliee (memoire ET disque) et le fil complet repart a blanc.
     */
    /**
     * LE DOSSIER DE TRAVAIL AUSSI — meme raisonnement, second axe.
     *
     * Le CLI range ses sessions par DOSSIER (`~/.claude/projects/<cwd encode>/`), et le cwd d'un tour
     * de chat EST `process.env[AUTOWIN_WORKSPACE_ENV]` (`providers/claude.ts`, `readOnlyCwd`). Changer
     * de workspace en cours de conversation faisait donc reclamer une session absente du nouveau
     * dossier — meme `No conversation found`, meme mort a 0 message. Vecu le 2026-09-06 sur conv-48 :
     * ouverte dans `E:\GIT\Autowin-OS`, poursuivie apres bascule sur `E:\AutoWin-Temp`, tour mort en
     * `error_during_execution` pour 0 token et 0 USD. La session etait INTACTE (355 lignes, 141
     * messages assistant) : elle etait simplement reclamee depuis le mauvais dossier.
     */
    const workspaceDeSession = workspaceDuTour
    /**
     * LA COMPACTION FAIT PARTIE DE L IDENTITE DE LA SESSION — mesure du 2026-09-08 (conv-342).
     *
     * « Compacter » ecrivait bien son resume, et le fil renvoye repartait de ce resume
     * (`depuisDerniereCompaction`)... sauf que sur un provider qui REPREND sa session, Autowin
     * n envoie que le dernier message : l historique vit chez le fournisseur, la coupe cote Autowin
     * ne s applique donc a RIEN et la jauge ne bouge pas d un point. Le bouton promettait un
     * allegement impossible.
     *
     * Compter les compactions ici PERIME la session a chaque nouvelle compaction, par le chemin deja
     * ecrit pour un changement de compte ou de dossier : session oubliee, tour repart a blanc, et
     * cette fois avec le fil coupe au resume. C est le seul geste qui allege reellement.
     */
    const compactions = compactionsAbouties(history)
    /**
     * LE POIDS DU FIL AUSSI — mesure du 2026-09-17 (conv-632).
     *
     * Autowin poussait 4 779 caracteres au CLI et l'appel etait facture 491 636 tokens d'entree :
     * la reinjection reelle est le TRANSCRIPT du CLI (raisonnement + appels d'outils de tous les
     * tours), qu'Autowin ne voit pas et ne borne pas. Mediane relevee sur 8 891 appels : 210 979
     * tokens d'entree. Les bornes d'`chat-turn-messages.ts` (40 messages / 60 k tokens) ne
     * s'appliquaient a RIEN tant que la session etait reprise.
     *
     * Franchir le seuil perime la session par le chemin deja ecrit pour la compaction : le tour
     * suivant repart sur le fil aplati d'Autowin — bulles finales + resultats d'action resumes.
     */
    const coupesPoids = conversationId ? coupesParPoids(loadConvActivity(conversationId)) : 0
    // Une FONCTION du compte (conv-1063) : un tour qui bascule de compte en cours de route range sa
    // nouvelle session sous le compte qui l'a RÉELLEMENT ouverte, pas sous celui du départ.
    const cleDeSession = (compte: string | undefined): string =>
      `${provider}:${binding.model ?? ''}:${compte ?? ''}:${workspaceDeSession}:c${compactions}:w${coupesPoids}`
    const compteAuDepart = claudeActiveAccountId()
    const sessionKey = cleDeSession(compteAuDepart)
    // Hydrate depuis le disque au premier tour du process : c'est ce qui fait survivre la reprise a
    // un redemarrage de l'app. Idempotent, et sans effet si le cache memoire est deja chaud.
    this.hydrateChatSessions()
    const known = conversationId ? this.chatSessions.get(conversationId) : undefined
    /**
     * RESUME FANTÔME — la reprise n'est armée que si l'adaptateur la TRANSMET vraiment.
     *
     * `codex` rend un `sessionId` (son `thread_id`) sans jamais l'honorer : on élidait donc le fil
     * en affirmant au modèle qu'il le connaissait « par sa session », alors qu'il démarrait à blanc.
     * Mesuré le 2026-08-04 sur 90 fils : 0 appel réellement repris, 31 prompts amputés.
     */
    const providerResumes = this.registry.honoursSessionResume?.(provider) ?? false
    const resumeSessionId =
      providerResumes && known?.key === sessionKey ? known.sessionId : undefined
    /**
     * La session VIVANTE du tour : elle avance d'itération en itération.
     *
     * `resumeSessionId` décrit l'état AU DÉBUT du tour et sert à décider de l'amputation du prompt ;
     * il doit rester figé pour ça. Mais l'appel, lui, doit reprendre la dernière session réellement
     * ouverte — sinon la 2e itération repart à blanc (voir le bloc d'options plus bas).
     */
    let sessionEnCours = resumeSessionId
    /**
     * Compte Claude qui a ouvert `sessionEnCours` (conv-1063). Une session CLI vit dans le dossier
     * de SON compte : dès que le compte actif diffère — bascule à la main pendant le tour, ou rotation
     * après un quota épuisé —, la reprendre rend « No conversation found » et le tour meurt.
     */
    let compteDeSession = compteAuDepart
    /** Comptes dont le quota est tombé PENDANT ce tour : jamais de rejeu vers l'un d'eux. */
    const comptesEpuisesCeTour = new Set<string>()
    /**
     * REPLI APRES UN REFUS DU FILTRE DE SECURITE (`deciderRepliApresRefus`) : joue UNE fois par tour.
     * Le modele voisin reste celui du tour une fois choisi : le message refuse est desormais dans la
     * session, revenir au modele qui l'a refuse a l'iteration suivante rejouerait le meme refus.
     */
    let repliApresRefusTente = false
    let modeleApresRefus: string | undefined
    // Combien de segments de `convo` ont DÉJÀ été expédiés dans ce tour (voir la construction du
    // message plus bas) : au-delà, la session reprise les porte déjà.
    let segmentsDejaEnvoyes = 0
    // Un détour par un autre provider/modèle ajoute des échanges absents de l'ancienne session.
    // Elle devient donc définitivement périmée, même si l'utilisateur revient ensuite au binding initial.
    if (conversationId && known && known.key !== sessionKey) {
      this.chatSessions.delete(conversationId)
      // Le disque doit oublier AUSSI : une entree perimee y survivrait au redemarrage et ferait
      // reprendre une session ouverte sous un autre binding.
      this.forgetPersistedChatSession(conversationId)
    }
    const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')
    // Le contexte Brain vit ICI (et non dans le system) pour ne pas casser le préfixe cachable.
    const brainContext = retrievedContext ? `CONNAISSANCE RÉCUPÉRÉE:\n${retrievedContext}` : ''
    // ÉCHO DE MÉMOIRE — la moitié manquante de la mécanique de claude.exe : ce que le modèle a retenu
    // dans CE fil lui est remis. Ici et non dans le system, pour la même raison que le contexte Brain :
    // un contenu variable dans le préfixe tue le cache. Plafonné à ~1 500 car. — la lecture automatique
    // des fiches avait été coupée parce qu'elle pesait 552 Ko par appel.
    const executionWorkspace = workspaceDuTour.trim()
    const memoryEcho = sessionMemoryBlock(
      rememberedFacts(conversationId, executionWorkspace || undefined),
      undefined,
      evictedCount(conversationId, executionWorkspace || undefined)
    )
    // L'assemblage vit dans `chat-turn-messages.ts` pour être testable sur sa SORTIE plutôt que grepable
    // dans ce fichier. Le tableau reste mutable : la boucle d'itérations y ajoute les tours suivants.
    /**
     * Skill invoquée en tête du message (`/remake …`) : son corps est CHARGÉ et injecté.
     *
     * Sans ça, `/remake` n'était qu'une entrée d'autocomplétion du renderer — le mot n'existait nulle
     * part dans le main, donc le modèle recevait une commande dont il n'avait jamais lu le contrat.
     * Générique par construction : toute skill du kit devient atteignable, sans nouvelle phase.
     */
    // Le nom NU en tete (« draft … », conv-988) charge le meme corps que `/draft` : c'est ce qui
    // rend vraie la bulle de skill que le fil affiche desormais pour cette forme.
    const invoked =
      invokedSkillId(lastUserMessage?.content ?? '') ??
      skillNommeeSansBarre(lastUserMessage?.content ?? '')
    // /draft : le choix entre propositions passe par les boutons du bloc, jamais par `ask`
    // (draft-choix-par-boutons.ts — conv-310/311/312, 2026-10-17).
    const draftChoixParBoutons = boucleDraftEnCours(history, invoked)
    /*
     * UN `/nom` INCONNU NE DOIT PLUS DISPARAITRE EN SILENCE.
     *
     * `skillInstruction` rend '' pour une skill introuvable : le message repartait alors comme du
     * texte ordinaire, sans que personne sache que la commande n'avait pas pris. Mesure du
     * 2026-09-16 sur `conversations.json` : 12 invocations reellement tapees dans ce cas, dont
     * `/design` SIX fois apres son retrait du kit. On injecte donc la note a la place du corps vide.
     */
    const skillBody = invoked ? skillInstruction(invoked) || (noteSkillInconnue(invoked) ?? '') : ''
    /**
     * Le compte-rendu d'un tour execute sans le modele est CONSOMME ici — une seule fois.
     *
     * Lu puis retire : le laisser en place le re-injecterait a chaque tour suivant, ou il deviendrait
     * un vieux resultat presente comme frais. Il n'est utile qu'au tour qui suit immediatement le trou.
     * Retire meme sans reprise de session : dans ce cas l'historique complet part de toute facon, donc
     * la note est redondante — la garder ne ferait que la faire ressortir plus tard, a contretemps.
     */
    const compteRenduNonVu = conversationId ? this.consommerCompteRendu(conversationId) : undefined
    /*
     * LE RAPPEL EST INJECTE, PAS ATTENDU.
     *
     * Les outils de recherche existent (`conversation_search`, `conversation_read`), mais rien ne
     * garantit que le modele PENSE a les appeler -- et il n'y pensera pas, parce qu'il ne sait pas
     * qu'il ignore quelque chose : « remake les pastilles de couleurs » se lit comme une demande
     * complete. Attendre qu'il s'en avise, c'est reconduire conv-1407 en esperant mieux.
     *
     * Se declenche sur toute demande non vide (le seuil de brievete a ete retire), et exclut la
     * conversation courante : voir les bornes dans `rappel-conversations.ts`.
     */
    // Dependance OPTIONNELLE, et assumee comme telle : un rappel est un CONFORT. Un tour qui
    // echouerait faute de rappel ferait dependre chaque message d'une commodite -- et les bus
    // factices des tests, qui n'implementent que ce qu'ils exercent, tomberaient avec lui.
    const rappelBrut =
      typeof this.bus.rappelPourDemande === 'function'
        ? this.bus.rappelPourDemande(lastUserMessage?.content, conversationId)
        : ''
    // Session neuve = rien d'envoye encore : on repart a zero. Session reprise = on ne renvoie
    // pas un extrait que la session porte deja (conv-706 : conv-627/conv-624 a chaque tour).
    const cleRappel = conversationId ?? ''
    if (!resumeSessionId || !this.rappelDejaEnvoye.has(cleRappel)) {
      this.rappelDejaEnvoye.set(cleRappel, new Set())
    }
    const rappelConversations = rappelSansDejaEnvoye(
      rappelBrut,
      this.rappelDejaEnvoye.get(cleRappel) as Set<string>
    )
    // MESSAGES D'AUTRES FILS (conv-1139) : remis UNE fois, marqués livrés dans le journal commun.
    // Dépendance optionnelle, comme le rappel : les bus factices des tests ne l'implémentent pas.
    const messagesDesFils =
      typeof this.bus.messagesDesFilsPourTour === 'function'
        ? this.bus.messagesDesFilsPourTour(conversationId)
        : ''
    /**
     * LE NOM DE CHAQUE INJECTION DU MESSAGE, tenu a part du texte.
     *
     * `convo` est un tableau de chaines qui grossit tout au long du tour (directives arrivees en
     * cours de route, reponses d'outils, corrections). Ses blocs perdaient leur identite des la
     * construction : l'Observatory recevait un message compose ou plus rien ne distinguait ce que
     * l'HUMAIN avait tape de ce qu'Autowin avait pousse — etat de l'app, savoir Brain, echo de
     * memoire, rappel de conversations, corps de skill.
     *
     * Registre PARALLELE plutot qu'un tableau d'objets : `convo` est pousse depuis une quinzaine
     * d'endroits de ce fichier. En changer la forme pour de l'observabilite aurait touche du code
     * de decision. Une entree absente du registre n'est jamais devinee : elle ressort sous le nom
     * generique de l'echange intra-tour, qui est ce qu'elle est.
     */
    const cleEtat = conversationId ?? ''
    const snapshotPrecedent = this.dernierEtatPousse.get(cleEtat)
    const partiesDuMessage = {
      snapshot,
      ...(snapshotPrecedent !== undefined ? { snapshotPrecedent } : {}),
      brainContext,
      memoryEcho,
      rappelConversations,
      messagesDesFils,
      skillBody,
      history,
      resumeSessionId,
      lastUserMessage: lastUserMessage?.content,
      compteRenduNonVu,
      tourCoupePourCeMessage
    }
    const blocsDuTour = buildTurnMessageBlocks(partiesDuMessage)
    // La lecture annoncée est remise au modèle, qui fait alors le travail selon elle (conv-1123).
    if (lectureRetenue)
      blocsDuTour.push({
        name: 'lectureRetenue',
        text: consigneDeLectureRetenue(lectureRetenue.retenue, lectureRetenue.ecartee)
      })
    // Ce qui vient detre pousse devient la reference du prochain tour de CETTE conversation.
    this.dernierEtatPousse.set(cleEtat, snapshot)
    const nomsDuTour = new Map(blocsDuTour.map((bloc) => [bloc.text, bloc.name]))
    const convo: string[] = blocsDuTour.map((bloc) => bloc.text)
    /**
     * Les blocs d'ouverture de `convo` sont-ils encore ceux d'une REPRISE (historique absent, diff
     * d'état) ? Ils ne se reconstruisent qu'une fois par tour, et `blocsInitiaux` suit leur nombre
     * pour que cette reconstruction remplace exactement eux, jamais un échange intra-tour.
     */
    let blocsInitiauxAmputes = Boolean(resumeSessionId)
    let blocsInitiaux = blocsDuTour.length
    /** Decomposition NOMMEE de ce qui part cote user, relue a l'instant de l'envoi. */
    const contextBlocksDuTour = (): Array<{ name: string; chars: number }> =>
      convo.map((entree) => ({
        name: nomsDuTour.get(entree) ?? 'echangeIntraTour',
        chars: entree.length
      }))
    /**
     * LES PIECES JOINTES DE TOUT LE FIL, PAS SEULEMENT DU DERNIER MESSAGE.
     *
     * Avant : `history.at(-1)?.attachments`. Une image jointe a un tour ANTERIEUR n'atteignait
     * jamais le modele — vecu par l'utilisateur le 2026-08-27 : il joint une image, en reparle au
     * tour suivant, et l'orchestrateur repond qu'aucune image ne lui est parvenue. Elle etait bien
     * stockee, affichee, et remise dans `history` par `index.ts` ; elle mourait ici.
     *
     * Le plus RECENT d'abord, puis on borne : les gardes IPC plafonnent a 8 pieces jointes, et la
     * question du tour porte presque toujours sur la derniere image. Sacrifier la plus ancienne est
     * une perte bornee et lisible ; jeter la courante serait reconduire le defaut.
     *
     * Dedoublonnage par (nom, contenu) : un fil ou l'utilisateur renvoie la meme capture deux fois
     * ne doit pas payer deux fois le meme binaire, ni consommer deux places sur les 8.
     */
    const MAX_PIECES_JOINTES_DU_FIL = 8
    const currentAttachments = ((): NonNullable<Message['attachments']> => {
      const vues = new Set<string>()
      const retenues: NonNullable<Message['attachments']> = []
      for (let index = history.length - 1; index >= 0; index--) {
        for (const brute of history[index]?.attachments ?? []) {
          /*
           * UNE PIECE JOINTE SANS BINAIRE N'EST PAS UNE PIECE JOINTE.
           *
           * Le fil PERSISTE `AttachmentMeta` (nom, type, taille, miniature) — le contenu original
           * n'y est PAS. Un fil rehydrate apres relecture rend donc des pieces jointes sans
           * `content` ; les envoyer telles quelles ferait ecrire un fichier vide au provider
           * (`materializeClaudeAttachments` fait `Buffer.from(content, 'base64')`). On les
           * remplace par leur MINIATURE quand elle existe -- degradee, mais lisible et NOMMEE
           * comme telle, jamais presentee comme l'original.
           */
          const lisible = aPieceJointeLisible(brute) ? brute : replierSurLaMiniature(brute)
          if (!lisible) continue
          /*
           * DIRE D'OU ELLE VIENT, sinon elle passe pour une piece jointe du message COURANT.
           *
           * Mesure du 2026-08-27 : le binaire arrivait bien au tour 2 (trace de prompt : chemin
           * present), et le modele repondait pourtant « AUCUNE IMAGE ». Sur une session reprise, le
           * fil textuel n'est pas renvoye — rien ne reliait donc le fichier remis au message
           * precedent, et l'entete du provider l'annonce comme « fournie par l'utilisateur »,
           * comprendre : maintenant. Le nom porte desormais la provenance.
           */
          const piece =
            index === history.length - 1
              ? lisible
              : {
                  ...lisible,
                  name: `${lisible.name} (jointe a un message precedent)`,
                  // Le provider range les pieces par CE champ, pas par le nom (conv-150, tour 1bf1ae63).
                  provenance: 'message-precedent' as const
                }
          // Cle calculee sur la piece AVANT renommage : sinon la meme image, jointe au message
          // courant ET a un message passe, produit deux cles et part deux fois (attrape par le test).
          const cle = `${lisible.name}|${lisible.content}`
          if (vues.has(cle)) continue
          vues.add(cle)
          retenues.push(piece)
          if (retenues.length >= MAX_PIECES_JOINTES_DU_FIL) return retenues
        }
      }
      return retenues
    })()

    // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur). `derniereEntree`
    // n'est PAS cumulée : voir `TurnUsage`.
    const usage: TurnUsage & { costUsd: number } = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

    let iterationLimit = maxIter
    /**
     * T1a — POINT UNIQUE de recovery du cap d'itérations. Avant, `iterationLimit += 1` était
     * dispersé à 4 endroits distincts, chacun avec son propre garde « une seule fois » : ajouter un
     * 5ᵉ cas de recovery obligeait à deviner où placer un nouvel incrément. Chaque site nommé
     * appelle désormais cette fonction avec un motif — la logique d'incrément elle-même ne vit
     * qu'ICI, même si les gardes anti-boucle (`invalidQuestionRecoveryAvailable`, etc.) restent
     * locales à chaque cas puisqu'elles portent un sens métier différent par motif.
     */
    const recoveryReasons: Array<
      | 'late-directive'
      | 'invalid-question'
      | 'muted-turn'
      | 'chiffre-non-verifie'
      | 'conclusion-absente'
      | 'echec-taise'
      | 'correction-apres-echec'
      | 'annonce-sans-action'
      | 'outil-pretendu-absent'
      | 'question-sans-lecture'
      | 'commande-illisible'
      | 'preuve-promise'
      | 'geste-rendu'
      | 'bloc-visuel-non-ferme'
    > = []
    const grantRecoveryIteration = (
      reason:
        | 'late-directive'
        | 'invalid-question'
        | 'muted-turn'
        | 'chiffre-non-verifie'
        | 'conclusion-absente'
        | 'echec-taise'
        | 'correction-apres-echec'
        | 'annonce-sans-action'
        | 'outil-pretendu-absent'
        | 'question-sans-lecture'
        | 'commande-illisible'
        | 'preuve-promise'
        | 'geste-rendu'
        | 'bloc-visuel-non-ferme'
    ): void => {
      recoveryReasons.push(reason)
      iterationLimit += 1
    }
    let invalidQuestionRecoveryAvailable = true
    /**
     * TOUR MUET — un tour qui n'a produit que des etiquettes d'action est inexploitable.
     *
     * Constate sur conv-76 (2026-07-29) : trois messages assistant de 40 a 64 caracteres, contenant
     * uniquement « [a execute edit_file] [a execute verify] ». L'utilisateur ne pouvait pas savoir ce
     * qui avait ete fait — il a cru que les sous-agents ne se lançaient plus alors que 18 appels
     * avaient tourne pour 10,05 $. Le prompt demande deja de conclure ; le modele ne le fait pas
     * toujours. On le rend donc MECANIQUE : si le tour se termine sans un mot alors qu'il a AGI, on
     * redemande explicitement la conclusion. Une seule fois, comme la reprise de question invalide.
     */
    let anyActionExecuted = false
    /**
     * Un outil NATIF qui agit (Write, Edit, Bash non lecteur) a tourne dans ce tour. Separe de
     * `anyActionExecuted` a dessein : il ne sert qu'au garde « annonce sans action » (fausse alerte
     * du 2026-09-22, conv-782), sans changer les autres gardes fondes sur les `<cmd>` Autowin.
     */
    let actionNativeCeTour = false
    /** Le modele a emis `<cmd>` dans ce tour (lu ou non) — sert au repli de cloture. */
    let cmdEmisCeTour = false
    /**
     * A-t-il parle A UN MOMENT du tour ? La question porte sur le TOUR ENTIER, pas sur la derniere
     * iteration : un tour « Avant. <action> Apres. » suivi d'une reponse vide a deja tout dit, le
     * relancer serait du bavardage paye. (Bug attrape par agent-pilot.streaming.test.ts.)
     */
    let anySpokenText = false
    let conclusionRecoveryAvailable = true
    /** Une LECTURE a-t-elle eu lieu ? Un chiffre sans lecture est une supposition, pas une reponse. */
    let anyReadExecuted = false
    /**
     * Un `run` ou un `verify` a-t-il VRAIMENT tourne (`commandeAObserveLeReel`) ? Compte comme une
     * lecture pour la SEULE garde « chiffre non verifie » (conv-267) : la garde « question sans
     * lecture » garde son critere, qui n'etait pas en cause.
     */
    let sortieDeCommandeObservee = false
    /**
     * Artefacts DEJA publies dans le fil pendant ce tour, par identifiant.
     *
     * Un artefact arrive deux fois : une premiere en direct (flux du provider, a sa place
     * chronologique) puis une seconde dans le resultat final du meme appel. L'identifiant est
     * deterministe (empreinte du contenu), donc cet ensemble suffit a n'en afficher qu'un.
     */
    const artefactsDejaEmis = new Set<string>()
    /**
     * VIDÉO LIVRÉE = VIDÉO MONTRÉE (conv-253, constat conv-260) : une vidéo citée dans la réponse et
     * écrite depuis ce début de tour arrive dans le lecteur du fil, sans `show_video`. L'ensemble
     * retient celles déjà montrées (par la commande ou ici) pour n'en afficher qu'un lecteur.
     */
    const debutDuTourMs = Date.now()
    const videosDejaMontrees = new Set<string>()
    /**
     * Une QUESTION a-t-elle ete posee ce tour ? Mesure (conv-1399) : une question a
     * quatre options posee sans avoir lu un seul fichier, dont une option DEJA implementee et
     * committee. L'utilisateur a attendu pour une reponse qui etait a portee de lecture.
     */
    let questionPoseeCeTour = false
    /** La question posée est celle des deux lectures : aucune relance « question sans lecture ». */
    let questionDesLecturesPosee = false
    /**
     * La reponse que l'utilisateur a envoyee PENDANT que le tour posait sa question. Non vide = la
     * question est deja repondue : on ne la repose pas et on ne clot pas le tour sur elle.
     */
    let reponseTardiveAUneQuestion: string | undefined
    let questionSansLectureRecoveryAvailable = true
    /** Dernier texte visible du tour, pour juger s'il avance un nombre non verifie. */
    let visibleTextThisTurn = ''
    // Index de l'itération pour laquelle la consigne de clôture forcée a déjà été injectée.
    let consigneClotureInjectee = -1
    let chiffreNonVerifieRecoveryAvailable = true
    let conclusionFormatRecoveryAvailable = true
    /**
     * UNE SEULE relance de FORME par tour, toutes gardes confondues.
     *
     * Sans ce verrou commun, elles s'enchainent : le tour muet est relance, sa reponse n'a pas encore
     * de bloc de cloture, la garde suivante repart, puis celle de l'echec tu — trois iterations
     * payantes pour un seul tour, et une sortie qui ne ressemble plus a rien. Constate le 2026-08-15 :
     * quatre fichiers de tests d'`agent-pilot` sont tombes d'un coup pour cette raison.
     *
     * Chaque garde reste bornee a une fois par elle-meme ; ce verrou borne l'ENSEMBLE.
     */
    let relanceDeFormeUtilisee = false
    /** Une action de CE tour a-t-elle echoue ? Un « Fait » pose dessus serait un mensonge. */
    let anyActionFailed = false
    /*
     * L'echec de la DERNIERE iteration, distinct de `anyActionFailed` qui cumule tout le tour.
     * Une commande plantee puis rejouee avec succes doit desarmer la reprise : c'est exactement
     * le comportement qu'on veut encourager, pas un motif de relance.
     */
    let echecDeLaDerniereIteration = false
    /*
     * LES ECHECS ENCORE NON REPARES, par nom de commande. Demande de l'utilisateur du 2026-08-22 :
     * « toutes les actions avec erreur captees en cours de run et corrigees avant la fin du tour ».
     *
     * `echecDeLaDerniereIteration` ne suffisait pas : remis a plat a chaque iteration, il laissait un
     * echec enjambe a l'iteration 2 sortir du champ de la correction des l'iteration 3. Cet echec
     * tombait alors dans l'aveu, qui reformule « SANS aucune commande » — capte, mais explicitement
     * NON corrige.
     *
     * Le suivi se fait par NOM DE COMMANDE et non par signature : une signature agrege le nom ET le
     * texte d'erreur, donc un succes ulterieur ne peut jamais s'y apparier. C'est aussi exactement
     * l'intention deja ecrite pour le drapeau jumeau — « une commande plantee puis rejouee avec
     * succes doit desarmer la reprise » — simplement tenue sur tout le tour au lieu d'une iteration.
     */
    const commandesEnEchecNonRattrape = new Set<string>()
    /*
     * LE LIEN DE REPRISE. Pour chaque cible encore en echec, l'`actionId` de l'action QUI A ECHOUE.
     * Quand une action reussit sur la MEME clef (nom + argument identifiant, cf. `cleDEchec`), le
     * resultat emis porte `retryOf` = cet identifiant : le journal montre alors explicitement quel
     * echec a ete rattrape, au lieu de laisser deviner par voisinage.
     */
    const actionIdParEchec = new Map<string, string>()
    emettreEchecsAbandonnes = (): void => {
      if (commandesEnEchecNonRattrape.size === 0) return
      publier({
        kind: 'echecs-abandonnes',
        name: 'échecs abandonnés',
        data: [...commandesEnEchecNonRattrape].map((cible) => ({
          actionId: actionIdParEchec.get(cible) ?? '',
          cible
        }))
      })
    }
    /*
     * AUTO-KAIZEN EN COURS DE TOUR. Le registre des murs deja rencontres : sans lui, corriger-et-
     * poursuivre autorise le pire des retours — rejouer la meme commande, remanger le meme mur, et
     * bruler les iterations dans un trou de lapin. DEUX reprises au plus : la correction, puis UNE
     * escalade qui interdit la repetition et exige de capitaliser la lecon.
     *
     * FILET, non exerce par les tests, et c'est dit exprès : mesure du 2026-08-21, en portant ce
     * compteur a 99 le nombre de reprises observe ne bouge pas — le verrou d'escalade (mur repete)
     * ou le flux lui-meme (murs distincts) borne toujours en premier. Il est garde comme garde-fou
     * d'un chemin non enumere, pas presente comme le mecanisme de bornage.
     */
    let reprisesApresEchecRestantes = 2
    /*
     * RALLONGES DE DIRECTIVE TARDIVE — BORNEES. Une directive arrivee pendant l'appel provider
     * merite bien une iteration de plus : c'est l'utilisateur qui parle, et sa phrase doit pouvoir
     * etre traitee dans le tour. Mais l'incrément etait le SEUL des 13 motifs de rallonge sans
     * garde : un appelant qui fixe une borne finie (`policy.maxIterations`, un harnais de test)
     * pouvait la voir reculer indefiniment, puisque le cap grandit exactement aussi vite que la
     * boucle avance. En production le defaut est invisible — `CAP_ITERATIONS_TOUR` vaut l'infini
     * depuis le 2026-09-04, donc `+ 1` n'y change rien — mais une borne qui ne borne pas n'est pas
     * une borne. Au-dela du budget, la directive est TOUJOURS injectee dans la conversation : seule
     * la rallonge du cap s'arrete. On ne perd donc aucune parole de l'utilisateur.
     */
    let rallongesDirectiveTardiveRestantes = 3
    /*
     * AMORCE depuis le disque : sans elle le registre mourait a la frontiere du tour, et l'agent
     * remangeait le meme mur au tour suivant en croyant le decouvrir. `chargerMurs` est fail-open —
     * un cache illisible vaut « aucun mur connu », jamais une exception dans le tour.
     */
    const signaturesDEchecVues: string[] = conversationId ? chargerMurs(conversationId) : []
    let derniereSignatureDEchec = ''
    let dernierEchecEstUnRejeu = false
    let echecTuRecoveryAvailable = true
    /** Une seule relance pour un outil faussement declare absent : au-dela, on n'insiste pas. */
    let outilAbsentRecoveryAvailable = true
    let annonceSansActionRecoveryAvailable = true
    /** Une clôture qui promet un compte-rendu futur : relance UNE fois, jamais plus. */
    let preuvePromiseRecoveryAvailable = true
    let gesteRenduRecoveryAvailable = true
    let bureauUtilise = false
    /**
     * LA COMPTABILITE D'UNE COMMANDE EXECUTEE — commune au texte `<cmd>` et aux outils directs.
     *
     * Extraite telle quelle du chemin `<cmd>` pour que l'appel direct (`chat-mcp.ts`) soit COMPTE
     * exactement pareil : depot de memoire refuse (`refusRememberAuxiliaire`, dit a la cloture),
     * echec non rattrape (bilan `echecs-abandonnes`, reprise apres echec), mur deja rencontre. Une
     * seconde copie de ce bloc divergerait au premier correctif — d'ou une seule fonction.
     * Rend l'issue pour que l'appel direct la reporte sur son iteration (voir plus bas).
     */
    const comptabiliserCommande = (
      nom: string,
      args: Record<string, unknown>,
      r: CommandResult,
      actionId: string
    ): { reussie: boolean; rejeu: boolean } => {
      const commandSucceeded = commandResultSucceeded(r)
      // Ici et pas dans un seul des deux chemins : `<cmd>` et outil direct passent tous deux par
      // cette comptabilite, et une commande en echec (code de sortie non nul) a pu observer.
      if (commandeAObserveLeReel(nom, r)) sortieDeCommandeObservee = true
      if (nom === 'remember') {
        // Sur `stored`, PAS sur la reussite du transport : voir motifDepotMemoireNonAbouti.
        // Assignation INCONDITIONNELLE : un depot REJOUE avec succes doit EFFACER le refus
        // precedent, sinon la cloture porterait un « NON deposee » dementi par la reprise.
        refusRememberAuxiliaire = motifDepotMemoireNonAbouti(r)
        if (!refusRememberAuxiliaire) depotMemoireCeTour = true
      }
      /*
       * La clef porte le nom ET LA CIBLE. Avec le nom seul, un `edit_file` reussi sur `b.ts`
       * purgeait l'echec jamais rejoue sur `a.ts` — defaut mesure le 2026-08-22 par deux juges
       * externes independants, et mon commentaire revendiquait alors une garantie que la clef ne
       * pouvait pas donner. `cleDEchec` ne retient que les arguments IDENTIFIANTS, pour qu'une
       * reprise du meme fichier avec un contenu corrige rende la MEME clef.
       */
      const cleCible = cleDEchec(nom, args)
      // Rejouee avec succes sur la MEME cible : l'echec est repare, il ne pese plus sur la cloture.
      if (commandSucceeded) {
        commandesEnEchecNonRattrape.delete(cleCible)
        actionIdParEchec.delete(cleCible)
        return { reussie: true, rejeu: false }
      }
      anyActionFailed = true
      echecDeLaDerniereIteration = true
      commandesEnEchecNonRattrape.add(cleCible)
      actionIdParEchec.set(cleCible, actionId)
      const signature = signatureDEchec(
        nom,
        String(r.ok ? JSON.stringify(r.data) : (r.error ?? ''))
      )
      // Le test d'appartenance passe AVANT l'enregistrement, sinon le mur courant serait
      // toujours « deja vu » et la premiere rencontre declencherait l'escalade a tort.
      // AGREGE sur l'iteration : si AU MOINS UN echec de cette iteration est un rejeu connu,
      // l'escalade est due. Ne garder que le dernier perdait silencieusement l'escalade quand
      // une iteration enchainait un mur deja connu PUIS un mur neuf (audit du 2026-08-21).
      const rejeu = signaturesDEchecVues.includes(signature)
      dernierEchecEstUnRejeu = dernierEchecEstUnRejeu || rejeu
      derniereSignatureDEchec = signature
      signaturesDEchecVues.push(signature)
      if (conversationId) {
        try {
          enregistrerMur(conversationId, signature)
        } catch {
          /* best-effort : c'est un cache d'indice, il ne doit jamais casser le tour */
        }
      }
      return { reussie: false, rejeu }
    }
    /*
     * OUTILS DIRECTS DU MODELE (`chat-mcp.ts`) — etat de l'iteration COURANTE.
     *
     * Les appels directs ont lieu PENDANT l'envoi ; la boucle des `<cmd>` vient apres. On retient
     * donc ce qu'ils ont execute (pour ne pas rejouer un `<cmd>` identique de la meme reponse, y
     * compris d'une tentative precedente du meme envoi) et s'ils ont echoue (la boucle des `<cmd>`
     * remet ces drapeaux a plat : elle doit reporter ceux des appels directs, pas les effacer).
     */
    let executesParCanalNatif = new Set<string>()
    let echecNatifCetteIteration = false
    /*
     * Les echecs directs de CETTE iteration encore NON rattrapes, par nom + cible (`cleDEchec`).
     * Un tour d'outils directs tient en UN envoi : le modele y voit chaque resultat et rejoue sur
     * place. Lever le drapeau au premier rouge sans jamais le baisser au vert relancait « ta
     * derniere action a ECHOUE » apres une reparation deja faite (conv-302, 2026-10-17, tour
     * 1201313c : typecheck rouge puis vert dans la meme reponse). Le drapeau suit donc ce registre.
     */
    const echecsNatifsNonRattrapes = new Set<string>()
    let rejeuNatifCetteIteration = false
    let iterationNatif = 0
    let appelNatifIndex = 0
    const replisNatifsDits = new Set<string>()
    /**
     * UN APPEL DIRECT S'AFFICHE ET COMPTE EXACTEMENT COMME UN `<cmd>` : carte, progression, resultat,
     * capture publiee dans le fil, drapeaux du tour (action, lecture, bureau) et comptabilite commune.
     * Sans eux, les gardes de cloture (« rien execute », « echec tu », « fais le geste ») mordaient a
     * tort ou se taisaient. Seule difference : la capture n'est pas rejointe au message suivant, le
     * modele l'a deja recue en bloc `image` dans le resultat de l'outil.
     */
    const executerAppelNatif = async (
      nom: string,
      args: Record<string, unknown>
    ): Promise<CommandResult> => {
      signal?.throwIfAborted()
      // Marquee AVANT l'execution : un `<cmd>` identique ne doit pas la rejouer, meme en echec.
      executesParCanalNatif.add(cleAppelNatif(nom, args))
      const actionId = `natif:${iterationNatif}:${appelNatifIndex++}`
      anyActionExecuted = true
      if (nom === 'desktop_act' || nom === 'desktop_observe') bureauUtilise = true
      if (nom === 'list_files' || nom === 'read_file' || nom === 'find_in_files') {
        anyReadExecuted = true
      }
      emit({ kind: 'command', actionId, name: nom, args })
      const r = await execCommandTolerante(nom, args, (text) =>
        emit({ kind: 'action-progress', actionId, text })
      )
      let indexCapture = 0
      for (const piece of r.attachments ?? []) {
        if (piece.kind !== 'image' || !piece.content) continue
        emit({
          kind: 'artifact',
          iteration: iterationNatif,
          artifact: {
            id: `tool-capture-${actionId}-${indexCapture++}-${piece.name}`,
            name: piece.name,
            mimeType: piece.mimeType,
            kind: 'image',
            size: piece.size,
            createdAt: Date.now(),
            encoding: 'base64',
            content: piece.content,
            source: { provider, tool: nom }
          }
        })
      }
      const echecRattrape = commandResultSucceeded(r)
        ? actionIdParEchec.get(cleDEchec(nom, args))
        : undefined
      emit({
        kind: 'result',
        actionId,
        name: nom,
        ok: commandResultSucceeded(r),
        data: r.ok ? r.data : r.error,
        ...(echecRattrape ? { retryOf: echecRattrape } : {}),
        ...(r.attachments?.length ? { attachments: r.attachments } : {})
      })
      const compte = comptabiliserCommande(nom, args, r, actionId)
      if (compte.reussie) echecsNatifsNonRattrapes.delete(cleDEchec(nom, args))
      else {
        echecsNatifsNonRattrapes.add(cleDEchec(nom, args))
        if (compte.rejeu) rejeuNatifCetteIteration = true
      }
      echecNatifCetteIteration = echecsNatifsNonRattrapes.size > 0
      // `comptabiliserCommande` leve aussi le drapeau de l'iteration au premier rouge. Pendant
      // l'envoi, il ne porte que les appels directs (remis a plat au debut de l'iteration) : il suit
      // donc le meme registre, sinon le vert d'une reprise sur place ne le baisserait jamais.
      echecDeLaDerniereIteration = echecNatifCetteIteration
      return r
    }
    /** Une fence ```html-render laissée ouverte : relance UNE fois, jamais plus. */
    let blocVisuelRecoveryAvailable = true
    /**
     * BLOC `<cmd>` INEXPLOITABLE ET AUCUNE COMMANDE VALIDE — le TOUR PARASITE.
     *
     * Mesure sur `conv-1472` (2026-08-27, tour `c73fd638`) : le modele emet
     * `<cmd>{"name":"orchestrate","args":{...}` — une accolade fermante MANQUANTE. Le parseur en fait
     * bien un token `invalid`, mais le signalement (evenement visible + reinjection) vivait
     * EXCLUSIVEMENT dans la boucle d'execution, gardee par `hasCommand` qui ne compte QUE les tokens
     * `command`. Resultat : le bloc brut s'affichait tel quel, RIEN n'etait execute, aucune relance
     * n'etait armee, et le tour se cloturait sur « Je lance la fusion en build. » — l'utilisateur
     * devait retaper « go ». Une relance MECANIQUE, bornee a une fois, rend la main aux commandes.
     */
    let commandeIllisibleRecoveryAvailable = true
    let commandAttachments: NonNullable<Message['attachments']> = []
    /**
     * Le texte d'un tour qui se termine — JAMAIS vide.
     *
     * Cause racine des « conversations qui echouent » (conv-1141) : un tour ayant AGI sans rien DIRE
     * produisait une bulle vide, et l'utilisateur renvoyait le meme prompt en boucle sans jamais
     * savoir ce qui ratait. Deux sites cloturent un tour ; ils partagent ce repli plutot que d'en
     * garder chacun une copie qui divergerait.
     */
    const texteDeCloture = (spoken: string): string => {
      const texte =
        spoken ||
        (anyActionExecuted
          ? 'J’ai agi mais je n’ai pas produit de conclusion en clair — vois les cartes ' +
            'd’action ci-dessus pour le detail (et leurs eventuels echecs).'
          : cmdEmisCeTour
            ? texteCmdIlisible()
            : 'Aucune reponse produite pour ce tour.')
      /*
       * UN REFUS DE MEMOIRE ENCORE DEBOUT SUIT LE TOUR JUSQU'A SA CLOTURE, QUELLE QU'ELLE SOIT.
       *
       * La mention ne vivait que dans le raccourci `onlyAuxiliaryRemember`. Des que la reprise rend
       * la main au modele (conv-52), le tour se clot ailleurs — branche sans commande, question,
       * repli sur le cap — et le refus disparaissait alors COMPLETEMENT : ni le modele ni
       * l'utilisateur n'apprenaient que rien n'avait ete ecrit. La mention est donc portee par le
       * point de cloture COMMUN, et elle s'efface d'elle-meme quand un depot rejoue reussit.
       */
      // Une « Leçon : » écrite sans AUCUN dépôt dans le tour le dit aussi (conv-335) ; un refus
      // encore debout le dit déjà, d'où l'une OU l'autre mention, jamais les deux.
      return refusRememberAuxiliaire
        ? `${texte}

⚠️ Mémoire NON déposée — ${refusRememberAuxiliaire}`
        : avertirSiLeconNonRetenue(texte, depotMemoireCeTour)
    }
    // L'etat ENTIER part deja dans le premier message du tour : les iterations suivantes n'en
    // repoussent que le DELTA (voir `etat-diff.ts`).
    let dernierEtatEnvoye: EtatPrompt = snapshot
    for (let i = recoveredProviderCall?.iteration ?? 0; i < iterationLimit; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(
          `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${motsUtilisateur(directive)}`
        )
      }
      /**
       * CAP RÉINJECTÉ COMME CONSIGNE DE CLÔTURE FORCÉE (conv-1485).
       *
       * Le modèle ignorait tout du cap : il continuait d'agir jusqu'à ce que la boucle meure sur
       * « Cap d'itérations (N) atteint sans réponse finale », en jetant le texte déjà dit. On le
       * PRÉVIENT à la dernière itération pour qu'il règle/rapporte l'erreur en cours et conclue.
       * Injectée une seule fois par index : `grantRecoveryIteration` peut relever le cap APRÈS,
       * auquel cas la nouvelle dernière itération reçoit sa propre consigne.
       */
      /**
       * BUDGET DU TOUR ANNONCE A MI-PARCOURS, PAS SEULEMENT AU DERNIER APPEL.
       *
       * Le modele n'apprenait son cap qu'a `iterationLimit - 1` : a cet instant il ne peut plus
       * changer de methode, seulement CONSTATER. Mesure le 2026-09-03 (conv-10) : douze iterations
       * depensees une par une en lecture (un `read_file` par appel), la seule ecriture tentee au
       * douzieme — et refusee. L'utilisateur a recu un diagnostic la ou il demandait un correctif,
       * alors que le levier existait des le premier appel : plusieurs commandes tiennent dans UN
       * SEUL message et ne coutent qu'un appel.
       *
       * On annonce donc le RESTE a mi-parcours, en NOMMANT ce levier. Jamais sur la derniere
       * iteration, qui porte deja sa propre consigne de cloture. Si `grantRecoveryIteration` releve
       * le cap ensuite, la nouvelle moitie recoit sa propre annonce : le budget a change, le modele
       * doit le savoir.
       */
      if (i > 0 && i < iterationLimit - 1 && i === Math.floor(iterationLimit / 2)) {
        convo.push(
          `SYSTÈME — BUDGET DU TOUR : appel ${i + 1} sur ${iterationLimit}, il en reste ` +
            `${iterationLimit - i - 1}. Si la tâche demandée n'est pas encore ENGAGÉE, change de ` +
            'méthode maintenant : plusieurs commandes tiennent dans UN SEUL message et ne coûtent ' +
            "qu'un appel — groupe tes lectures, ou délègue-les. Au dernier appel il ne restera plus " +
            'qu’à constater ce qui n’a pas été fait.'
        )
      }
      if (i === iterationLimit - 1 && consigneClotureInjectee !== i) {
        consigneClotureInjectee = i
        convo.push(
          `SYSTÈME — DERNIÈRE ITÉRATION DE CE TOUR (${i + 1}/${iterationLimit}) : c'est ton dernier ` +
            "appel. N'émets plus de commande : une action de plus fait mourir le tour sans réponse. RÈGLE ou RAPPORTE " +
            "l'erreur en cours (ce qui a échoué, sa cause, l'état réel laissé), puis CONCLUS en " +
            'clair. Un tour sans conclusion écrite est perdu pour l’utilisateur.'
        )
      }
      const iterationAttachments = [
        ...(i === 0 ? (currentAttachments ?? []) : []),
        ...commandAttachments
      ]
      commandAttachments = []
      /**
       * LE FIL N'EST PAS REPAYÉ À CHAQUE ITÉRATION.
       *
       * Mesuré le 2026-08-31 sur conv-1 : le livrable d'une phase `frame` (≈ 6 000 caractères)
       * repartait VERBATIM à chaque itération suivante du même tour — cinq fois — alors que la
       * session du provider portait DÉJÀ tous les segments précédents (`resumeSessionId` est armé
       * à chaque itération depuis conv-1498). On n'expédie donc que les segments NOUVEAUX quand la
       * reprise est réelle.
       *
       * Le repli est le comportement d'avant, et il est SÛR : sans session reprise (provider qui
       * n'honore pas `--resume`, premier appel, session perdue en cours de tour), le fil entier
       * repart. Amputer un prompt que le provider ne complète pas est exactement le défaut de
       * conv-1498 — il reste fermé.
       */
      const reprisePorteLeFil = providerResumes && Boolean(sessionEnCours)
      const segmentsAEnvoyer = reprisePorteLeFil ? convo.slice(segmentsDejaEnvoyes) : convo
      segmentsDejaEnvoyes = convo.length
      const messages: Message[] = [
        {
          role: 'user',
          content: `${segmentsAEnvoyer.map(baliserRelanceAutomatique).join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
          ...(iterationAttachments.length ? { attachments: iterationAttachments } : {})
        }
      ]
      let contextBlocks = contextBlocksDuTour()
      let prompt = this.registry.describePrompt(
        provider,
        messages,
        {
          system,
          systemBlocks,
          contextBlocks,
          model: binding.model,
          reasoningEffort: binding.reasoningEffort,
          ...providerLimits
        },
        binding.model
      )
      prompt.systemBlocks = systemBlocks
      prompt.contextBlocks = contextBlocks
      // Les blocs RÉELLEMENT envoyés : complets, ou sans les commandes servies en outils directs.
      let blocsSystemeDeCetEnvoi = systemBlocks
      let attempt =
        recoveredProviderCall && i === recoveredProviderCall.iteration
          ? recoveredProviderCall.attempt
          : 0
      const requestId = randomUUID()
      const options: SendOptions = {
        system,
        systemBlocks,
        contextBlocks,
        model: modeleApresRefus ?? binding.model,
        reasoningEffort: binding.reasoningEffort,
        ...providerLimits,
        /**
         * REPRIS À CHAQUE ITÉRATION, sur la session RÉELLEMENT ouverte.
         *
         * Le commentaire précédent affirmait que les itérations suivantes « chaînaient déjà » sur la
         * session ouverte par ce tour. Elles ne chaînaient rien : `resumeSessionId` n'était passé
         * qu'à `i === 0`, donc chaque itération suivante démarrait une session VIERGE — avec un
         * message `convo` construit UNE fois et, sous reprise, volontairement amputé de tout
         * l'historique (il est censé vivre dans la session CLI). Le modèle qui rédige la réponse
         * finale, après un appel d'outil, n'avait donc jamais vu le fil.
         *
         * Mesuré en conv-1498 le 2026-08-28 : l'agent nie connaître une variante qu'il avait
         * lui-même proposée deux tours plus tôt. Test : `agent-pilot.session-intra-tour.test.ts`.
         */
        ...(sessionEnCours ? { resumeSessionId: sessionEnCours } : {}),
        // Un tour de CHAT sait rouvrir un tour de reprise dans sa conversation : le provider peut
        // donc confier ses commandes de fond coupees au lieu de dire « relance la demande ».
        ...(conversationId ? { relancerTachesDeFond: true } : {}),
        // Le fil qui écrit : le hook des agents réserve en son nom les fichiers édités, et refuse
        // ceux qu'un autre fil tient encore (conv-1083, shared/reservation-fichiers.ts).
        ...(conversationId ? { conversationId } : {}),
        // Le panneau « Contexte » du chat, detaille par categorie : seul un tour de chat a un ecran.
        ...(conversationId && !watchdogReadOnly ? { mesurerContexte: true } : {}),
        observePrompt: (observed) => {
          observed.systemBlocks = blocsSystemeDeCetEnvoi
          observed.contextBlocks = contextBlocks
          prompt = observed
        },
        signal,
        requestId,
        ...(onProviderJournal
          ? {
              onJournal: (token: string, journalPath: string) => {
                const streamId = `${i}:${attempt}`
                onProviderJournal({
                  provider,
                  token,
                  journalPath,
                  iteration: i,
                  attempt,
                  streamId,
                  requestId
                })
              }
            }
          : {})
      }
      const recoveredHere =
        recoveredProviderCall && i === recoveredProviderCall.iteration
          ? recoveredProviderCall
          : undefined
      let res: SendResult | undefined = recoveredHere?.result
      let etatAvantEnvoi: Awaited<ReturnType<typeof captureMutationTraceBase>>
      let callStartedAt = performance.now()
      let successfulStreamedPrefix = recoveredHere?.streamedPrefix ?? ''
      let successfulAttempt = recoveredHere?.attempt ?? 0
      /**
       * LES FLUX DE TEXTE QUE CETTE ITERATION A AFFICHES — pour pouvoir REMPLACER sa reponse (D2).
       *
       * Mesure du 2026-10-11 (conv-267, tours reels) : une relance qui fait REFAIRE la reponse
       * (« conclusion absente », « chiffre non verifie ») laissait l'ancienne affichee et la nouvelle
       * s'y ajoutait — la premiere phrase deux fois, puis deux blocs « ✅ Fait ». Le moteur ne rendait
       * pourtant qu'UNE reponse : le doublon naissait dans le fil, qui assemble les flux diffuses.
       * Le fil efface un flux par son identifiant EXACT (`reduceChatTurn`, `stream-reset`), et une
       * iteration ecrit sous plusieurs : le direct, `:remainder`, `:sans-bloc`, `:ordered:N`, le
       * repli `fallback:<i>`. On les note donc a l'emission, au lieu d'en deviner la liste.
       */
      const fluxAffichesCetteIteration = new Set<string>()
      if (successfulStreamedPrefix) fluxAffichesCetteIteration.add(`${i}:${successfulAttempt}`)
      /** Retire du fil la reponse de CETTE iteration : la reponse relancee la remplacera. */
      const effacerReponseRelancee = (): void => {
        for (const streamId of fluxAffichesCetteIteration)
          emit({ kind: 'stream-reset', streamId, iteration: i })
        fluxAffichesCetteIteration.clear()
        successfulStreamedPrefix = ''
      }
      // Etat des outils directs pour CETTE iteration (partage entre ses tentatives d'envoi).
      executesParCanalNatif = new Set<string>()
      echecNatifCetteIteration = false
      echecsNatifsNonRattrapes.clear()
      /*
       * Remis a plat ICI, au debut de chaque iteration — pas seulement dans la boucle des `<cmd>`,
       * qu'un tour 100 % outils directs n'atteint jamais. Sans cela, un `verify` direct rouge puis
       * rejoue VERT laissait le drapeau leve : « ta derniere action a ECHOUE » revenait a chaque
       * cloture (conv-908, 2026-10-12). Un echec encore NON repare reste vu par
       * `commandesEnEchecNonRattrape`, qui couvre tout le tour.
       */
      echecDeLaDerniereIteration = false
      rejeuNatifCetteIteration = false
      iterationNatif = i
      // Appel récupéré après redémarrage : ses outils natifs n'ont battu que dans le process mort.
      // Sans ce bilan, « question sans lecture » relançait un tour qui avait lu (conv-1002, tour
      // 9296f09c-6986-41f9-8b6d-f4c2b2a9c2bc, 1,70 $) — voir `bilanDesOutilsNatifsRecuperes`.
      if (recoveredHere) {
        const bilan = bilanDesOutilsNatifsRecuperes(recoveredHere.result.executionEvidence)
        if (bilan.lecture) anyReadExecuted = true
        if (bilan.action) actionNativeCeTour = true
      }
      /**
       * SESSION ABANDONNÉE = FIL ENTIER RENVOYÉ, ET SESSION OUBLIÉE PARTOUT.
       *
       * Point unique des trois sorties qui lâchent la session du fournisseur en cours de tour
       * (« Prompt is too long », plantage du CLI à 0 jeton, refus du filtre de sécurité). Seule la
       * branche « refus » reconstruisait le message : les deux autres repartaient dans une session
       * NEUVE avec le message d'une reprise — sans historique, et affirmant « ta session en porte
       * l'historique » (audit conv-1040, `agent-pilot.reprise-abandonnee.test.ts`). Et « Prompt is too
       * long » n'oubliait la session qu'en mémoire : elle revenait du disque après un redémarrage.
       *
       * Le message renvoyé est `convo` ENTIER : blocs d'ouverture refaits sans reprise (historique
       * complet, état entier au lieu d'un diff) + tous les échanges déjà faits dans ce tour, qu'une
       * itération reprise n'envoyait plus puisque la session les portait.
       */
      const repartirSansSession = (): void => {
        sessionEnCours = undefined
        delete options.resumeSessionId
        if (conversationId) {
          this.chatSessions.delete(conversationId)
          this.forgetPersistedChatSession(conversationId)
        }
        if (blocsInitiauxAmputes) {
          const blocsSansReprise = buildTurnMessageBlocks({
            ...partiesDuMessage,
            resumeSessionId: undefined
          })
          for (const bloc of blocsSansReprise) nomsDuTour.set(bloc.text, bloc.name)
          convo.splice(0, blocsInitiaux, ...blocsSansReprise.map((bloc) => bloc.text))
          blocsInitiaux = blocsSansReprise.length
          blocsInitiauxAmputes = false
        }
        segmentsDejaEnvoyes = convo.length
        messages[0] = {
          ...messages[0],
          content: `${convo.map(baliserRelanceAutomatique).join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`
        }
        contextBlocks = contextBlocksDuTour()
        options.contextBlocks = contextBlocks
      }
      /** Compte actif au départ de l'envoi : c'est lui qui ouvre la session qu'il rendra. */
      let compteDeCetEnvoi = claudeActiveAccountId()
      while (!res) {
        const streamId = `${i}:${attempt}`
        compteDeCetEnvoi = claudeActiveAccountId()
        // Le compte a changé depuis l'ouverture de la session (conv-1063) : elle est inouvrable
        // depuis le nouveau dossier, on la lâche et le fil ENTIER part sur le compte actif.
        if (sessionEnCours && compteDeCetEnvoi !== compteDeSession) repartirSansSession()
        const visibleFilter = new VisibleStreamFilter()
        let attemptStreamedPrefix = ''
        let commandBoundarySeen = false
        const emitVisiblePrefix = (
          segments: ReturnType<VisibleStreamFilter['pushSegments']>
        ): void => {
          for (const segment of segments) {
            if (segment.kind === 'control') {
              if (segment.control === 'cmd') commandBoundarySeen = true
              continue
            }
            if (commandBoundarySeen || !segment.text) continue
            attemptStreamedPrefix += segment.text
            fluxAffichesCetteIteration.add(streamId)
            emit({ kind: 'delta', streamId, text: segment.text, iteration: i })
          }
        }
        // AVANT/APRES du tour (2026-09-23) : un fichier modifie par une commande shell (python,
        // sed…) n'apparait dans aucune preuve Edit/Write, et l'onglet Fichiers restait a 0.
        etatAvantEnvoi =
          conversationId && workspaceDuTour
            ? await captureSaufAnnulation(workspaceDuTour, signal)
            : undefined
        /*
         * OUTILS DIRECTS (`chat-mcp.ts`) : ouverts pour CET envoi, fermes avec lui (`finally` plus
         * bas, y compris sur erreur et sur arret). Meme catalogue que le texte du tour ; jamais pour
         * le tour de surveillance, qui reste sans aucune commande. Un echec n'est jamais fatal : on
         * reste au texte `<cmd>` et on le DIT dans le fil, une fois par motif.
         */
        const natif = this.outilsNatifs
          ? watchdogReadOnly
            ? undefined
            : await ouvrirOutilsNatifsDuChat({
                provider,
                catalogue: catalog,
                exec: (nom, args) => executerAppelNatif(nom, args),
                ...(typeof this.outilsNatifs === 'object' && this.outilsNatifs.demarrer
                  ? { demarrer: this.outilsNatifs.demarrer }
                  : {})
              })
          : undefined
        const outilsDeCetEnvoi = natif && 'servis' in natif ? natif.servis : undefined
        // Le service NORMAL ne s'annonce pas : la ligne « 37 commandes servies » sortait a CHAQUE
        // tour dans le bloc d'actions sans rien apprendre a l'utilisateur (conv-908). Seule une
        // panne se dit, ci-dessous.
        if (natif && 'repli' in natif && !replisNatifsDits.has(natif.repli)) {
          replisNatifsDits.add(natif.repli)
          emit({
            kind: 'provider-status',
            iteration: i,
            text: `Outils directs indisponibles — retour au texte <cmd> : ${natif.repli}`
          })
        }
        try {
          callStartedAt = performance.now()
          timer.mark(`send${i}:start`)
          let sawFirstChunk = false
          // Outils servis : la consigne ne redit plus les commandes qu'ils décrivent déjà (conv-1229).
          // Repli au texte `<cmd>` : la liste complète, seul chemin qui reste au modèle.
          const systemeDeCetEnvoi = outilsDeCetEnvoi
            ? systemeAvecOutilsDirects(outilsDeCetEnvoi.noms)
            : { system, systemBlocks }
          blocsSystemeDeCetEnvoi = systemeDeCetEnvoi.systemBlocks
          prompt.system = systemeDeCetEnvoi.system
          prompt.systemBlocks = systemeDeCetEnvoi.systemBlocks
          const optionsDeCetEnvoi: SendOptions = outilsDeCetEnvoi
            ? { ...options, ...systemeDeCetEnvoi, skillNodeTools: outilsDeCetEnvoi.options }
            : options
          res = await this.registry.send(provider, messages, optionsDeCetEnvoi, (chunk) => {
            /**
             * ARTEFACTS EN DIRECT — a leur place dans le fil.
             *
             * Une image lue par `Read` ou une capture d'ecran arrive au MILIEU du tour. Attendre le
             * `SendResult` pour l'afficher la faisait tomber sous le bloc de cloture (mesure du
             * 2026-09-10, conv-426 : « les blocs image read apparaissent apres le bloc Fait »). On
             * l'emet donc au moment ou le provider la voit, et on retient son identifiant pour ne
             * pas la republier a la fin du tour.
             */
            if (chunk.artifacts?.length) {
              for (const artifact of chunk.artifacts) {
                if (artefactsDejaEmis.has(artifact.id)) continue
                artefactsDejaEmis.add(artifact.id)
                emit({ kind: 'artifact', artifact, iteration: i })
              }
              if (!chunk.delta) return
            }
            // TESTS DU TERMINAL (conv-1059) : le tour les garde, la carte du fil les lit comme des
            // vérifications. Fragment sans texte : il ne doit pas passer pour le premier mot.
            if (chunk.testsDuTerminal?.length) {
              emit({ kind: 'tests-du-terminal', data: chunk.testsDuTerminal, iteration: i })
              if (!chunk.delta && !chunk.status) return
            }
            // COUPURE DU FILTRE DE SÉCURITÉ (conv-1161) : une donnée pour le journal du tour, que
            // lisent la rétrospective et le kaizen. L'avis lisible suit dans `delta`, s'il y en a un.
            if (chunk.coupureFiltre) {
              const categorie = chunk.coupureFiltre.categorie
              emit({
                kind: 'coupure-filtre',
                iteration: i,
                text:
                  "Réponse coupée par le filtre de sécurité d'Anthropic" +
                  (categorie ? ` (catégorie : ${categorie})` : ''),
                data: chunk.coupureFiltre
              })
              if (!chunk.delta && !chunk.status) return
            }
            // Raisonnement : canal SÉPARÉ, diffusé en direct, hors du texte de la réponse.
            if (chunk.status) {
              /*
               * UNE LECTURE NATIVE COMPTE. Les outils natifs du modele (`Read`, `Grep`, `Glob`, un
               * `Bash` de type `cat`/`sed -n`/`grep`) n'emettent aucun jeton `<cmd>` : ils passent
               * ICI, en battement d'outil. Sans cette ligne, `anyReadExecuted` restait faux apres
               * une douzaine de fichiers lus et le garde « question sans lecture » mordait a chaque
               * question -- en ordonnant d'avancer sans demander, donc en ecrasant la skill `draft`
               * qui exige justement de faire choisir l'humain (mesure conv-167, 2026-09-03).
               */
              // Juge la commande ENTIERE, pas le libelle coupe a 120 caracteres (conv-861).
              const statutEntier = statutComplet(chunk.status, chunk.statusTarget)
              // Le message d'erreur d'une action rouge (conv-341) n'est ni une lecture ni un geste :
              // son action a été classée à son départ. Les classeurs reconnaissent un outil natif à
              // son NOM en tête de ligne : « Glob erreur - … » passerait sinon pour une lecture.
              if (!lireLigneDErreur(chunk.status)) {
                if (statusEstUneLecture(statutEntier)) anyReadExecuted = true
                // Un Write/Edit/Bash natif a AGI : le garde « annonce sans action » doit le voir.
                if (statusEstUneAction(statutEntier)) actionNativeCeTour = true
                if (ecritUnFichierDeMemoire(statutEntier)) depotMemoireCeTour = true
              }
              // Un outil direct de l'app a DEJA sa carte d'action : son battement la doublerait.
              if (estUnOutilDirectDuChat(chunk.status)) return
              // Canal SEPARE du raisonnement : un battement d'outil n'est pas une pensee.
              emit({
                kind: 'provider-status',
                text: chunk.status,
                iteration: i,
                // Le journal recopie `text` : sans cette cible entiere, il n'y garde qu'un moignon.
                ...(chunk.statusTarget ? { data: { target: chunk.statusTarget } } : {}),
                ...(chunk.statusDetail ? { detail: chunk.statusDetail } : {})
              })
              return
            }
            if (chunk.reasoning) {
              emit({ kind: 'reasoning', text: chunk.reasoning, iteration: i })
              return
            }
            if (!sawFirstChunk) {
              sawFirstChunk = true
              timer.mark(`send${i}:firstToken`) // ← fin de la latence PERÇUE
              if (!timingWritten) {
                timingWritten = true
                /*
                 * TAILLE DU PROMPT ENVOYE, a cote des jalons.
                 *
                 * Mesure du 2026-08-29 (turn-timing.jsonl, 1360 tours) : une fois le recensement git
                 * sorti du thread main (commit 2d9dea86), TOUT le reste de la latence percue vit
                 * entre `send:start` et `send:firstToken`. Le journal ne portait aucune grandeur
                 * capable d EXPLIQUER cet ecart : impossible de dire si un tour lent est un gros
                 * prompt ou un fournisseur lent. On persiste donc la taille reellement envoyee.
                 */
                timer.end({
                  provider,
                  model: binding.model,
                  promptChars: messages.reduce((n, m) => n + (m.content?.length ?? 0), 0),
                  promptMessages: messages.length
                }) // persiste les jalons du 1er token
              }
            }
            emitVisiblePrefix(visibleFilter.pushSegments(chunk.delta))
          })
          timer.mark(`send${i}:done`)
          emitVisiblePrefix(visibleFilter.finishSegments())
          successfulStreamedPrefix = attemptStreamedPrefix
          successfulAttempt = attempt
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (signal?.aborted) {
            emit({
              kind: 'cancellation',
              iteration: i,
              name: provider,
              text: 'Annulation demandée par utilisateur',
              data: { reason: signal.reason ?? 'user' }
            })
            throw error
          }
          emit({
            kind: 'prompt-call',
            iteration: i,
            prompt,
            response: '',
            status: 'failed',
            error: message,
            ...(error instanceof ProviderCallError && error.usage
              ? { callUsage: error.usage }
              : {}),
            ...(error instanceof ProviderCallError && error.resolvedModel
              ? { resolvedModel: error.resolvedModel }
              : {}),
            callDurationMs: performance.now() - callStartedAt
          })
          /*
           * SESSION EMPOISONNEE PAR UN PROMPT TROP LONG — on l'ABANDONNE au lieu de la rejouer.
           *
           * Mesure (conv-312) : une injection de 2,86 Mo a fait exploser un tour en
           * « Prompt is too long ». Le tour SUIVANT ne pesait que 65 k caracteres et echouait
           * pourtant a l'identique — parce qu'il reprenait la meme session (`--resume`), qui porte
           * encore le prompt geant cote fournisseur. La conversation devenait un CUL-DE-SAC :
           * chaque relance rejouait l'echec, aucun message ne pouvait plus y passer.
           *
           * Reprendre une session dont le contenu ne tient plus dans la fenetre est sans issue :
           * on l'oublie, et on repart a blanc avec le fil ENTIER, reconstruit par
           * `repartirSansSession` (avant conv-1040, le message ampute d'une reprise). Le cout
           * est une perte de contexte cote fournisseur, DIT au modele par le fil lui-meme —
           * infiniment moins cher qu'un fil definitivement mort.
           */
          const promptTropLong = /prompt is too long|prompt too long/i.test(message)
          if (promptTropLong && sessionEnCours) {
            repartirSansSession()
            if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
            emit({
              kind: 'retry',
              iteration: i,
              name: provider,
              text: `${message} — session du fournisseur abandonnee, nouvel essai sans reprise`,
              data: { attempt, maxAttempts: 2 }
            })
            continue
          }
          /*
           * QUOTA ÉPUISÉ EN PLEIN TOUR, APRÈS DU TEXTE AFFICHÉ (conv-1063, 2026-10-22).
           *
           * Cas réel : `run-stdout/c6ba0030-…stdout.jsonl`, 31 min et 96 blocs de texte, fini sur
           * « You've hit your session limit ». Le registre a basculé le pool sur un compte LIBRE et
           * l'a marqué sur l'erreur (`basculeApresQuota`) ; le rejeu se fait ICI, seul endroit qui
           * sait le faire proprement : texte coupé effacé, session lâchée (elle vit dans le dossier
           * du compte épuisé), fil ENTIER renvoyé. Ce qui a été fait sur disque avant la coupure
           * reste : le modèle le retrouve en relisant. Jamais vers un compte déjà tombé dans ce tour.
           */
          const bascule = basculeApresQuota(error)
          if (bascule && !comptesEpuisesCeTour.has(bascule.compteSuivant)) {
            comptesEpuisesCeTour.add(bascule.compteEpuise)
            repartirSansSession()
            if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
            attempt += 1
            emit({
              kind: 'retry',
              iteration: i,
              name: provider,
              text:
                `Quota épuisé sur le compte Claude « ${bascule.compteEpuise} » — le tour repart ` +
                `sur « ${bascule.compteSuivant} » avec tout le fil`,
              data: { attempt, maxAttempts: attempt + 1, basculeDeCompte: bascule }
            })
            continue
          }
          /*
           * REFUS DU FILTRE DE SECURITE (conv-239, tour d9a2ca62) : l'adaptateur le marque NON
           * rejouable — il est facture — et la ligne suivante abandonnait le tour. Le rejouer a
           * l'identique echouerait pareil : on suit le conseil du CLI (« in a new session or change
           * your model »), UNE fois par tour. Politique et mesure : `deciderRepliApresRefus`.
           */
          const modeleRefuse =
            options.model ?? (error instanceof ProviderCallError ? error.resolvedModel : undefined)
          const repliRefus = deciderRepliApresRefus({
            message,
            ...(modeleRefuse ? { modele: modeleRefuse } : {}),
            // Seulement au 1er appel du tour : apres, la session porte deja le travail de ce tour
            // (lectures natives comprises), et la lacher le perdrait.
            sessionHeriteeLachable:
              i === 0 && Boolean(sessionEnCours) && sessionEnCours === resumeSessionId,
            dejaTente: repliApresRefusTente
          })
          if (repliRefus) {
            repliApresRefusTente = true
            if (repliRefus.mode === 'modele') {
              modeleApresRefus = repliRefus.modele
              options.model = repliRefus.modele
            } else {
              // Le message d'une reprise est AMPUTE de l'historique (il vivait dans la session) :
              // une session neuve doit recevoir le fil entier, et l'etat entier au lieu d'un diff.
              repartirSansSession()
            }
            if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
            attempt += 1
            emit({
              kind: 'retry',
              iteration: i,
              name: provider,
              text:
                `${message.split('\n')[0]} — refus du filtre de sécurité` +
                (modeleRefuse ? ` de ${modeleRefuse}` : '') +
                (repliRefus.mode === 'modele'
                  ? `, nouvel essai sur ${repliRefus.modele}`
                  : ', nouvel essai dans une session neuve avec tout le fil'),
              data: {
                attempt,
                maxAttempts: attempt + 1,
                repliApresRefus: repliRefus.mode,
                ...(repliRefus.mode === 'modele' ? { modele: repliRefus.modele } : {})
              }
            })
            continue
          }
          if (error instanceof ProviderCallError && !error.retryable) throw error
          /*
           * UNE PANNE SERVEUR TEMPORAIRE NE DOIT PAS TUER LE TOUR (mesure du 2026-09-12).
           *
           * Sur 2 577 messages utilisateur, « reprend » est retape 61 fois ; le message qui le
           * precede est 11 fois « API Error: 529 Overloaded » et 13 fois « API Error: 500 Internal
           * server error. This is a server-side issue, usually temporary ». L'ancien plafond nu
           * (`attempt >= 1`) rejouait UNE fois, IMMEDIATEMENT : le second appel partait dans la
           * seconde, retombait sur la meme surcharge, et le backoff etait fait a la main par
           * l'utilisateur. La politique vit desormais dans un module pur teste — l'orchestrateur
           * avait deja la sienne (`transient-overload.ts`), le chat n'en avait aucune.
           *
           * Toute erreur qui n'est PAS une surcharge garde EXACTEMENT l'ancien comportement.
           */
          /*
           * fix-ok: un crash d'execution a 0 token rejoue AVEC la meme session refait le meme
           * appel — la session reprise est justement ce qui casse.
           *
           * CRASH DU CLI A 0 TOKEN SUR UNE SESSION HERITEE — on LACHE la session avant de rejouer.
           *
           * Capture fournie par l'utilisateur sur conv-625 (tour `2fbc8f95-6a5d-4fd4-821c-7af5a197303a`,
           * 2026-09-16) : un tour meurt sur « You've hit your session limit · resets 10:30pm », le
           * meme prompt renvoye ensuite meurt en « error_during_execution · 0.0000 USD », et la
           * barre de quotas affiche 94 % de restant sur le compte actif. Rien n'a ete consomme :
           * ce n'est donc pas un refus de quota, c'est la session reclamee par `--resume` qui n'est
           * plus ouvrable (laissee ouverte par le mur, ou rangee sous un autre dossier/compte).
           * Le rejeu repartait avec le MEME `resumeSessionId` et remourait a l'identique.
           *
           * On ne lache que la session HERITEE d'un tour precedent (`sessionEnCours ===
           * resumeSessionId`) : une session ouverte PAR ce tour porte les iterations deja payees,
           * l'abandonner les perdrait. Meme mecanique que « Prompt is too long » ci-dessus : le fil
           * ENTIER est reconstruit par `repartirSansSession` pour le nouvel appel.
           */
          const crashSansCout =
            error instanceof ProviderCallError &&
            error.retryable &&
            estCrashDExecutionDuCli(message)
          if (crashSansCout && sessionEnCours && sessionEnCours === resumeSessionId) {
            repartirSansSession()
          }
          const rejeu = deciderRejeuDeChat(message, attempt)
          if (!rejeu.rejouer) throw error
          if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
          attempt += 1
          emit({
            kind: 'retry',
            iteration: i,
            name: provider,
            text: rejeu.delaiMs
              ? `${message} — panne serveur temporaire, nouvel essai dans ${Math.round(rejeu.delaiMs / 1000)} s`
              : message,
            data: { attempt, maxAttempts: rejeu.maxAttempts }
          })
          // Attente ANNULABLE : un Stop pendant le backoff rend la main tout de suite.
          await dormirAnnulable(rejeu.delaiMs, signal)
          signal?.throwIfAborted()
        } finally {
          // Le port ne survit jamais a son envoi : reussite, erreur, rejeu ou arret.
          await outilsDeCetEnvoi?.arreter()
        }
      }
      emit({
        kind: 'prompt-call',
        iteration: i,
        prompt,
        // `?? ''` : un provider qui ne rend AUCUN texte ne doit pas faire planter le tour. Constate
        // le 2026-08-15 — une relance de forme supplementaire suffisait a epuiser la reponse et le
        // pilote tombait sur « Cannot read properties of undefined ». Un tour sans texte est un cas
        // METIER (le tour muet a sa garde) ; ce n'en est pas un pour l'interpreteur.
        response: (res.text ?? '').replace(REJECTED_QUESTION_RE, REJECTED_QUESTION_MARKER),
        status: 'completed',
        callUsage: res.usage,
        callDurationMs: performance.now() - callStartedAt,
        sessionId: res.sessionId,
        ...(res.model ? { resolvedModel: res.model } : {})
      })
      // Mémorise la session pour que le PROCHAIN tour la reprenne au lieu de re-payer l'historique.
      // PERSISTÉ sur disque en plus du cache mémoire : sans ça, le prochain démarrage de l'app oublie
      // la session et re-paie l'historique entier — le gain de la reprise s'évaporait à chaque
      // relance. Le cache mémoire reste la source rapide ; le disque est le filet.
      // La session avance AUSSI au sein du tour, même sans `conversationId` : l'itération suivante
      // doit reprendre celle-ci et non repartir à blanc.
      if (res.sessionId && providerResumes) {
        sessionEnCours = res.sessionId
        compteDeSession = compteDeCetEnvoi
      }
      if (conversationId) {
        if (res.sessionId && providerResumes) {
          const cle = cleDeSession(compteDeSession)
          this.chatSessions.set(conversationId, { key: cle, sessionId: res.sessionId })
          this.persistChatSession(conversationId, cle, res.sessionId)
        } else {
          // Un provider qui ne rend pas de nouvelle session ne garantit pas que ce tour appartient
          // à la précédente. La conserver ferait élider un historique qu'il n'a peut-être jamais reçu.
          this.chatSessions.delete(conversationId)
          this.forgetPersistedChatSession(conversationId)
        }
      }
      /*
       * JOURNAL DES FICHIERS : les Edit/Write natifs du modèle du chat n'y étaient jamais écrits,
       * donc l'onglet Fichiers restait vide pour un tour de chat direct. Une édition échouée
       * (`ok: false`) n'est pas tracée ; l'écriture du journal ne fait jamais échouer le tour.
       */
      if (conversationId && workspaceDuTour) {
        // Commandes shell qui NOMMENT un fichier écrit : seule preuve d'auteur d'une écriture hors
        // outil d'édition (le commit automatique du chat en dépend, voir chat-turn-publication.ts).
        await appendShellWriteTraces({
          conversationId,
          ...(turnId ? { turnId } : {}),
          workspaceRoot: workspaceDuTour,
          evidence: res.executionEvidence ?? []
        })
        const dejaTraces = new Set<string>()
        for (const item of res.executionEvidence ?? []) {
          if (!item.ok || item.kind !== 'mutation') continue
          const paths = item.path ? [item.path] : (item.paths ?? [])
          if (paths.length === 0) continue
          const lines = item.writtenLineFingerprints
          for (const p of paths) dejaTraces.add(p.replaceAll('\\', '/').toLowerCase())
          await appendWorkspaceMutationTrace({
            conversationId,
            ...(turnId ? { turnId } : {}),
            workspaceRoot: item.workspaceRoot ?? workspaceDuTour,
            source: 'chat_tool',
            paths,
            ...(lines?.length && paths.length === 1
              ? { pathLineFingerprints: { [paths[0]]: lines } }
              : {})
          })
        }
        if (etatAvantEnvoi) {
          const etatApres = await captureSaufAnnulation(workspaceDuTour, signal)
          const changes = [...(etatApres ?? [])]
            .filter(([path, empreinte]) => etatAvantEnvoi.get(path) !== empreinte)
            .map(([path]) => path)
            .filter((path) => !dejaTraces.has(path.replaceAll('\\', '/').toLowerCase()))
          if (changes.length > 0)
            await appendWorkspaceMutationTrace({
              conversationId,
              ...(turnId ? { turnId } : {}),
              workspaceRoot: workspaceDuTour,
              source: 'chat_tool',
              paths: changes,
              before: etatAvantEnvoi
            })
        }
      }
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens
        usage.outputTokens += res.usage.outputTokens
        usage.costUsd += res.usage.costUsd ?? 0
        // ECRASE, ne cumule pas : la jauge de contexte veut la DERNIERE entree, pas leur somme.
        // `res.usage.inputTokens` est le CUMUL du tour cote provider : l'ecraser ici ne le
        // desagregeait pas, la jauge restait donc collee a 100 % (conv-282, 2026-09-04). Le
        // provider expose desormais l'entree de son DERNIER appel ; repli sur le cumul si absent.
        usage.derniereEntree = res.usage.derniereEntree ?? res.usage.inputTokens
        usage.derniereEntreeCache = res.usage.derniereEntreeCache ?? res.usage.cacheReadTokens
        // Le modele SERVI, sinon aucune fenetre de contexte n'est trouvable en aval.
        if (res.model) usage.model = res.model
        usage.provider = provider
      }
      // Ecrase, comme `derniereEntree` : le detail decrit le DERNIER appel. Un appel sans mesure
      // garde celle du precedent du meme tour, dont la partie fixe est la meme.
      if (res.contexte) usage.contexte = res.contexte
      // Dernière barrière avant d'interpréter/clore la réponse : une directive arrivée pendant
      // l'appel provider invalide cette réponse devenue obsolète. On la réinjecte dans un nouvel
      // appel du MÊME tour. Entre ce drain vide et les branches synchrones ci-dessous, aucun IPC ne
      // peut s'intercaler : l'ACK immédiat reste donc sans fenêtre de perte en fin de tour.
      const lateDirectives = drainDirectives?.() ?? []
      /**
       * UNE DIRECTIVE TARDIVE NE JETTE RIEN : NI LE TEXTE, NI LES ACTIONS.
       *
       * Mesure (conv-65) : l'utilisateur repond pendant que le tour finit, et sa
       * reponse jetait la reponse ENTIERE du modele — y compris les `<cmd>` qu'elle portait. Le tour
       * contenait un `ask` : la question n'a donc JAMAIS ete posee, aucun bouton n'est apparu, et
       * l'utilisateur a vecu « quand je reponds ca marche pas ». Un `remember` du meme souffle a
       * disparu pareil. Trace : aucun `tool-call` pour ces deux commandes dans conv-65.jsonl.
       *
       * Regle : une ACTION deja decidee s'execute, la directive entrant au point d'iteration suivant.
       * Le TEXTE deja ecrit n'est pas efface non plus (conv-99, tour
       * 5ef60fbb-1b39-45c9-a173-418feb595345) : il reste affiche et il est rendu au modele ; la
       * reponse a la directive s'y AJOUTE, elle ne le remplace pas.
       *
       * Et si l'iteration portait un `ask`, cette directive EST la reponse : on ne repose pas la
       * question (elle attendrait un clic deja donne) et on ne clot pas le tour dessus.
       */
      const directivePorteLaReponse =
        lateDirectives.length > 0 &&
        parseOrderedPilotTokens(res.text ?? '').some((token) => token.kind === 'command')
      if (lateDirectives.length) {
        /*
         * LE BLOC DÉJÀ ÉCRIT N'EST PAS EFFACÉ (conv-99, tour 5ef60fbb-1b39-45c9-a173-418feb595345,
         * saisie ts 1791186255017) : une réponse complète et vérifiée était retirée de l'écran
         * (`stream-reset`) dès qu'une consigne arrivait, et le modèle ne la revoyait pas non plus.
         * Si la consigne rate, ce qu'elle a remplacé est perdu. Le texte reste affiché, il est rendu
         * au modèle comme SA réponse, et la réponse à la consigne s'ajoute après.
         */
        if (!directivePorteLaReponse) {
          const dejaEcrit = (res.text ?? '').trim()
          if (dejaEcrit) convo.push(`TOI (écrit avant la consigne ci-dessous): ${dejaEcrit}`)
        }
        for (const directive of lateDirectives) {
          convo.push(
            `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${motsUtilisateur(directive)}`
          )
        }
        if (rallongesDirectiveTardiveRestantes > 0) {
          rallongesDirectiveTardiveRestantes -= 1
          grantRecoveryIteration('late-directive')
        }
        if (!directivePorteLaReponse) continue
        reponseTardiveAUneQuestion = lateDirectives.join(' / ')
      }
      for (const artifact of res.artifacts ?? []) {
        // Deja affiche en direct a sa place chronologique : ne pas le doubler en fin de tour.
        if (artefactsDejaEmis.has(artifact.id)) continue
        artefactsDejaEmis.add(artifact.id)
        if (artifact.kind === 'video' && artifact.path)
          videosDejaMontrees.add(cleDeVideo(artifact.path))
        emit({ kind: 'artifact', artifact, iteration: i })
      }
      // La réponse NOMME une vidéo qu'elle vient d'écrire (ffmpeg dans un shell) : son lecteur suit
      // le texte, comme une image lue. Voir `videos-livrees.ts`.
      for (const artifact of await videosLivreesDuTour(
        res.text ?? '',
        workspaceDuTour,
        debutDuTourMs,
        videosDejaMontrees
      )) {
        if (artefactsDejaEmis.has(artifact.id)) continue
        artefactsDejaEmis.add(artifact.id)
        emit({ kind: 'artifact', artifact, iteration: i })
      }
      if (conversationId && res.tachesDeFondARelancer?.length)
        emit({ kind: 'taches-de-fond', iteration: i, data: res.tachesDeFondARelancer })
      /**
       * Le texte du provider, NORMALISE une fois pour toutes.
       *
       * Un provider peut ne rien rendre — et le tour ne doit pas PLANTER pour autant. Constate le
       * 2026-08-15 : une relance de forme supplementaire epuisait la reponse d'un test, et le pilote
       * tombait successivement sur `.replace`, puis `.slice`, d'un `undefined`. Rustiner chaque usage
       * aurait laisse le suivant exploser ; on assainit donc a la SOURCE. L'absence de texte reste un
       * cas METIER, traite par la garde du tour muet, pas une panne d'interpreteur.
       */
      const texteProvider = res.text ?? ''
      const rejectedQuestion = /<question>/i.test(texteProvider)
      const text = texteProvider.replace(REJECTED_QUESTION_RE, REJECTED_QUESTION_MARKER).trim()
      const question = parseModelQuestion(text)
      if (question && ask) {
        const answer = await waitForAnswer(ask(question), signal)
        convo.push(`TOI: ${text}`)
        convo.push(`UTILISATEUR: ${motsUtilisateur(answer)}`)
        continue
      }
      if (!question && rejectedQuestion) {
        convo.push(`TOI: ${REJECTED_QUESTION_MARKER}`)
        convo.push(
          'SYSTÈME: question refusée — aucun motif de blocage autorisé et vérifiable. ' +
            'Continue de façon autonome avec une hypothèse raisonnable, sans solliciter l’utilisateur.'
        )
        if (invalidQuestionRecoveryAvailable) {
          grantRecoveryIteration('invalid-question')
          invalidQuestionRecoveryAvailable = false
          continue
        }
        // JAMAIS de bulle vide : une question refusee + reprises epuisees laissait l'utilisateur
        // devant un message VIDE, sans savoir ce qui s'etait passe (vu sur conv-1141).
        emit({
          kind: 'done',
          text:
            'Je n’ai pas pu poser de question recevable et j’ai epuise les reprises — ' +
            'je m’arrete sans solliciter l’utilisateur.',
          usage
        })
        return
      }

      if (texteProvider.includes('<cmd>')) cmdEmisCeTour = true
      const ordered = parseOrderedPilotTokens(texteProvider)
      const hasCommand = ordered.some((token) => token.kind === 'command')
      const spoken = ordered
        .filter(
          (token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text'
        )
        .map((token) =>
          hasCommand ? retirerConclusionBloquantePrematuree(token.text) : token.text
        )
        .filter(Boolean)
        .join('')
        .trim()
      if (spoken) anySpokenText = true
      if (spoken) visibleTextThisTurn = spoken
      const prefixeStreameVisible = hasCommand
        ? retirerConclusionBloquantePrematuree(successfulStreamedPrefix)
        : successfulStreamedPrefix
      if (successfulStreamedPrefix && prefixeStreameVisible !== successfulStreamedPrefix) {
        emit({ kind: 'stream-reset', streamId: `${i}:${successfulAttempt}`, iteration: i })
        successfulStreamedPrefix = ''
      }
      const onlyAuxiliaryRemember =
        hasCommand &&
        Boolean(spoken) &&
        ordered.every(
          (token) =>
            token.kind === 'text' || (token.kind === 'command' && token.name === 'remember')
        )

      // Defense en profondeur : le profil provider retire deja les outils d'ecriture, mais une
      // balise de commande peut encore apparaitre comme simple texte genere. Dans un tour declare
      // lecture-seule, seule une commande de LECTURE (readOnlyHint du catalogue) atteint le bus :
      // les commandes mutantes n'y arrivent JAMAIS, meme si le modele ignore son system prompt.
      // (Avant read_file/find_in_files, TOUT etait bloque — une analyse ne pouvait alors rien lire,
      // mesure sur 4 runs reels du scout de veille, conv-1154→1157.)
      const nomsLectureSeule = new Set(catalogueLectureSeule.map((commande) => commande.name))
      const commandeMutante = ordered.some(
        (token) => token.kind === 'command' && !nomsLectureSeule.has(token.name)
      )
      if (commandFreeReadOnly && commandeMutante) {
        emit({
          kind: 'done',
          text:
            spoken ||
            'Reponse bloquee : le modele a tente une commande mutante pendant un tour en lecture seule.',
          usage
        })
        return
      }
      // Le triage Watchdog reste, lui, INTEGRALEMENT sans commandes : son pilote refuse tout exec.
      if (watchdogReadOnly && hasCommand) {
        emit({
          kind: 'done',
          text:
            spoken ||
            'Reponse bloquee : le modele a tente une commande pendant un tour en lecture seule.',
          usage
        })
        return
      }

      if (!hasCommand) {
        if (!successfulStreamedPrefix && spoken) {
          // L'iteration est portee par l'evenement : le fil en fait le flux `fallback:<i>`, et
          // la relance peut l'effacer sans toucher au texte des iterations precedentes.
          fluxAffichesCetteIteration.add(`fallback:${i}`)
          emit({ kind: 'think', text: spoken, iteration: i })
        } else if (successfulStreamedPrefix) {
          const visible = ordered
            .filter(
              (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                token.kind === 'text'
            )
            .map((token) => token.text)
            .join('')
          const { visible: remainder } = consumeStreamedPrefix(visible, successfulStreamedPrefix)
          if (remainder) fluxAffichesCetteIteration.add(`${i}:${successfulAttempt}:remainder`)
          if (remainder)
            emit({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:remainder`,
              text: remainder,
              iteration: i
            })
        }
        /*
         * TOUR PARASITE : un `<cmd>` casse, zero commande valide (voir la declaration de
         * `commandeIllisibleRecoveryAvailable`). On SIGNALE l'echec dans le fil, on le REINJECTE, et
         * on rend la main aux commandes — c'est la seule issue qui evite de faire retaper « go ».
         */
        const blocsIllisibles = ordered.filter(
          (token): token is Extract<OrderedPilotToken, { kind: 'invalid' }> =>
            token.kind === 'invalid'
        )
        if (blocsIllisibles.length) {
          // Le bloc BRUT a deja ete diffuse en direct : sans token `command` survivant,
          // `hasCommand` est faux et rien ne le retirait. Vecu le 2026-09-01 (conv-46) : du JSON
          // entier affiche en plein fil. On efface le diffuse et on republie le SEUL texte parle.
          if (successfulStreamedPrefix) {
            emit({ kind: 'stream-reset', streamId: `${i}:${successfulAttempt}`, iteration: i })
            successfulStreamedPrefix = ''
            const texteParle = ordered
              .filter(
                (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                  token.kind === 'text'
              )
              .map((token) => token.text)
              .join('')
              .trim()
            if (texteParle) {
              fluxAffichesCetteIteration.add(`${i}:${successfulAttempt}:sans-bloc`)
              emit({
                kind: 'delta',
                streamId: `${i}:${successfulAttempt}:sans-bloc`,
                text: texteParle,
                iteration: i
              })
              successfulStreamedPrefix = texteParle
            }
          }
          // CHAQUE bloc casse est signale, y compris le deuxieme du meme tour : le credit borne ne
          // doit brider que la RELANCE, jamais l'avertissement. Sinon le second disparait sans un mot.
          let indexSignale = 0
          for (const bloc of blocsIllisibles) {
            const actionId = `${i}:illisible-vu:${indexSignale++}`
            emit({ kind: 'command', actionId, name: 'commande illisible', args: {} })
            emit({
              kind: 'result',
              actionId,
              name: 'commande illisible',
              ok: false,
              data: `${bloc.reason} — aucune action n'a été exécutée`
            })
          }
        }
        if (blocsIllisibles.length && commandeIllisibleRecoveryAvailable) {
          commandeIllisibleRecoveryAvailable = false
          grantRecoveryIteration('commande-illisible')
          convo.push(`TOI: ${texteProvider}`)
          convo.push(
            'SYSTÈME: ton bloc <cmd> est INEXPLOITABLE (' +
              blocsIllisibles.map((bloc) => bloc.reason).join(' ; ') +
              ') — AUCUNE action n’a été exécutée, la demande n’est donc PAS satisfaite, malgré ce ' +
              'que ton texte annonce. Vérifie que le JSON est COMPLET (accolades équilibrées, ' +
              'guillemets échappés) et RÉ-ÉMETS MAINTENANT la commande au format exact ' +
              '<cmd>{"name":"...","args":{...}}</cmd>. N’annonce rien : agis.'
          )
          continue
        }
        // Le tour a AGI mais n'a rien dit : on redemande la conclusion plutot que de livrer des
        // etiquettes nues. Borne a une relance pour ne jamais boucler.
        if (!anySpokenText && anyActionExecuted && conclusionRecoveryAvailable) {
          relanceDeFormeUtilisee = true
          conclusionRecoveryAvailable = false
          grantRecoveryIteration('muted-turn')
          convo.push(
            'SYSTÈME: tu as agi mais tu n’as rien dit — l’utilisateur ne voit que des étiquettes ' +
              'd’action, il ne peut pas savoir ce qui a été fait. Conclus MAINTENANT en clair, SANS ' +
              'aucune commande : ce que tu as fait, ce que cela a produit (résultats/exit codes ' +
              'observés), et ce qui reste. Si une action a échoué, dis-le explicitement.'
          )
          continue
        }
        /**
         * UN CHIFFRE DONNE SANS AVOIR RIEN LU — le symetrique du tour muet, et aussi trompeur.
         *
         * MESURE en pilotant l'app le 2026-08-15, sur deux series de 10 sondes a verite terrain :
         * 19 reussites sur 20, et l'UNIQUE echec repond en 3 secondes — trop vite pour avoir liste
         * quoi que ce soit. La question identique avait reussi en 8 s dans la meme serie : ce n'est
         * donc pas une capacite manquante mais une VARIANCE, l'agent devinant au lieu d'appeler.
         *
         * Le prompt l'interdit deja en toutes lettres (« RÈGLE ABSOLUE — si la question demande un
         * NOMBRE… tu appelles une commande de lecture AVANT de repondre »). Il a quand meme devine.
         * Ce depot connait la lecon, elle est ecrite au-dessus pour le tour muet : un correctif
         * DECLARATIF ne garantit rien, seule une relance MECANIQUE tient.
         *
         * Bornee a une fois, comme sa jumelle, et strictement additive : elle ne peut que demander
         * une verification, jamais modifier une reponse deja verifiee.
         */
        /**
         * PAS DE CONCLUSION — le tour a agi, mais l'utilisateur ne lit ni ce qui a ete fait, ni la
         * suite. MESURE le 2026-08-15 : 39 conversations de sonde sur 39 finissaient ainsi.
         * Verdict de l'utilisateur : « toutes tes sondes sont des echecs ». Bornee a une relance,
         * comme ses jumelles, et armee seulement si le tour a REELLEMENT agi.
         */
        /**
         * UNE ACTION A ECHOUE ET LA REPONSE N'EN DIT RIEN. Trouve dans `conv-1178` : dernier
         * `edit_file` en `ok:false`, et le texte lu se termine par « ✅ Fait ». Un bloc de cloture
         * rendu obligatoire sans exigence d'honnetete produit un faux vert qui RASSURE.
         */
        /**
         * IL PARLE SANS AGIR — miroir du tour muet, decouvert le 2026-08-15.
         *
         * Demande : « ranges moi mes conversations dans des sous categories adequates ». Reponse
         * recue, marquee `completed` : « Je vais d'abord identifier… », « Je cible maintenant… »,
         * et ZERO action. Rien n'a ete range. Les cinq gardes precedentes exigent toutes
         * `anyActionExecuted` : aucune ne pouvait voir un tour qui n'agit pas du tout.
         */
        /*
         * L'AGENT DIT NE PAS AVOIR UN OUTIL QU'IL A.
         *
         * Mesure du 20/08 sur une conversation reelle : « `edit_file` n'existe pas dans le catalogue
         * reellement disponible de cette session », puis huit tours a reclamer des droits shell dont
         * il n'avait pas besoin, 13,15 $, zero ligne ecrite. `directReadOnly` vaut `false` en dur :
         * un tour pilote par l'utilisateur recoit TOUJOURS le catalogue complet.
         *
         * C'est la plus falsifiable des trois relances de cette famille — le catalogue est connu du
         * code qui vient de l'envoyer — donc elle passe la premiere.
         */
        if (!relanceDeFormeUtilisee && outilAbsentRecoveryAvailable) {
          const faussementAbsents = outilsFaussementAbsents(
            visibleTextThisTurn,
            catalog.map((commande) => commande.name)
          )
          if (faussementAbsents.length) {
            outilAbsentRecoveryAvailable = false
            relanceDeFormeUtilisee = true
            grantRecoveryIteration('outil-pretendu-absent')
            convo.push(correctionOutilsPresents(faussementAbsents))
            continue
          }
          /*
           * DEUXIEME FORME : l'agent ne nie aucun outil, il nie l'ACCES a une conversation. Mesure du
           * 21/08 : « Le scout n'existe dans mon contexte qu'a travers le tableau du frame », alors
           * que `conversation_read` etait la et que sa description interdit deja cette reponse, mot
           * pour mot. Meme verrou : une seule relance de forme par tour.
           */
          const conversationLisible = conversationPretendueInaccessible(
            visibleTextThisTurn,
            catalog.map((commande) => commande.name)
          )
          if (conversationLisible) {
            outilAbsentRecoveryAvailable = false
            relanceDeFormeUtilisee = true
            grantRecoveryIteration('outil-pretendu-absent')
            convo.push(correctionConversationLisible(conversationLisible))
            continue
          }
        }
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          annonceSansActionRecoveryAvailable &&
          exigeAgirPasAnnoncer(
            latestUserMessage,
            visibleTextThisTurn,
            anyActionExecuted || actionNativeCeTour
          )
        ) {
          annonceSansActionRecoveryAvailable = false
          relanceDeFormeUtilisee = true
          grantRecoveryIteration('annonce-sans-action')
          convo.push(
            'SYSTÈME: tu as ANNONCÉ ce que tu allais faire, sans rien faire — aucune commande n’a ' +
              'été exécutée, donc la demande n’est PAS satisfaite. AGIS maintenant : émets les ' +
              'commandes nécessaires, puis rends compte de ce qu’elles ont réellement produit. Si ' +
              'tu ne peux pas agir, dis-le explicitement et pourquoi — ne décris jamais un plan au ' +
              'futur comme s’il tenait lieu de résultat.'
          )
          continue
        }
        /*
         * CORRIGE, PUIS POURSUIS — passe AVANT l'aveu d'echec, et c'est deliberé.
         *
         * `exigeDireLEchec` obtient un constat honnete mais ordonne de reformuler « SANS aucune
         * commande » : elle FIGE le tour sur son echec. Celle-ci est la seule relance de la famille
         * qui REND la main aux commandes — l'agent repart de l'erreur reelle, la corrige, et termine
         * la tache. Si la reprise echoue a son tour, l'aveu d'echec reste en second rideau.
         */
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          reprisesApresEchecRestantes > 0 &&
          exigeCorrigerEtPoursuivre(
            echecDeLaDerniereIteration || commandesEnEchecNonRattrape.size > 0,
            visibleTextThisTurn
          )
        ) {
          reprisesApresEchecRestantes -= 1
          /*
           * Le depot impose « UNE SEULE relance de forme par tour, toutes gardes confondues ». La
           * reprise d'ACTION en est une exception ASSUMEE : elle rend la main aux commandes, ce
           * qu'aucune relance de forme ne fait, et la brider reviendrait a re-figer le tour sur son
           * echec — le defaut d'origine. L'ESCALADE, elle, signifie « tu tournes en rond » : a ce
           * stade plus rien ne doit se debloquer derriere, sinon on empile des appels payants sur un
           * tour deja en difficulte (audit du 2026-08-21).
           */
          if (dernierEchecEstUnRejeu) relanceDeFormeUtilisee = true
          grantRecoveryIteration('correction-apres-echec')
          convo.push(
            consigneApresEchec(
              dernierEchecEstUnRejeu ? [derniereSignatureDEchec] : [],
              derniereSignatureDEchec
            )
          )
          continue
        }
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          echecTuRecoveryAvailable &&
          exigeDireLEchec(anyActionFailed, visibleTextThisTurn)
        ) {
          relanceDeFormeUtilisee = true
          echecTuRecoveryAvailable = false
          grantRecoveryIteration('echec-taise')
          // D2 : la reponse reformulee REMPLACE celle qui taisait l'echec (fluxAffichesCetteIteration).
          effacerReponseRelancee()
          convo.push(
            'SYSTÈME: au moins une de tes actions a ÉCHOUÉ et ta réponse n’en dit rien. Reformule ' +
              'MAINTENANT, SANS aucune commande : dis EXPLICITEMENT laquelle a échoué et ce que ' +
              'cela empêche. N’écris « Fait » que pour ce qui a RÉELLEMENT abouti — un « ✅ Fait » ' +
              'posé sur un échec est pire que pas de conclusion du tout, parce qu’il rassure à tort. ' +
              'Ta nouvelle réponse REMPLACE la précédente à l’écran : écris-la en entier.'
          )
          continue
        }
        // Geste d'écran rendu à l'utilisateur alors que le bureau était piloté (tour c4e319ca).
        // fix-ok: ne dépend PAS de relanceDeFormeUtilisee — dans le tour c4e319ca la relance
        // « échec tu » part d'abord et éteignait cette garde ; son propre drapeau la borne à 1.
        if (
          exigerExperienceSoignee &&
          gesteRenduRecoveryAvailable &&
          exigeFaireLeGeste(visibleTextThisTurn, bureauUtilise)
        ) {
          gesteRenduRecoveryAvailable = false
          relanceDeFormeUtilisee = true
          grantRecoveryIteration('geste-rendu')
          convo.push(RELANCE_FAIRE_LE_GESTE)
          continue
        }
        /*
         * LA PROMESSE DE COMPTE-RENDU — passe AVANT le bloc visuel, et c'est deliberé : elle porte
         * un TRAVAIL potentiellement perdu (run non recolté), l'autre ne porte qu'un rendu cassé.
         */
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          preuvePromiseRecoveryAvailable &&
          exigePreuveAvantDePromettre(visibleTextThisTurn, anyActionExecuted)
        ) {
          preuvePromiseRecoveryAvailable = false
          relanceDeFormeUtilisee = true
          grantRecoveryIteration('preuve-promise')
          // D2 : le compte-rendu REMPLACE la promesse — sinon elle reste affichee, dementie juste dessous.
          effacerReponseRelancee()
          convo.push(RELANCE_PREUVE_AVANT_DE_PROMETTRE)
          continue
        }
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          blocVisuelRecoveryAvailable &&
          blocVisuelNonFerme(visibleTextThisTurn)
        ) {
          blocVisuelRecoveryAvailable = false
          relanceDeFormeUtilisee = true
          grantRecoveryIteration('bloc-visuel-non-ferme')
          // D2 : le bloc re-emis REMPLACE le bloc casse, affiche en code brut jusque-la.
          effacerReponseRelancee()
          convo.push(RELANCE_BLOC_VISUEL_NON_FERME)
          continue
        }
        if (
          exigerExperienceSoignee &&
          !relanceDeFormeUtilisee &&
          conclusionFormatRecoveryAvailable &&
          exigeUneConclusion(anyActionExecuted, visibleTextThisTurn)
        ) {
          relanceDeFormeUtilisee = true
          conclusionFormatRecoveryAvailable = false
          grantRecoveryIteration('conclusion-absente')
          // D2 : la reponse reformulee REMPLACE celle-ci dans le fil (voir fluxAffichesCetteIteration).
          effacerReponseRelancee()
          convo.push(RELANCE_CONCLUSION_ABSENTE)
          continue
        }
        if (
          questionSansLectureRecoveryAvailable &&
          questionPoseeSansAvoirLu(questionPoseeCeTour, anyReadExecuted)
        ) {
          questionSansLectureRecoveryAvailable = false
          grantRecoveryIteration('question-sans-lecture')
          convo.push(RELANCE_QUESTION_SANS_LECTURE)
          continue
        }
        if (
          chiffreNonVerifieRecoveryAvailable &&
          exigeUnChiffreVerifie(
            latestUserMessage,
            visibleTextThisTurn,
            anyReadExecuted || sortieDeCommandeObservee,
            // conv-335 : une réponse recollée dans son message n'est pas SA demande de compte.
            history
              .filter((message) => message.role === 'assistant')
              .map((message) => message.content)
          )
        ) {
          chiffreNonVerifieRecoveryAvailable = false
          grantRecoveryIteration('chiffre-non-verifie')
          // D2 : la reponse verifiee REMPLACE celle-ci dans le fil — d'ou la consigne de la redonner
          // EN ENTIER (« corrige-toi » supposait une premiere reponse restee affichee).
          effacerReponseRelancee()
          convo.push(RELANCE_CHIFFRE_NON_VERIFIE)
          continue
        }
        // JAMAIS de bulle vide. Cause racine des « conversations qui echouent » (conv-1141) :
        // le tour a AGI (« [a execute exec (echec)] ») mais n'a rien DIT, la reprise de conclusion
        // etait deja consommee, et `spoken` vide produisait une bulle VIDE — l'utilisateur renvoyait
        // alors le meme prompt en boucle sans jamais savoir ce qui ratait.
        emit({
          kind: 'done',
          // Un tour MUET apres une orchestration retombe sur son compte-rendu, jamais sur du vide :
          // le resultat est paye, il doit s'afficher meme si le modele n'a rien redige.
          text: spoken.trim()
            ? texteDeCloture(spoken)
            : (compteRenduOrchestration ?? texteDeCloture(spoken)),
          ...(orchestrationOutcome ? { outcome: orchestrationOutcome } : {}),
          usage
        })
        return
      }

      const results: string[] = []
      // Remis a plat a chaque iteration — mais sur ce que les OUTILS DIRECTS de cette iteration ont
      // deja constate pendant l'envoi : les effacer ici ferait taire leur echec (faux sans eux).
      echecDeLaDerniereIteration = echecNatifCetteIteration
      // Remis a plat a chaque iteration, comme son jumeau : sinon un rejeu d'une iteration
      // precedente ferait escalader une iteration qui n'a rencontre qu'un mur neuf.
      dernierEchecEstUnRejeu = rejeuNatifCetteIteration
      let commandIndex = 0
      let tokenIndex = 0
      let streamedPrefixRemaining = successfulStreamedPrefix
      for (const token of ordered) {
        signal?.throwIfAborted()
        if (token.kind === 'text') {
          const texteVisible = retirerConclusionBloquantePrematuree(token.text)
          if (!texteVisible) {
            tokenIndex += 1
            continue
          }
          const consumed = consumeStreamedPrefix(texteVisible, streamedPrefixRemaining)
          const visible = consumed.visible
          streamedPrefixRemaining = consumed.prefixRemaining
          if (visible)
            fluxAffichesCetteIteration.add(`${i}:${successfulAttempt}:ordered:${tokenIndex}`)
          if (visible)
            emit({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:ordered:${tokenIndex}`,
              text: visible,
              iteration: i
            })
          tokenIndex += 1
          continue
        }

        if (token.kind === 'invalid') {
          /**
           * Bloc `<cmd>` inexploitable. Avant, il disparaissait sans trace : le modele croyait avoir
           * agi, l'utilisateur lisait une conclusion, et rien ne s'etait produit. Desormais l'echec
           * est (a) VISIBLE dans le fil et (b) REINJECTE au modele pour qu'il corrige au tour
           * suivant. Aucune action n'est inventee : on signale, on ne devine pas l'intention.
           */
          const actionId = `${i}:${commandIndex++}`
          emit({ kind: 'command', actionId, name: 'commande illisible', args: {} })
          emit({
            kind: 'result',
            actionId,
            name: 'commande illisible',
            ok: false,
            data: `${token.reason} — aucune action n'a été exécutée`
          })
          results.push(
            `COMMANDE ILLISIBLE (${token.reason}) — AUCUNE action executee. Bloc recu : ` +
              `${token.raw.slice(0, 300)}. Re-emets une commande VALIDE au format exact ` +
              `<cmd>{"name":"...","args":{...}}</cmd>, ou reponds sans commande.`
          )
          tokenIndex += 1
          continue
        }

        if (executesParCanalNatif.has(cleAppelNatif(token.name, token.args))) {
          // DEJA EXECUTEE par l'outil direct pendant cette reponse (meme nom, memes arguments) : le
          // modele l'a appelee ET recopiee en texte. On ne la rejoue pas, et on le dit.
          emit({
            kind: 'provider-status',
            iteration: i,
            text: `${token.name} : déjà exécutée par l'outil direct dans cette réponse, non rejouée`
          })
          results.push(
            `${token.name} → déjà exécutée par l'outil direct dans cette réponse : non rejouée ` +
              '(son résultat t’a déjà été rendu).'
          )
          tokenIndex += 1
          continue
        }
        const actionId = `${i}:${commandIndex++}`
        anyActionExecuted = true
        if (token.name === 'desktop_act' || token.name === 'desktop_observe') bureauUtilise = true
        // Les commandes qui OBSERVENT reellement le disque. `get_state` n'en est pas : c'est
        // l'apercu partiel dont l'agent tirait justement ses chiffres faux.
        if (
          token.name === 'list_files' ||
          token.name === 'read_file' ||
          token.name === 'find_in_files'
        )
          anyReadExecuted = true
        if (token.name === 'ask' && reponseTardiveAUneQuestion !== undefined) {
          // L'utilisateur a REPONDU avant que la question ne parte : la reposer afficherait des
          // boutons pour un choix deja fait.
          emit({ kind: 'command', actionId, name: token.name, args: token.args })
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: true,
            data: `Question non reposée — l’utilisateur a déjà répondu : ${reponseTardiveAUneQuestion}`
          })
          results.push(
            `ask → l’utilisateur a DÉJÀ répondu pendant ce tour : « ${reponseTardiveAUneQuestion} ». ` +
              'Ne repose pas la question, traite cette réponse.'
          )
          tokenIndex += 1
          continue
        }
        if (token.name === 'ask' && questionPoseeCeTour) {
          // UNE SEULE QUESTION PAR TOUR. conv-844, turn 852bb2fd-25e4-40dd-a959-57d9337b084c : la
          // relance « question sans lecture » a fait reposer la meme question -> 2 cartes a l'ecran.
          // La premiere est deja affichee : la seconde n'est pas emise.
          results.push('ask → une question est DÉJÀ affichée dans ce tour : ne la repose pas.')
          tokenIndex += 1
          continue
        }
        if (
          token.name === 'ask' &&
          draftChoixParBoutons &&
          askFaitChoisirUneProposition(token.args)
        ) {
          // /draft : LE CHOIX SE FAIT PAR LES BOUTONS DU BLOC. Tours 938a67c1-78bc-4bc5-addf-865167663f44
          // (conv-312) et c7d72274-db73-49bd-93fe-435f6647863a (conv-310) : `ask` sans aucun bloc de
          // choix, malgre la procedure. La question n'est pas affichee et le tour continue : le
          // modele recoit l'ordre de poser le carrousel (draft-choix-par-boutons.ts).
          emit({ kind: 'provider-status', iteration: i, text: STATUT_REFUS_ASK_DRAFT })
          results.push(REFUS_ASK_DRAFT)
          tokenIndex += 1
          continue
        }
        if (token.name === 'ask') questionPoseeCeTour = true
        const settledAction = recoveredHere?.settledActions?.find(
          (action) => action.actionId === actionId && action.name === token.name
        )
        if (
          token.name === 'orchestrate' &&
          !settledAction &&
          !orchestrationIssued &&
          !questionPoseeCeTour
        ) {
          // Le run n'est PAS lancé : la question remplace l'orchestration (deux-lectures.ts).
          const issueAvantRun = await deuxLecturesDuTour()
          // Une lecture domine : le run part, mais sur ELLE (`rootTask` ci-dessous), et le fil la
          // nomme (conv-1123).
          if (issueAvantRun?.kind === 'retenue') annoncerLaLectureRetenue(issueAvantRun)
          if (issueAvantRun?.kind === 'question') {
            await poserLaQuestionDesLectures(actionId, issueAvantRun.lectures)
            questionPoseeCeTour = true
            questionDesLecturesPosee = true
            results.push(
              'orchestrate → NON LANCÉ : la demande a deux lectures plausibles, la question est ' +
                'posée à l’utilisateur. Ne relance rien dans ce tour.'
            )
            tokenIndex += 1
            continue
          }
        }
        if (!settledAction)
          emit({
            kind: 'command',
            actionId,
            name: token.name,
            args: token.args,
            ...(token.reparation ? { reparation: token.reparation } : {})
          })
        if (token.name === 'orchestrate' && orchestrationIssued) {
          const refusal = ORCHESTRATION_ALREADY_ISSUED_REFUSAL
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: false,
            data: refusal
          })
          results.push(`${token.name} → ERREUR ${refusal}`)
          tokenIndex += 1
          continue
        }
        if (token.name === 'orchestrate') orchestrationIssued = true
        signal?.throwIfAborted()
        // `rootTask` est l'autorité du run (commands.ts) : la lecture annoncée y est jointe, sinon le
        // run relirait la demande brute et pourrait faire l'autre lecture (conv-1123).
        const authoritativeArgs =
          token.name === 'orchestrate' && latestUserMessage
            ? {
                ...token.args,
                rootTask: lectureRetenue
                  ? tacheAvecLectureRetenue(
                      latestUserMessage,
                      lectureRetenue.retenue,
                      lectureRetenue.ecartee
                    )
                  : latestUserMessage
              }
            : token.args
        const r: CommandResult = settledAction
          ? settledAction.ok
            ? {
                ok: true,
                data: settledAction.data,
                ...(settledAction.attachments?.length
                  ? { attachments: settledAction.attachments }
                  : {})
              }
            : {
                ok: false,
                error: String(settledAction.data ?? 'échec déjà journalisé'),
                ...(settledAction.attachments?.length
                  ? { attachments: settledAction.attachments }
                  : {})
              }
          : await execCommandTolerante(token.name, authoritativeArgs, (text) =>
              emit({ kind: 'action-progress', actionId, text })
            )
        if (r.attachments?.length) commandAttachments.push(...r.attachments)
        /*
         * LA CAPTURE QUI SERT A VALIDER EST MONTREE (conv-1450).
         *
         * `attachments` alimentait uniquement le prochain prompt du modele : l'utilisateur ne voyait
         * jamais l'image sur laquelle reposait le verdict « c'est bon ». On la republie donc comme
         * ARTEFACT, seul canal deja rendu et persiste par le fil. Restreint aux IMAGES : un log ou un
         * payload texte n'est pas une preuve visuelle et n'a rien a faire en apercu.
         */
        for (const piece of r.attachments ?? []) {
          if (piece.kind !== 'image' || !piece.content) continue
          emit({
            kind: 'artifact',
            iteration: i,
            artifact: {
              id: `tool-capture-${actionId}-${commandAttachments.length}-${piece.name}`,
              name: piece.name,
              mimeType: piece.mimeType,
              kind: 'image',
              size: piece.size,
              createdAt: Date.now(),
              encoding: 'base64',
              content: piece.content,
              source: { provider, tool: token.name }
            }
          })
        }
        /*
         * CARTES DU FIL RENDUES PAR UNE COMMANDE (`show_video`, conv-253). Champ distinct
         * d'`attachments` : elles s'affichent dans le fil et ne partent JAMAIS au modèle IA — une
         * vidéo dans `commandAttachments` serait envoyée au prochain appel.
         */
        for (const artifact of r.artifacts ?? []) {
          if (artefactsDejaEmis.has(artifact.id)) continue
          artefactsDejaEmis.add(artifact.id)
          if (artifact.kind === 'video' && artifact.path)
            videosDejaMontrees.add(cleDeVideo(artifact.path))
          emit({ kind: 'artifact', iteration: i, artifact })
        }
        // Meme clef que la comptabilite d'echec plus bas (nom + cible), calculee ici parce que le
        // resultat est emis AVANT le bloc qui la tient : c'est le seul endroit ou l'on sait encore
        // quel echec cette reussite repare.
        const cleDeCetteAction = cleDEchec(token.name, authoritativeArgs as Record<string, unknown>)
        const echecRattrape = commandResultSucceeded(r)
          ? actionIdParEchec.get(cleDeCetteAction)
          : undefined
        if (!settledAction)
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: commandResultSucceeded(r),
            data: r.ok ? r.data : r.error,
            ...(echecRattrape ? { retryOf: echecRattrape } : {}),
            ...(r.attachments?.length ? { attachments: r.attachments } : {})
          })
        // `orchestrate` rend déjà l'issue AUTORITATIVE du pipeline complet : build, juge, gate,
        // publication et fermeture du RUN. Redemander au modèle de l'interpréter coûtait un appel
        // supplémentaire et, pire, lui faisait parfois suivre le rapport PROVISOIRE du worker
        // (« RUN open, lance judge ») alors que le gate venait de fermer et publier le run. On clôt
        // donc mécaniquement le tour sur le résultat structuré, comme le chemin `/skill` explicite.
        if (token.name === 'orchestrate') {
          const outcome = r.ok
            ? (r.data as OrchestrationOutcome | undefined)
            : failedOrchestrationOutcome(r.error)
          const deliveryClosed = r.ok && isDeliveredOrchestrationOutcome(outcome ?? {})
          /*
           * UN REFUS TRANSITOIRE NE CONSOMME PAS LE VERROU DU TOUR (mesure conv-489, 2026-09-12).
           *
           * `orchestrationIssued` est pose AVANT l'execution, inconditionnellement : il protege
           * d'une SECONDE orchestration payante dans le meme tour. Mais « Reprise refusee : N
           * appel(s) provider encore actif(s) » est jete AVANT tout appel provider — rien n'a
           * demarre, rien n'a coute. Le verrou restait pourtant pose : l'agent lisait « je ne peux
           * pas relancer dans ce tour », rendait la main sans rien livrer, et l'utilisateur payait
           * un tour entier pour zero ligne de code puis devait relancer a la main. Le refus dit
           * lui-meme « la suite correcte est de relancer la MEME demande » : on lui en rend le
           * droit, dans ce tour-ci. Le garde-fou anti-double-depense reste intact pour tous les
           * autres cas, y compris les echecs definitifs.
           */
          if (
            !r.ok &&
            refusDeRepriseEstTransitoire(classifierRefusDeReprise(String(r.error ?? '')))
          ) {
            orchestrationIssued = false
          }
          /*
           * LA COMPTABILITE D'ECHEC EST TENUE MEME ICI, avant le retour anticipe.
           *
           * La cloture mecanique du tour sur l'issue structuree est DELIBEREE (voir juste au-dessus) et
           * n'est pas remise en cause : l'echec est bel et bien DIT a l'utilisateur par
           * `formatOrchestrationOutcome` (« Echec du workflow », « ARRETE au controle final », « la
           * livraison n'est pas prouvee »), et la REPARATION d'une orchestration appartient a la
           * boucle de l'orchestrateur, pas au tour de chat.
           *
           * Mais sauter ce bloc laissait `anyActionFailed` a false sur l'echec le plus couteux de
           * l'application. Aujourd'hui c'est inerte — on retourne juste apres. Demain, toute garde
           * ajoutee en aval raterait silencieusement les orchestrations plantees. Signale par un juge
           * externe le 2026-08-22 ; on tient la comptabilite juste plutot que de laisser un piege.
           */
          /*
           * LA COMPTABILITE LIT SON PROPRE PREDICAT, pas celui de l'affichage.
           *
           * Regression trouvee au cycle 2 de l'audit du 2026-08-26 : `isDeliveredOrchestrationOutcome`
           * avait ete resserre pour que l'UI cesse d'ecrire « ✅ Workflow terminé » sur un travail
           * reste dans sa copie isolee. Effet de bord non trace : un run VERT en `publication: 'hold'`
           * tombait ici comme un ECHEC et armait `exigeCorrigerEtPoursuivre` — l'agent repartait
           * reparer ce qui n'avait pas casse, sur le chemin le plus courant du travail retenu.
           */
          if (orchestrationEnEchec(outcome ?? {})) {
            anyActionFailed = true
            echecDeLaDerniereIteration = true
            const cleOrchestration = cleDEchec(
              token.name,
              authoritativeArgs as Record<string, unknown>
            )
            commandesEnEchecNonRattrape.add(cleOrchestration)
            actionIdParEchec.set(cleOrchestration, actionId)
          }
          const closureNotice = deliveryClosed
            ? 'Clôture Autowin : gate validé, RUN fermé green ; aucune autre orchestration ni aucun second judge ne sont nécessaires dans ce tour.'
            : 'Clôture Autowin : résultat terminal rendu ; aucune autre orchestration n’est relancée dans ce tour.'
          /*
           * LE MODELE REPREND LA PAROLE — decision utilisateur du 2026-08-27, et le contraire de ce
           * que ce chemin faisait.
           *
           * Constate sur conv-1449 : le pied gabarit annoncait « 👉 Recommandé : faire exécuter le
           * travail si le besoin n'est pas encore réalisé » quand le RUN.md du meme run portait
           * `### phase build` + `### phase judge`, la DoD cochee et `status: green`. Le gabarit DEVINE
           * la portee depuis `phaseOutputs` ; vide, il avoue une ignorance qui n'existe pas — tout en
           * affirmant « ✅ Fait » deux lignes plus haut. Trois mensonges deja (20/08, 21/08, 23/08),
           * trois branches de rustine : c'est la METHODE qui est fausse. Un gabarit ne peut pas
           * savoir ce qui a ete fait ; celui qui vient de le faire, si.
           *
           * Le risque que la cloture mecanique couvrait est NOMME et couvert autrement : le modele
           * suivait parfois le rapport PROVISOIRE du worker (« RUN open, lance judge ») contre l'issue
           * reelle. On lui rend donc le compte-rendu AUTORITATIF (`formatOrchestrationOutcome`, la
           * meme source qui s'affichait) explicitement etiquete comme faisant foi.
           *
           * Le risque de second run payant, lui, etait DEJA couvert avant ce changement :
           * `orchestrationIssued` (plus haut) refuse toute 2e orchestration dans le meme tour.
           */
          orchestrationOutcome = outcome as Record<string, unknown> | undefined
          const compteRenduAutoritatif = formatOrchestrationOutcome(
            r.ok,
            outcome,
            r.ok ? undefined : String(r.error ?? ''),
            closureNotice
          )
          compteRenduOrchestration = compteRenduAutoritatif
          // Le MODELE lit le resultat ENTIER (conv-914) ; `compteRenduAutoritatif`, coupe a 4 000
          // caracteres, ne sert plus que de repli AFFICHE. La borne de tout resultat injecte
          // (conv-312) protege seule la fenetre de contexte.
          const compteRenduPourLeModele = bornerResultatDeCommande(
            token.name,
            formatOrchestrationOutcomePourLeModele(
              r.ok,
              outcome,
              r.ok ? undefined : String(r.error ?? ''),
              closureNotice
            )
          )
          results.push(
            `${token.name} → ISSUE AUTORITATIVE DU PIPELINE (elle fait foi contre tout rapport ` +
              `provisoire d'un worker ; aucune autre orchestration ne sera acceptée dans ce tour) :
` +
              compteRenduPourLeModele +
              `

Écris maintenant ta clôture pour l'utilisateur à partir de CES faits, sans en ` +
              `inventer d'autres et sans contredire cette issue.`
          )
          tokenIndex += 1
          continue
        }
        // Comptabilite COMMUNE avec les outils directs : voir `comptabiliserCommande`.
        const commandSucceeded = comptabiliserCommande(
          token.name,
          authoritativeArgs as Record<string, unknown>,
          r,
          actionId
        ).reussie
        // BORNE OBLIGATOIRE : sans elle, une lecture volumineuse (`retrospective`, `read_file`,
        // `conversation_read`) part telle quelle dans le prompt et tue le tour — conv-312, 2 860 957
        // caracteres injectes, « Prompt is too long », fil devenu un cul-de-sac.
        results.push(
          bornerResultatDeCommande(
            token.name,
            `${token.name} → ${
              commandSucceeded
                ? JSON.stringify(r.data)
                : 'ERREUR ' + (r.ok ? JSON.stringify(r.data) : r.error)
            }`
          )
        )
        tokenIndex += 1
      }

      // `remember` est une écriture auxiliaire : son résultat est déjà visible dans la carte action.
      // Quand le modèle a livré sa réponse dans le même message, repayer une génération uniquement
      // pour commenter un refus déterministe (type/locator/SHA) ne peut améliorer le travail rendu.
      /*
       * LE RACCOURCI NE DOIT PAS AVALER LA GARDE DE CLOTURE.
       *
       * Mesure conv-34 (2026-09-01) : « j'ai pas eu de bloc de fin ». `exigeUneConclusion` vit dans
       * la branche SANS commande (plus haut) ; ce `return` la rendait INATTEIGNABLE des qu'un tour
       * finit par « texte + remember » — le cas le plus courant d'un tour de kaizen, qui depose
       * justement sa lecon en dernier. Le tour se cloturait sur une phrase d'intention, sans ✅ Fait
       * et sans reste a faire. On rend la parole UNE fois, pour la seule cloture ; l'economie voulue
       * (ne pas repayer une generation pour commenter un refus) reste entiere quand le texte livre
       * conclut deja.
       */
      if (
        onlyAuxiliaryRemember &&
        exigerExperienceSoignee &&
        !relanceDeFormeUtilisee &&
        conclusionFormatRecoveryAvailable &&
        exigeUneConclusion(true, spoken)
      ) {
        relanceDeFormeUtilisee = true
        conclusionFormatRecoveryAvailable = false
        grantRecoveryIteration('conclusion-absente')
        consigneClotureApresRemember = true
      } else if (
        onlyAuxiliaryRemember &&
        refusRememberAuxiliaire &&
        repriseRememberRefuseDisponible
      ) {
        // REFUS REPARABLE : on ne clot pas, on rend la main aux commandes (voir
        // `repriseRememberRefuseDisponible`). La consigne part au bout de l'iteration, avec les
        // RESULTATS reels — le modele lit donc le motif exact, pas un resume.
        repriseRememberRefuseDisponible = false
        grantRecoveryIteration('correction-apres-echec')
        consigneRepriseRemember =
          'SYSTÈME: ton dépôt de mémoire a été REFUSÉ (' +
          refusRememberAuxiliaire +
          ') — RIEN n’a été écrit, malgré ce que ton texte annonce. Corrige la CAUSE du refus dans ' +
          'les arguments (portée du projet ou « global », type parmi lesson/decision/preference/' +
          'domain, source tracée) et RÉ-ÉMETS `remember` MAINTENANT. Si le refus n’est pas ' +
          'réparable, dis-le explicitement dans ta clôture au lieu de le taire. REPRENDS aussi ta ' +
          'conclusion EN ENTIER dans ce nouveau message : lui seul sera affiché à l’utilisateur, le ' +
          'texte précédent ne sera pas conservé.'
      } else if (onlyAuxiliaryRemember) {
        // Le modele a livre sa reponse ET sauve une memoire. On emettait VIDE — donc on JETAIT son
        // texte reel, laissant une bulle vide (conv-1141). `spoken` est garanti non vide ici.
        emit({
          kind: 'done',
          text: refusRememberAuxiliaire
            ? `${spoken}

⚠️ Mémoire NON déposée — ${refusRememberAuxiliaire}`
            : spoken,
          usage
        })
        return
      }

      /*
       * UNE QUESTION CLOT LE TOUR.
       *
       * `ask` ne suspendait rien : la commande rendait la question et le pilote enchainait. La
       * conversation restait donc OCCUPEE, et repondre passait par une DIRECTIVE -- affichee
       * « ORIENTÉ », avec un composer bloque sur « Orienter l'agent sans l'interrompre ». Vecu dans
       * `conv-1400` : l'utilisateur repondait a une question et le systeme enregistrait une
       * orientation. Toute cette gymnastique n'existait que parce qu'un `ask` ne terminait pas le tour.
       *
       * L'agent vient de dire qu'il lui manque une entree : son tour est fini, c'est celui de
       * l'utilisateur. La conversation cesse d'etre occupee, donc la reponse arrive comme un message
       * ORDINAIRE. On ne fait attendre PERSONNE -- pas de run suspendu, pas de delai a choisir, pas
       * d'echappatoire a prevoir.
       *
       * APRES l'execution de l'iteration, jamais a la rencontre du token : le modele peut poser une
       * question ET avoir produit du travail utile dans le meme souffle. On clot apres le travail, on
       * ne l'annule pas.
       *
       * LA GARDE « question sans lecture » PASSE DEVANT, et ce n'est pas un detail : elle vit dans la
       * branche SANS commande, donc cloturer ici sans la consulter la rendrait INATTEIGNABLE -- on
       * aurait echange un defaut contre un autre. Un modele qui questionne sans avoir rien lu est
       * donc relance, comme avant ; on ne clot que la question legitime.
       */
      if (questionPoseeCeTour) {
        if (questionDesLecturesPosee) {
          // Le modèle avait annoncé le run : la clôture dit qu'il n'est pas parti, et pourquoi.
          emit({
            kind: 'done',
            text: [spoken.trim() ? texteDeCloture(spoken) : '', AVIS_DEUX_LECTURES]
              .filter(Boolean)
              .join('\n\n'),
            usage
          })
          return
        }
        if (
          questionSansLectureRecoveryAvailable &&
          questionPoseeSansAvoirLu(questionPoseeCeTour, anyReadExecuted)
        ) {
          questionSansLectureRecoveryAvailable = false
          grantRecoveryIteration('question-sans-lecture')
          convo.push(RELANCE_QUESTION_SANS_LECTURE)
          continue
        }
        emit({
          kind: 'done',
          // Un tour MUET apres une orchestration retombe sur son compte-rendu, jamais sur du vide :
          // le resultat est paye, il doit s'afficher meme si le modele n'a rien redige.
          text: spoken.trim()
            ? texteDeCloture(spoken)
            : (compteRenduOrchestration ?? texteDeCloture(spoken)),
          ...(orchestrationOutcome ? { outcome: orchestrationOutcome } : {}),
          usage
        })
        return
      }

      const state = snapshotDuTour(await this.bus.snapshotForPrompt(), conversationId)
      const bloc = blocEtatSuivant(dernierEtatEnvoye, state)
      dernierEtatEnvoye = state
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\n${bloc}`)
      if (consigneClotureApresRemember) {
        consigneClotureApresRemember = false
        // D2 : meme relance, meme remplacement — la carte `remember` reste, seul le texte part.
        effacerReponseRelancee()
        convo.push(RELANCE_CONCLUSION_ABSENTE)
      }
      if (consigneRepriseRemember) {
        convo.push(consigneRepriseRemember)
        consigneRepriseRemember = undefined
      }
    }
    // Le cap EFFECTIF, pas le cap initial : `grantRecoveryIteration` en accorde jusqu'a huit de plus
    // (directive tardive, tour muet, chiffre non verifie, conclusion absente, echec taise...). Un tour
    // ayant reellement tourne neuf fois annoncait « Cap d'iterations (6) », donc le seul nombre que
    // l'utilisateur peut utiliser pour comprendre etait faux.
    const capError = `Cap d'itérations (${iterationLimit}) atteint sans réponse finale`
    // REPLI : une orchestration a bel et bien tourne dans ce tour. Mourir sur le cap jetterait son
    // compte-rendu — un resultat paye, deja calcule, que le modele a seulement omis de commenter.
    if (compteRenduOrchestration) {
      emit({
        kind: 'done',
        text: compteRenduOrchestration,
        ...(orchestrationOutcome ? { outcome: orchestrationOutcome } : {}),
        usage
      })
      return
    }
    // Le modèle a PARLÉ pendant ce tour : sa dernière parole EST la clôture. Mourir sur une erreur
    // terminale jetterait un texte déjà payé et déjà diffusé en flux (conv-1485).
    if (visibleTextThisTurn.trim()) {
      emit({
        kind: 'done',
        text: texteDeCloture(visibleTextThisTurn),
        ...(orchestrationOutcome ? { outcome: orchestrationOutcome } : {}),
        usage
      })
      return
    }
    emit({
      kind: 'error',
      text: capError,
      usage
    })
    throw new Error(capError)
  }
}
