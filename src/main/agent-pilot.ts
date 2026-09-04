import { forgetChatSession, loadChatSessions, saveChatSession } from './runs/chat-session-store'
import { chargerMurs, enregistrerMur } from './runs/murs-store'
import type { ProviderRegistry } from './providers/registry'
import type { RoleBinding, RoleModelConfig } from './roles'
import type { AppCommandBus, CommandResult } from './commands'
import {
  ProviderCallError,
  type Message,
  type PromptEnvelope,
  type SendOptions,
  type SendResult,
  type Usage
} from './providers/types'
import { parseModelQuestion, type ModelQuestion } from './model-questions'
import { evictedCount, rememberedFacts, sessionMemoryBlock } from './session-memory-echo'
import {
  buildTurnMessageBlocks,
  exigeAgirPasAnnoncer,
  consigneApresEchec,
  exigeCorrigerEtPoursuivre,
  cleDEchec,
  signatureDEchec,
  exigeDireLEchec,
  exigeUnChiffreVerifie,
  exigePreuveAvantDePromettre,
  RELANCE_PREUVE_AVANT_DE_PROMETTRE,
  blocVisuelNonFerme,
  RELANCE_BLOC_VISUEL_NON_FERME,
  questionPoseeSansAvoirLu,
  statusEstUneLecture,
  RELANCE_QUESTION_SANS_LECTURE,
  exigeUneConclusion
} from './chat-turn-messages'
import { invokedSkillId, skillInstruction } from './skill-pipeline'
import { VisibleStreamFilter } from '../shared/stream-markup-filter'
import { randomUUID } from 'node:crypto'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { CONSTITUTION } from './constitution'
import { routeSkillRequest } from './skill-routing'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import {
  conversationPretendueInaccessible,
  correctionConversationLisible,
  correctionOutilsPresents,
  outilsFaussementAbsents
} from '../shared/outil-pretendu-absent'
import { startTurnTimer } from './turn-timing'
import { claudeActiveAccountId } from './claude-accounts'
import {
  formatOrchestrationOutcome,
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
 * tué, un tour de 5 appels ruineux passait. Le frein qui reste est le seul honnête : la dépense
 * réelle du tour (`AUTOWIN_CHAT_USD_CAP`, voir `chat-turn-budget.ts`), plus l'annulation manuelle.
 * Avec l'infini, les injections « budget du tour » et « dernière itération » ne se déclenchent plus :
 * leurs conditions comparent l'index à une borne finie.
 */
export const CAP_ITERATIONS_TOUR = Number.POSITIVE_INFINITY
import type { PilotEventKind } from '../shared/pilot-events'
import { blocEtatSuivant, type EtatPrompt } from './etat-diff'
import { protegerRappel } from './observabilite-non-bloquante'

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
  | { kind: 'think'; text: string }
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
    }
  | {
      kind: 'result'
      actionId: string
      name: string
      ok: boolean
      data?: unknown
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
  /** Cf. la variante `command` : action echouee que cette action retente (heuristique). */
  repriseProbableDe?: string
  artifact?: ChatArtifact
  /** Modele concret rapporte par le provider pour un appel termine. */
  resolvedModel?: string
  /** Pieces jointes brutes du resultat, durables cote main mais retirees avant l'IPC renderer. */
  attachments?: NonNullable<Message['attachments']>
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: TurnUsage
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
  if (data.stored === false || data.allowed === false || data.refused === true) return false
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
  'terminant par ce bloc, court et concret : « ✅ Fait » (ce que tu as établi, avec le ' +
  'résultat), puis l’état en trois lignes — 📍 Maintenant / ⏳ Reste à faire / 👉 ' +
  'Recommandé. N’écris aucune étiquette technique du type « [a exécuté … ] » et ' +
  'n’annonce pas ce que tu vas faire : le travail est déjà fait, dis ce qu’il a donné. ' +
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
  | { kind: 'command'; name: string; args: Record<string, unknown> }
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
  let dansUneFence = false
  for (let index = 0; index < lignes.length; index += 2) {
    const ligne = lignes[index]
    if (/^[ \t]*(?:`{3,}|~{3,})/u.test(ligne)) {
      dansUneFence = !dansUneFence
      continue
    }
    if (dansUneFence) continue
    const soudure = /^(.*[^\s`~])(`{3,}|~{3,})([A-Za-z][\w-]*)[ \t]*$/u.exec(ligne)
    if (!soudure) continue
    lignes[index] = `${soudure[1]}\n\n${soudure[2]}${soudure[3]}`
    dansUneFence = true
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
    const ouvertures = texte.match(/^[ \t]*(?:```|~~~)/gm)
    return ouvertures !== null && ouvertures.length % 2 === 1
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

export function parseOrderedPilotTokens(raw: string): OrderedPilotToken[] {
  const tokens: OrderedPilotToken[] = []
  let cursor = 0
  CONTROL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTROL_RE.exec(raw)) !== null) {
    const visible = filterVisibleText(raw.slice(cursor, match.index))
    if (visible) tokens.push({ kind: 'text', text: visible })
    if (match[1] === 'cmd') {
      const rawBlock = match[2]
      try {
        const parsed = JSON.parse(rawBlock) as {
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
          tokens.push({ kind: 'command', name, args })
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
function replierSurLaMiniature(
  piece: PieceJointeDuFil | undefined
): PieceJointeDuFil | undefined {
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

export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus,
    private readonly retrieveContext?: (query: string) => Promise<string>,
    /**
     * Contexte projet plié (CLAUDE.md/AGENTS.md du workspace), MÊME source que les phases
     * orchestrées (context-files). Défaut vide → le chat reste fonctionnel sans workspace.
     */
    private readonly projectContext: () => string = () => '',
    /** Workspace actif, pour ne jamais relire dans un dépôt un fait provisoire appris dans un autre. */
    private readonly executionWorkspace: () => string = () => ''
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
   * LIMITE ASSUMEE, dite plutot que cachee : cette carte vit en MEMOIRE. Un redemarrage de l'app entre
   * les deux tours perd la note, alors que la session, elle, est rehydratee depuis le disque. Le cas
   * reste donc possible — beaucoup plus rare qu'aujourd'hui, mais pas impossible. Le rendre durable
   * demanderait de changer la forme du cache de sessions sur disque, hors du perimetre demande.
   */
  private readonly comptesRendusNonVus = new Map<string, string>()

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
     * le faire. Le cout reste borne par le budget du tour (AUTOWIN_CHAT_USD_CAP), qui coupe sur la
     * depense reelle plutot que sur un compteur aveugle.
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
    const emit = (e: PilotEventVariant): void => {
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
    const snapshot = await this.bus.snapshotForPrompt((nom) => timer.mark(nom))
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
    if (directRoute?.reason === 'explicit-skill' && directRoute.explicitPhase) {
      const actionId = 'route:0'
      const args = { task: directRoute.task }
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
      const directiveNotice = lateDirectives.length
        ? `⚠️ ${lateDirectives.length} orientation(s) reçue(s) après le lancement : aucun second run n'a été relancé. Renvoyez-la comme nouveau message si elle reste nécessaire.`
        : undefined
      // Les FAITS, pas une formule : statut, validite, blocage de gate, cout, run et resultat sont
      // tous rendus par l'orchestrateur et etaient jetes (conv-76 : 18 sous-agents, 10,05 $, le fil
      // n'affichait que « Workflow Autowin execute. »).
      const compteRendu = formatOrchestrationOutcome(
        result.ok,
        result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined,
        result.ok ? undefined : String(result.error ?? ''),
        directiveNotice
      )
      /**
       * Ce tour n'a JAMAIS atteint le modele : on garde son compte-rendu pour le lui donner au tour
       * suivant. Sans ce depot, il se voit demander « on a bien fait tout le processus ? » a propos
       * d'un tour dont rien, dans sa session, ne porte la trace.
       */
      if (conversationId) this.comptesRendusNonVus.set(conversationId, compteRendu)
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
    const retrievedContext =
      this.retrieveContext && latestUserMessage
        ? await this.retrieveContext(latestUserMessage).catch(() => '')
        : ''
    timer.mark('ragBrain')

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
    const providerLimits: Pick<SendOptions, 'maxBudgetUsd' | 'toolProfile'> = {
      ...(sendLimits?.maxBudgetUsd ? { maxBudgetUsd: sendLimits.maxBudgetUsd } : {}),
      ...(commandFreeReadOnly ? { toolProfile: 'watchdog-read-only' as const } : {})
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
     */
    const systemParts = watchdogReadOnly
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
                '```html-render en DIRECTION « transparence totale » (choix utilisateur du 14/08) : aucun ' +
                'panneau ni fond opaque, typographie sur le fond sombre de l’app, filets fins degrades or ' +
                '(rgba(212,169,79,.55) vers .06), accents or #d4a94f-#e3ba55 pour kickers mono et chiffres ' +
                'cles, texte #dde3ee, chips monospace discretes, mise en page COMPACTE (interlignes 1.45-1.55, ' +
                'marges de section <=10px, aucun grand vide vertical), jamais de halos ; sans ' +
                'JavaScript ni URL externe. Garde le texte simple pour une ou deux phrases.\n'
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
            { name: 'projectContext', text: this.projectContext() }
          ]
    const system = systemParts.map((p) => p.text).join('')
    const systemBlocks = systemParts
      .filter((p) => p.text)
      .map((p) => ({ name: p.name, chars: p.text.length }))

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
    const sessionKey = `${provider}:${binding.model ?? ''}:${claudeActiveAccountId() ?? ''}`
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
    const executionWorkspace = this.executionWorkspace().trim()
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
    const invoked = invokedSkillId(lastUserMessage?.content ?? '')
    const skillBody = invoked ? skillInstruction(invoked) : ''
    /**
     * Le compte-rendu d'un tour execute sans le modele est CONSOMME ici — une seule fois.
     *
     * Lu puis retire : le laisser en place le re-injecterait a chaque tour suivant, ou il deviendrait
     * un vieux resultat presente comme frais. Il n'est utile qu'au tour qui suit immediatement le trou.
     * Retire meme sans reprise de session : dans ce cas l'historique complet part de toute facon, donc
     * la note est redondante — la garder ne ferait que la faire ressortir plus tard, a contretemps.
     */
    const compteRenduNonVu = conversationId
      ? this.comptesRendusNonVus.get(conversationId)
      : undefined
    if (conversationId) this.comptesRendusNonVus.delete(conversationId)
    /*
     * LE RAPPEL EST INJECTE, PAS ATTENDU.
     *
     * Les outils de recherche existent (`conversation_search`, `conversation_read`), mais rien ne
     * garantit que le modele PENSE a les appeler -- et il n'y pensera pas, parce qu'il ne sait pas
     * qu'il ignore quelque chose : « remake les pastilles de couleurs » se lit comme une demande
     * complete. Attendre qu'il s'en avise, c'est reconduire conv-1407 en esperant mieux.
     *
     * Ne se declenche que sur une demande BREVE, et exclut la conversation courante : voir les
     * bornes dans `rappel-conversations.ts`.
     */
    // Dependance OPTIONNELLE, et assumee comme telle : un rappel est un CONFORT. Un tour qui
    // echouerait faute de rappel ferait dependre chaque message d'une commodite -- et les bus
    // factices des tests, qui n'implementent que ce qu'ils exercent, tomberaient avec lui.
    const rappelConversations =
      typeof this.bus.rappelPourDemande === 'function'
        ? this.bus.rappelPourDemande(lastUserMessage?.content, conversationId)
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
    const blocsDuTour = buildTurnMessageBlocks({
      snapshot,
      brainContext,
      memoryEcho,
      rappelConversations,
      skillBody,
      history,
      resumeSessionId,
      lastUserMessage: lastUserMessage?.content,
      compteRenduNonVu,
      tourCoupePourCeMessage
    })
    const nomsDuTour = new Map(blocsDuTour.map((bloc) => [bloc.text, bloc.name]))
    const convo: string[] = blocsDuTour.map((bloc) => bloc.text)
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
              : { ...lisible, name: `${lisible.name} (jointe a un message precedent)` }
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
     * A-t-il parle A UN MOMENT du tour ? La question porte sur le TOUR ENTIER, pas sur la derniere
     * iteration : un tour « Avant. <action> Apres. » suivi d'une reponse vide a deja tout dit, le
     * relancer serait du bavardage paye. (Bug attrape par agent-pilot.streaming.test.ts.)
     */
    let anySpokenText = false
    let conclusionRecoveryAvailable = true
    /** Une LECTURE a-t-elle eu lieu ? Un chiffre sans lecture est une supposition, pas une reponse. */
    let anyReadExecuted = false
    /**
     * Une QUESTION a-t-elle ete posee ce tour ? Mesure du 2026-08-25 (conv-1399) : une question a
     * quatre options posee sans avoir lu un seul fichier, dont une option DEJA implementee et
     * committee. L'utilisateur a attendu pour une reponse qui etait a portee de lecture.
     */
    let questionPoseeCeTour = false
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
      return refusRememberAuxiliaire
        ? `${texte}

⚠️ Mémoire NON déposée — ${refusRememberAuxiliaire}`
        : texte
    }
    // L'etat ENTIER part deja dans le premier message du tour : les iterations suivantes n'en
    // repoussent que le DELTA (voir `etat-diff.ts`).
    let dernierEtatEnvoye: EtatPrompt = snapshot
    for (let i = recoveredProviderCall?.iteration ?? 0; i < iterationLimit; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(`UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`)
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
          content: `${segmentsAEnvoyer.join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
          ...(iterationAttachments.length ? { attachments: iterationAttachments } : {})
        }
      ]
      const contextBlocks = contextBlocksDuTour()
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
      let attempt =
        recoveredProviderCall && i === recoveredProviderCall.iteration
          ? recoveredProviderCall.attempt
          : 0
      const requestId = randomUUID()
      const options: SendOptions = {
        system,
        systemBlocks,
        contextBlocks,
        model: binding.model,
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
        observePrompt: (observed) => {
          observed.systemBlocks = systemBlocks
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
      let callStartedAt = performance.now()
      let successfulStreamedPrefix = recoveredHere?.streamedPrefix ?? ''
      let successfulAttempt = recoveredHere?.attempt ?? 0
      while (!res) {
        const streamId = `${i}:${attempt}`
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
            emit({ kind: 'delta', streamId, text: segment.text, iteration: i })
          }
        }
        try {
          callStartedAt = performance.now()
          timer.mark(`send${i}:start`)
          let sawFirstChunk = false
          res = await this.registry.send(provider, messages, options, (chunk) => {
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
              if (statusEstUneLecture(chunk.status)) anyReadExecuted = true
              // Canal SEPARE du raisonnement : un battement d'outil n'est pas une pensee.
              emit({
                kind: 'provider-status',
                text: chunk.status,
                iteration: i,
                // Le journal recopie `text` : sans cette cible entiere, il n'y garde qu'un moignon.
                ...(chunk.statusTarget ? { data: { target: chunk.statusTarget } } : {})
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
          if (error instanceof ProviderCallError && !error.retryable) throw error
          if (attempt >= 1) throw error
          if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
          attempt += 1
          emit({
            kind: 'retry',
            iteration: i,
            name: provider,
            text: message,
            data: { attempt, maxAttempts: 2 }
          })
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
      if (res.sessionId && providerResumes) sessionEnCours = res.sessionId
      if (conversationId) {
        if (res.sessionId && providerResumes) {
          this.chatSessions.set(conversationId, { key: sessionKey, sessionId: res.sessionId })
          this.persistChatSession(conversationId, sessionKey, res.sessionId)
        } else {
          // Un provider qui ne rend pas de nouvelle session ne garantit pas que ce tour appartient
          // à la précédente. La conserver ferait élider un historique qu'il n'a peut-être jamais reçu.
          this.chatSessions.delete(conversationId)
          this.forgetPersistedChatSession(conversationId)
        }
      }
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens
        usage.outputTokens += res.usage.outputTokens
        usage.costUsd += res.usage.costUsd ?? 0
        // ECRASE, ne cumule pas : la jauge de contexte veut la DERNIERE entree, pas leur somme.
        usage.derniereEntree = res.usage.inputTokens
        usage.derniereEntreeCache = res.usage.cacheReadTokens
        // Le modele SERVI, sinon aucune fenetre de contexte n'est trouvable en aval.
        if (res.model) usage.model = res.model
        usage.provider = provider
      }
      // Dernière barrière avant d'interpréter/clore la réponse : une directive arrivée pendant
      // l'appel provider invalide cette réponse devenue obsolète. On la réinjecte dans un nouvel
      // appel du MÊME tour. Entre ce drain vide et les branches synchrones ci-dessous, aucun IPC ne
      // peut s'intercaler : l'ACK immédiat reste donc sans fenêtre de perte en fin de tour.
      const lateDirectives = drainDirectives?.() ?? []
      /**
       * UNE DIRECTIVE TARDIVE INVALIDE DU TEXTE, JAMAIS DES ACTIONS.
       *
       * Mesure du 2026-09-01 (conv-65) : l'utilisateur repond pendant que le tour finit, et sa
       * reponse jetait la reponse ENTIERE du modele — y compris les `<cmd>` qu'elle portait. Le tour
       * contenait un `ask` : la question n'a donc JAMAIS ete posee, aucun bouton n'est apparu, et
       * l'utilisateur a vecu « quand je reponds ca marche pas ». Un `remember` du meme souffle a
       * disparu pareil. Trace : aucun `tool-call` pour ces deux commandes dans conv-65.jsonl.
       *
       * Regle : le TEXTE peut etre perime (il ne connait pas la directive), une ACTION deja decidee
       * ne l'est pas. On execute donc l'iteration, la directive entrant au point d'iteration suivant.
       *
       * Et si l'iteration portait un `ask`, cette directive EST la reponse : on ne repose pas la
       * question (elle attendrait un clic deja donne) et on ne clot pas le tour dessus.
       */
      const directivePorteLaReponse =
        lateDirectives.length > 0 &&
        parseOrderedPilotTokens(res.text ?? '').some((token) => token.kind === 'command')
      if (lateDirectives.length) {
        for (const directive of lateDirectives) {
          convo.push(
            `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`
          )
        }
        if (successfulStreamedPrefix && !directivePorteLaReponse) {
          emit({ kind: 'stream-reset', streamId: `${i}:${successfulAttempt}`, iteration: i })
        }
        grantRecoveryIteration('late-directive')
        if (!directivePorteLaReponse) continue
        reponseTardiveAUneQuestion = lateDirectives.join(' / ')
      }
      for (const artifact of res.artifacts ?? []) {
        emit({ kind: 'artifact', artifact, iteration: i })
      }
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
        convo.push(`UTILISATEUR: ${answer}`)
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
        if (!successfulStreamedPrefix && spoken) emit({ kind: 'think', text: spoken })
        else if (successfulStreamedPrefix) {
          const visible = ordered
            .filter(
              (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                token.kind === 'text'
            )
            .map((token) => token.text)
            .join('')
          const { visible: remainder } = consumeStreamedPrefix(visible, successfulStreamedPrefix)
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
          exigeAgirPasAnnoncer(latestUserMessage, visibleTextThisTurn, anyActionExecuted)
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
          convo.push(
            'SYSTÈME: au moins une de tes actions a ÉCHOUÉ et ta réponse n’en dit rien. Reformule ' +
              'MAINTENANT, SANS aucune commande : dis EXPLICITEMENT laquelle a échoué et ce que ' +
              'cela empêche. N’écris « Fait » que pour ce qui a RÉELLEMENT abouti — un « ✅ Fait » ' +
              'posé sur un échec est pire que pas de conclusion du tout, parce qu’il rassure à tort.'
          )
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
          exigeUnChiffreVerifie(latestUserMessage, visibleTextThisTurn, anyReadExecuted)
        ) {
          chiffreNonVerifieRecoveryAvailable = false
          grantRecoveryIteration('chiffre-non-verifie')
          convo.push(
            'SYSTÈME: tu viens d’avancer un nombre SANS avoir appelé la moindre commande de ' +
              'lecture. Tu ne peux pas connaître le contenu d’un dossier sans le lister : ce ' +
              'chiffre est une supposition, pas une réponse. Appelle MAINTENANT `list_files` (ou ' +
              '`find_in_files`) sur le dossier concerné, puis donne le nombre RÉELLEMENT observé. ' +
              'S’il diffère de ce que tu viens d’écrire, corrige-toi explicitement.'
          )
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
      echecDeLaDerniereIteration = false
      // Remis a plat a chaque iteration, comme son jumeau : sinon un rejeu d'une iteration
      // precedente ferait escalader une iteration qui n'a rencontre qu'un mur neuf.
      dernierEchecEstUnRejeu = false
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

        const actionId = `${i}:${commandIndex++}`
        anyActionExecuted = true
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
        if (token.name === 'ask') questionPoseeCeTour = true
        const settledAction = recoveredHere?.settledActions?.find(
          (action) => action.actionId === actionId && action.name === token.name
        )
        if (!settledAction) emit({ kind: 'command', actionId, name: token.name, args: token.args })
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
        const authoritativeArgs =
          token.name === 'orchestrate' && latestUserMessage
            ? { ...token.args, rootTask: latestUserMessage }
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
        if (!settledAction)
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: commandResultSucceeded(r),
            data: r.ok ? r.data : r.error,
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
            commandesEnEchecNonRattrape.add(
              cleDEchec(token.name, authoritativeArgs as Record<string, unknown>)
            )
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
          results.push(
            `${token.name} → ISSUE AUTORITATIVE DU PIPELINE (elle fait foi contre tout rapport ` +
              `provisoire d'un worker ; aucune autre orchestration ne sera acceptée dans ce tour) :
` +
              compteRenduAutoritatif +
              `

Écris maintenant ta clôture pour l'utilisateur à partir de CES faits, sans en ` +
              `inventer d'autres et sans contredire cette issue.`
          )
          tokenIndex += 1
          continue
        }
        const commandSucceeded = commandResultSucceeded(r)
        if (token.name === 'remember') {
          // Sur `stored`, PAS sur la reussite du transport : voir motifDepotMemoireNonAbouti.
          // Assignation INCONDITIONNELLE : un depot REJOUE avec succes doit EFFACER le refus
          // precedent, sinon la cloture porterait un « NON deposee » dementi par la reprise.
          refusRememberAuxiliaire = motifDepotMemoireNonAbouti(r)
        }
        /*
         * La clef porte le nom ET LA CIBLE. Avec le nom seul, un `edit_file` reussi sur `b.ts`
         * purgeait l'echec jamais rejoue sur `a.ts` — defaut mesure le 2026-08-22 par deux juges
         * externes independants, et mon commentaire revendiquait alors une garantie que la clef ne
         * pouvait pas donner. `cleDEchec` ne retient que les arguments IDENTIFIANTS, pour qu'une
         * reprise du meme fichier avec un contenu corrige rende la MEME clef.
         */
        const cleCible = cleDEchec(token.name, authoritativeArgs as Record<string, unknown>)
        // Rejouee avec succes sur la MEME cible : l'echec est repare, il ne pese plus sur la cloture.
        if (commandSucceeded) commandesEnEchecNonRattrape.delete(cleCible)
        if (!commandSucceeded) {
          anyActionFailed = true
          echecDeLaDerniereIteration = true
          commandesEnEchecNonRattrape.add(cleCible)
          const signature = signatureDEchec(
            token.name,
            String(r.ok ? JSON.stringify(r.data) : (r.error ?? ''))
          )
          // Le test d'appartenance passe AVANT l'enregistrement, sinon le mur courant serait
          // toujours « deja vu » et la premiere rencontre declencherait l'escalade a tort.
          // AGREGE sur l'iteration : si AU MOINS UN echec de cette iteration est un rejeu connu,
          // l'escalade est due. Ne garder que le dernier perdait silencieusement l'escalade quand
          // une iteration enchainait un mur deja connu PUIS un mur neuf (audit du 2026-08-21).
          dernierEchecEstUnRejeu =
            dernierEchecEstUnRejeu || signaturesDEchecVues.includes(signature)
          derniereSignatureDEchec = signature
          signaturesDEchecVues.push(signature)
          if (conversationId) {
            try {
              enregistrerMur(conversationId, signature)
            } catch {
              /* best-effort : c'est un cache d'indice, il ne doit jamais casser le tour */
            }
          }
        }
        results.push(
          `${token.name} → ${
            commandSucceeded
              ? JSON.stringify(r.data)
              : 'ERREUR ' + (r.ok ? JSON.stringify(r.data) : r.error)
          }`
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

      const state = await this.bus.snapshotForPrompt()
      const bloc = blocEtatSuivant(dernierEtatEnvoye, state)
      dernierEtatEnvoye = state
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\n${bloc}`)
      if (consigneClotureApresRemember) {
        consigneClotureApresRemember = false
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
