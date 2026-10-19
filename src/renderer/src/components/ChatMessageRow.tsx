/**
 * Ligne de message du fil (bulle utilisateur / assistant) et ses satellites, extraits de
 * `ChatView.tsx` (levier « découpe »). Déplacement PUR : aucune ligne de logique modifiée.
 *
 * Ce module est volontairement PROP-DRIVEN : il ne connaît ni l'état du composer, ni la file, ni
 * l'IPC. C'est ce qui rend tenable l'invariant perf « composer change ≠ re-render des lignes »
 * (comparateur data-only en bas de fichier).
 */
import { tourRefusePourAutoLancer } from './veille-candidats-message'
import React, { Fragment, memo, useRef, useState } from 'react'
import { promptDuClic } from './bouton-prompt-html'
import { Markdown } from './Markdown'
import { SuggestionGrid } from './SuggestionGrid'
import { CandidatsPickPanel } from './CandidatsPickPanel'
import { AskDecisionBlock } from './AskDecision'
import { JugesPanel } from './JugesPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactPile } from './ArtifactPile'
import { AssistantActivityGroup } from './ChatView.parts'
import { clotureEnDernier } from './cloture-en-dernier'
import { CheckIcon, CopyIcon, ForkIcon, InspectIcon } from './chat-view-icons'
import { formatFileSize } from './chat-attachments'
import { formaterHeureComplete, formaterHeureMessage } from './heure-message'
import {
  groupAssistantActivity,
  libelleCoutDuTour,
  type ChatErrorPart,
  type ChatPart,
  type ChatRenderBlock
} from './chat-view-model'
import {
  heureSurLeRail,
  instantDuBloc,
  natureDuBloc,
  placeDeLaReponse,
  type NatureDuNoeud
} from './rail-du-tour'
import { bilanDuTour, formaterBilan } from './bilan-tour'
import { estErreurAuthExpiree } from './erreur-auth'
import type { TerminalStatus } from './chat-resume-refine'
import type { AttachmentMeta, DirectiveReceipt, Msg } from './chat-view-types'
import type { InspectTurnTarget } from '../observatory-focus'
import type { ChatArtifact } from '../../../shared/artifacts'
import { Spinner } from './Spinner'
import { decouperSkill } from './skill-entete'
import type { SkillInstallee } from './useSkillsInventory'
import { ThinkingBlock } from './ThinkingBlock'

/** Le texte COPIABLE d'un message : la bulle utilisateur, ou tout le texte rendu par l'agent. */
function texteCopiable(message: Msg): string {
  if (message.role === 'user') return message.content ?? ''
  return message.parts
    .filter((part): part is Extract<ChatPart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

/**
 * Bouton « copier ce message » — pose le texte du message dans le presse-papier et confirme par une
 * coche pendant 1,5 s. Demande utilisateur du 2026-09-12 : il vit A COTE du bouton brancher.
 */
export function CopyMessageButton({ message }: { message: Msg }): React.JSX.Element | null {
  const [copie, setCopie] = React.useState(false)
  const texte = texteCopiable(message)
  if (!texte) return null
  return (
    <button
      type="button"
      className="msg-turn-icon"
      data-testid="copy-message"
      title="Copier ce message dans le presse-papier"
      aria-label="Copier ce message"
      onClick={() => {
        void navigator.clipboard?.writeText(texte).then(
          () => {
            setCopie(true)
            setTimeout(() => setCopie(false), 1500)
          },
          () => setCopie(false)
        )
      }}
    >
      {copie ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

/**
 * Un texte MIS DE CÔTÉ dit qu'il attend, et POURQUOI (conv-891) : le refus d'injection est voulu,
 * jamais un échec. Sans motif (app principale plus ancienne), on dit seulement ce qui est sûr.
 */
function libelleAttente(receipt: DirectiveReceipt): string {
  if (receipt.attenteMotif === 'commande' && receipt.commande)
    return `⏸ Attend la fin du tour — lu comme la commande « ${receipt.commande} », qui ne s’ajoute pas à un tour en cours`
  if (receipt.attenteMotif === 'hors-tour')
    return '⏸ Attend la fin du tour — le tour se terminait, il partira juste après'
  return '⏸ Attend la fin du tour — il ne pouvait pas s’ajouter au tour en cours, il partira juste après'
}

export function DirectiveReceiptRow({ receipt }: { receipt: DirectiveReceipt }): React.JSX.Element {
  return (
    <div className={`msg user directive-receipt is-${receipt.status}`}>
      {/* Plus de libelle « Toi » (conv-227, 2026-10-11) ; l'etat de l'envoi, lui, reste. */}
      <div className="msg-meta">
        <span className="directive-receipt-status" role="status">
          {receipt.status === 'sending' ? (
            <>
              <Spinner /> {receipt.reponse ? 'Réponse…' : 'Orientation…'}
            </>
          ) : receipt.status === 'sent' ? (
            receipt.reponse ? (
              '✓ Répondu'
            ) : (
              // Pas « dans sa prochaine réponse » : l'orientation n'entre qu'à la fin de l'appel
              // en cours, et le texte suivant n'y répond pas (conv-253, tour cdbc9802, 93 s).
              '✓ Reçue — l’agent finit ce qu’il fait, puis y répond'
            )
          ) : receipt.status === 'differee' ? (
            '⏸ Reçue — l’agent la lira à la phase suivante du run'
          ) : receipt.status === 'attente' ? (
            libelleAttente(receipt)
          ) : (
            '⚠ Erreur d’envoi — il attend la fin du tour et partira juste après'
          )}
        </span>
      </div>
      <div className="msg-body" dir="auto">
        {receipt.text}
      </div>
    </div>
  )
}

const ERROR_CAUSE_LABEL: Record<ChatErrorPart['cause'], string> = {
  send: 'Envoi impossible',
  turn: 'Le tour a échoué'
}

/**
 * Rendu DÉDIÉ d'une erreur de tour. Une erreur n'est pas du contenu : elle est annoncée
 * (`role="alert"`), sa CAUSE est nommée, et elle porte sa propre sortie de secours — l'ancien
 * `⚠️ …` texte n'offrait aucune des trois.
 */
export function ChatErrorBlock({
  part,
  retryPrompt,
  bilan,
  onResend,
  onRefineResume,
  onLogin
}: {
  part: ChatErrorPart
  retryPrompt?: string
  /**
   * Ce que le tour a accompli AVANT de s'arreter. Sans lui, un arret se lit comme un echec total :
   * vecu le 2026-08-19, deux commits etaient dans `main` et l'ecran ne montrait que « budget duree
   * depasse ». Le travail vivait dans les parts du meme message — il n'y avait qu'a le dire.
   */
  bilan?: string
  onResend?: (prompt: string) => void
  onRefineResume?: (prompt: string, status: TerminalStatus, reason?: string | null) => void
  /** Ouvre le login du provider. Seul levier utile quand la session a expire. */
  onLogin?: () => void
}): React.JSX.Element {
  // SESSION EXPIREE : renvoyer ou reprendre echouerait a l'identique. On n'offre que le login.
  const authExpiree = estErreurAuthExpiree(part.message)
  return (
    <div className="msg-error" role="alert" data-cause={part.cause}>
      <span className="msg-error-cause">⚠️ {ERROR_CAUSE_LABEL[part.cause]}</span>
      <span className="msg-error-message">{part.message}</span>
      {bilan && (
        <span className="msg-error-bilan" data-testid="erreur-bilan">
          {bilan}
        </span>
      )}
      {authExpiree && onLogin ? (
        <span className="msg-error-actions">
          <button
            type="button"
            className="msg-error-action"
            data-testid="error-login"
            title="Ouvrir la reconnexion Claude — la session a expiré"
            onClick={onLogin}
          >
            🔑 Se reconnecter
          </button>
        </span>
      ) : (
        retryPrompt &&
        (onResend || onRefineResume) && (
        <span className="msg-error-actions">
          {onResend && (
            <button
              type="button"
              className="msg-error-action"
              title={`Renvoyer : ${retryPrompt}`}
              onClick={() => onResend(retryPrompt)}
            >
              ↻ Renvoyer
            </button>
          )}
          {onRefineResume && (
            <button
              type="button"
              className="msg-error-action"
              data-testid="error-refine"
              title="Pré-remplir le composer avec ce prompt et le motif d’échec, sans envoyer"
              onClick={() => onRefineResume(retryPrompt, 'failed', part.message)}
            >
              ✎ Reprendre en précisant…
            </button>
          )}
          </span>
        )
      )}
    </div>
  )
}

/**
 * Motif d'échec RÉEL du tour, pour l'injecter dans la reprise « en précisant ». Deux sources,
 * dans l'ordre : la part d'erreur structurée (chemin courant) puis l'ancien `⚠️ …` texte, qui
 * reste présent dans les conversations DÉJÀ persistées.
 */
function terminalFailureReason(message: Msg): string | undefined {
  if (message.role !== 'assistant') return undefined
  for (const part of message.parts) {
    if (part.kind === 'error') return part.message
  }
  for (const part of message.parts) {
    if (part.kind === 'text' && part.text.trimStart().startsWith('⚠️'))
      return part.text.replace('⚠️', '').trim() || undefined
  }
  return undefined
}

type AssistantTimelineItem =
  { kind: 'parts'; parts: ChatPart[] } | { kind: 'receipt'; receipt: DirectiveReceipt }

/**
 * Clé d'un point du rail : celle que portait le bloc avant le rail. Une question `ask` garde
 * l'identité de son action (son verrou « déjà répondu » ne doit pas repartir à zéro), une image
 * celle de son fichier ; le reste, son rang.
 */
function cleDuBloc(part: ChatRenderBlock, index: number): string {
  if (part.kind === 'ask-decision') return `ask-${part.askId}`
  if (part.kind === 'artifact') return part.artifact.id
  if (part.kind === 'artifact-pile') return `pile-${part.artifacts[0].id}`
  return String(index)
}

function splitAssistantTimeline(
  parts: ChatPart[],
  receipts: DirectiveReceipt[]
): AssistantTimelineItem[] {
  if (receipts.length === 0) return [{ kind: 'parts', parts }]
  // Un recu SANS point d accroche (la reponse n affichait encore rien) passe EN DERNIER : sinon
  // le message tape pendant un travail s affichait AU-DESSUS du bloc en cours (2026-09-01).
  const rang = function (receipt: DirectiveReceipt): number {
    return receipt.afterPartIndex < 0 ? Number.MAX_SAFE_INTEGER : receipt.afterPartIndex
  }
  const ordered = receipts
    .slice()
    .sort(
      (left, right) =>
        rang(left) - rang(right) ||
        (left.afterTextOffset ?? Number.MAX_SAFE_INTEGER) -
          (right.afterTextOffset ?? Number.MAX_SAFE_INTEGER) ||
        left.id - right.id
    )
  const timeline: AssistantTimelineItem[] = []
  let pendingParts: ChatPart[] = []
  let receiptIndex = 0
  const flushParts = (): void => {
    if (pendingParts.length === 0) return
    timeline.push({ kind: 'parts', parts: pendingParts })
    pendingParts = []
  }
  const appendReceipt = (receipt: DirectiveReceipt): void => {
    flushParts()
    timeline.push({ kind: 'receipt', receipt })
  }

  parts.forEach((part, partIndex) => {
    if (part.kind === 'text') {
      let textOffset = 0
      while (ordered[receiptIndex]?.afterPartIndex === partIndex) {
        const receipt = ordered[receiptIndex]
        const receiptOffset = Math.max(
          textOffset,
          Math.min(part.text.length, receipt.afterTextOffset ?? part.text.length)
        )
        if (receiptOffset > textOffset)
          pendingParts.push({ ...part, text: part.text.slice(textOffset, receiptOffset) })
        appendReceipt(receipt)
        textOffset = receiptOffset
        receiptIndex += 1
      }
      if (textOffset < part.text.length)
        pendingParts.push({ ...part, text: part.text.slice(textOffset) })
      return
    }
    pendingParts.push(part)
    while (ordered[receiptIndex]?.afterPartIndex === partIndex) {
      appendReceipt(ordered[receiptIndex])
      receiptIndex += 1
    }
  })
  while (receiptIndex < ordered.length) {
    appendReceipt(ordered[receiptIndex])
    receiptIndex += 1
  }
  flushParts()
  return timeline
}

function sentImageArtifact(file: AttachmentMeta, index: number): ChatArtifact | undefined {
  if (!file.mimeType.startsWith('image/')) return undefined
  if (file.artifact?.kind === 'image') return file.artifact
  if (file.content)
    return {
      id: `sent-image-${index}-${file.name}-${file.size}`,
      name: file.name,
      mimeType: file.mimeType,
      kind: 'image',
      size: file.size,
      createdAt: 0,
      encoding: 'base64',
      content: file.content,
      source: { provider: 'user' }
    }
  if (file.originalUnavailable)
    return {
      id: `sent-image-unavailable-${index}-${file.name}-${file.size}`,
      name: file.name,
      mimeType: file.mimeType,
      kind: 'image',
      size: file.size,
      createdAt: 0,
      source: { provider: 'user' }
    }
  if (!file.thumbnail?.startsWith('data:image/')) return undefined
  return {
    id: `sent-image-${index}-${file.name}-${file.size}`,
    name: file.name,
    mimeType: file.mimeType,
    kind: 'image',
    size: file.size,
    createdAt: 0,
    url: file.thumbnail,
    source: { provider: 'utilisateur' }
  }
}

/** Le prompt utilisateur qui a DÉCLENCHÉ le tour affiché à `index` (le renvoi/reprise s'y rattache). */

export const ChatMessageRow = memo(
  function ChatMessageRow({
    message,
    conversationId,
    onInspectTurn,
    onFork,
    onOpenImage,
    onPickSuggestion,
    onOpenLiveAction,
    directiveReceipts,
    retryPrompt,
    onResend,
    onRefineResume,
    onLogin,
    askReponse,
    autoLancerCandidats,
    onAnswerAsk,
    skills,
    tourEnCours
  }: {
    message: Msg
    /**
     * Message utilisateur dont le tour court encore (`tourDuMessageEnCours`) : sa capsule
     * « Image envoyée » est alors allumée, comme l'image lue et Raisonnement / Actions du même
     * tour (conv-178) ; tour fini, elle pâlit avec elles.
     */
    tourEnCours?: boolean
    /** Skills installees : un message `/<skill>` affiche son bandeau (draft G1). */
    skills?: readonly SkillInstallee[] | null
    conversationId: string | null
    /** Prompt utilisateur à l'origine de ce tour — ce qu'on renvoie ou reprend. */
    retryPrompt?: string
    onResend?: (prompt: string) => void
    /** Pré-remplit le composer avec le prompt d'origine + le motif d'échec. N'ENVOIE RIEN. */
    onRefineResume?: (prompt: string, status: TerminalStatus, reason?: string | null) => void
    /** Reconnexion du provider, offerte a la place du renvoi quand la session a expire. */
    onLogin?: () => void
    onInspectTurn?: (target: InspectTurnTarget) => void
    onFork?: (messageId: string) => void
    onOpenImage?: (image: { src: string; name: string }) => void
    onPickSuggestion?: (prompt: string) => void
    /** Mode auto : le panneau de candidats appuie lui-meme sur son bouton avec le choix du scout. */
    autoLancerCandidats?: boolean
    onOpenLiveAction?: (mode: 'live' | 'history') => void
    directiveReceipts?: DirectiveReceipt[]
    /**
     * Le texte du message du fil qui REPOND a une question de ce tour (`askReponseDuFil`),
     * `undefined` tant qu'elle est ouverte. Il ferme le bloc ET dit quelle reponse mettre en evidence.
     */
    askReponse?: string
    /**
     * Reponse a une question `ask`. Chemin DEDIE, jamais celui des suggestions : une reponse a une
     * question est un message ORDINAIRE, pas une orientation en vol (pastille « ✓ Orienté »).
     */
    onAnswerAsk?: (prompt: string) => void
  }): React.JSX.Element {
    /*
     * BOUTONS « PROMPTER » DES BLOCS html-render (conv-302, voir bouton-prompt-html.ts) : un lien
     * `#autowin-prompt` envoie son libellé visible par le chemin d'une réponse `ask`. Mêmes règles que
     * le bloc `ask` : rien avant la fin du tour, un seul envoi (verrou synchrone au clic, puis verrou
     * DURABLE par le fil : `askReponse` reconnaît aussi le libellé d'un bouton déjà envoyé).
     */
    const promptEnvoye = useRef(false)
    const [promptParti, setPromptParti] = useState(false)
    const promptsOuverts =
      message.role === 'assistant' &&
      message.done === true &&
      askReponse === undefined &&
      onAnswerAsk !== undefined &&
      !promptParti
    const surClicPrompt = (event: React.MouseEvent<HTMLDivElement>): void => {
      const prompt = promptDuClic(event.target)
      if (prompt === null) return
      // Une ancre interne ne doit jamais changer l'adresse de l'app, bouton ouvert ou fermé.
      event.preventDefault()
      if (!promptsOuverts || promptEnvoye.current) return
      promptEnvoye.current = true
      setPromptParti(true)
      onAnswerAsk?.(prompt)
    }
    if (message.role === 'user') {
      return (
        <div className={`msg user fade-in${message.orientation ? ' is-orientation' : ''}`}>
          {/* PLUS DE LIGNE « TOI » au-dessus des messages de l'utilisateur, dans aucun theme
              (conv-227, 2026-10-11, apres la ligne « Agent »). L'en-tete ne reste que pour porter
              l'etiquette d'orientation ; l'heure passe dans la rangee de boutons sous la bulle. */}
          {/* MESSAGE INJECTE EN COURS DE TOUR (conv-257, 2026-09-04). Le drapeau `orientation`
              existait deja cote donnees, mais RIEN ne le montrait : un message tape pendant un
              tour n'ouvre pas de nouveau tour, il rejoint celui qui court -- et l'utilisateur
              concluait qu'il etait perdu (« mon dernier msg a pas lance de tour »). */}
          {message.orientation ? (
            <div className="msg-meta">
              <span
                className="msg-orientation-tag"
                title="Envoyé pendant un tour en cours : ce texte a rejoint la réponse en cours au lieu d’ouvrir un nouveau tour"
              >
                orienté en cours de tour
              </span>
            </div>
          ) : null}
          {message.content &&
            (() => {
              const entete = decouperSkill(message.content, skills)
              if (!entete)
                return (
                  <div className="msg-body msg-bulle" dir="auto">
                    {message.content}
                  </div>
                )
              return (
                <div className="msg-body msg-bulle avec-skill" dir="auto">
                  <div className="msg-skill-entete">
                    <span className="msg-skill-nom">{entete.skill}</span>
                  </div>
                  {entete.reste ? <div className="msg-skill-texte">{entete.reste}</div> : null}
                </div>
              )
            })()}
          {message.attachments && message.attachments.length > 0 && (
            <div
              className={`attachment-list sent${
                message.attachments.some((file) => sentImageArtifact(file, 0)) ? ' has-preview' : ''
              }`}
            >
              {message.attachments.map((file, fileIndex) => {
                const artifact = sentImageArtifact(file, fileIndex)
                return artifact ? (
                  <ArtifactPreview
                    key={`${file.name}-${fileIndex}`}
                    artifact={artifact}
                    displayName="image envoyée"
                    provenanceLabel="Image envoyée"
                    sourceLabel={`Envoyée · ${file.name}`}
                    previewError={
                      file.originalUnavailable
                        ? 'Image originale non conservée · stockage indisponible'
                        : undefined
                    }
                    conversationId={conversationId}
                    turnId={file.turnId}
                    onOpenImage={onOpenImage}
                    live={tourEnCours === true}
                  />
                ) : (
                  <span className="attachment-chip" key={`${file.name}-${fileIndex}`}>
                    <span aria-hidden="true">{file.mimeType.startsWith('image/') ? '▧' : '▤'}</span>
                    <span className="attachment-name">{file.name}</span>
                    <small>{formatFileSize(file.size)}</small>
                  </span>
                )
              })}
            </div>
          )}
          <div className="msg-turn-actions">
            {/* Heure d'ecriture, toujours visible au seul survol du message (`.msg:hover .msg-time`). */}
            {message.ts ? (
              <span className="msg-time" data-heure-complete={formaterHeureComplete(message.ts)}>
                {formaterHeureMessage(message.ts)}
              </span>
            ) : null}
            <CopyMessageButton message={message} />
            {message.messageId && onFork && (
              <button
                type="button"
                className="msg-turn-icon"
                title="Créer une branche à partir de ce message"
                aria-label="Créer une branche à partir de ce message"
                onClick={() => onFork(message.messageId!)}
              >
                <ForkIcon />
              </button>
            )}
          </div>
        </div>
      )
    }
    // RAIL DU TOUR (conv-338, « Implementer 1 + 5 ») : chaque element du tour devient un POINT d'un
    // rail trace a gauche du message — heures du tour a gauche (la 1), verdict des juges puis
    // reponse en bleu au bout (la 5). Calculs dans rail-du-tour.ts, dessin dans ChatView.css.
    const timeline = splitAssistantTimeline(
      // TOUR TERMINE : le bloc de cloture se lit en DERNIER, meme si une action a ete
      // declenchee apres son ecriture (demande du 2026-09-12). Pendant l'ecriture, on ne
      // touche a rien : le texte doit apparaitre dans l'ordre ou il arrive.
      message.done ? clotureEnDernier(message.parts) : message.parts,
      directiveReceipts ?? []
    )
    const blocsParElement = timeline.map((element) =>
      element.kind === 'receipt' ? [] : groupAssistantActivity(element.parts)
    )
    const reponse = placeDeLaReponse(blocsParElement, message.done)
    const debut = message.debutDuTour
    // Une colonne d'heures n'a de sens que si le tour a ete enregistre AVEC elles : un texte ou une
    // action date. Les images ont toujours eu leur heure : sur un tour d'avant le rail, elles seules
    // remplissaient la colonne, trouee partout ailleurs (conv-338, 2026-10-19). Ce tour-la se dessine
    // donc sans colonne.
    const avecHeures =
      debut !== undefined &&
      message.parts.some(
        (part) => (part.kind === 'text' || part.kind === 'action') && typeof part.at === 'number'
      )
    const noeud = (
      cle: string,
      nature: NatureDuNoeud,
      instant: number | undefined,
      contenu: React.ReactNode
    ): React.ReactNode => {
      if (contenu === null || contenu === undefined || contenu === false) return null
      const heure = avecHeures ? heureSurLeRail(instant, debut) : undefined
      return (
        <div key={cle} className="rail-noeud" data-nature={nature} data-testid="rail-noeud">
          {heure ? <span className="rail-heure">{heure}</span> : null}
          {contenu}
        </div>
      )
    }
    /* Panneau des JUGES : décisions en barre, verdict complet en dépliant — même manière que les
       candidats du scout (14/08). Rendu sous les tours qui ont orchestré, alimenté par le fil de
       sous-agents persisté du dernier run. Sur le rail, c'est l'AVANT-DERNIER point : juste avant
       la réponse (la 5 du /draft conv-338), au lieu d'un bandeau sous elle. */
    const juges =
      conversationId &&
      message.status === 'completed' &&
      message.parts.some(
        (candidate) => candidate.kind === 'action' && candidate.name === 'orchestrate'
      )
        ? noeud('juges', 'juge', undefined, <JugesPanel conversationId={conversationId} />)
        : null
    const rendreBloc = (part: ChatRenderBlock, index: number): React.ReactNode =>
      part.kind === 'text' ? (
        // Le clic ne fait qu'ÉCOUTER les liens `#autowin-prompt` du bloc html-render :
        // le clavier passe par le lien lui-même (Entrée y déclenche ce même clic).
        <div
          key={index}
          className="msg-body"
          dir="auto"
          data-prompts={promptsOuverts ? 'ouverts' : 'fermes'}
          onClick={surClicPrompt}
        >
          <Markdown
            text={part.text}
            continuationPrefix={part.markdownContinuationPrefix}
            highlightFinalSummary
          />
        </div>
      ) : part.kind === 'suggestions' ? (
        <SuggestionGrid
          key={index}
          groups={part.groups}
          onPick={(prompt) => onPickSuggestion?.(prompt)}
        />
      ) : part.kind === 'ask-decision' ? (
        /* Cle STABLE = l'identite de l'action `ask`. Avec `key={index}` le bloc etait
           remonte des que le flux se regroupait, et son verrou « deja repondu »
           repartait a zero : c'est ce qui rendait le spam-clic possible.

           LE BLOC N'EXISTE QU'UNE FOIS LE TOUR TERMINE (2026-09-02, defaut vecu :
           « le bloc ask apparait avant que le tour finisse et quand je click trop tot
           ca marche pas »). Pendant le tour, un clic passe par l'injection dans le
           tour en cours ; celle-ci n'est plus relue apres l'execution des commandes,
           et ce qui n'a pas ete lu est efface a la fermeture du tour — la reponse
           disparaissait pendant que le bloc se verrouillait sur « Repondu ». Rien a
           cliquer avant la fin = aucune reponse perdue. */
        !message.done ? null : (
          <AskDecisionBlock
            key={`ask-${part.askId}`}
            decision={part.decision}
            dejaRepondu={askReponse !== undefined}
            reponseDuFil={askReponse}
            onPick={(prompt) => onAnswerAsk?.(prompt)}
          />
        )
      ) : part.kind === 'candidats-pick' ? (
        <CandidatsPickPanel
          key={index}
          candidats={part.candidats}
          texteScout={part.texteScout}
          autoLancer={
            autoLancerCandidats === true &&
            !tourRefusePourAutoLancer(
              message.status,
              message.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : []))
            )
          }
          onPick={(prompt) => onPickSuggestion?.(prompt)}
        />
      ) : part.kind === 'error' ? (
        <ChatErrorBlock
          key={index}
          part={part}
          bilan={formaterBilan(bilanDuTour(message.parts))}
          retryPrompt={retryPrompt?.trim()}
          onResend={onResend}
          onRefineResume={onRefineResume}
          onLogin={onLogin}
        />
      ) : part.kind === 'artifact' ? (
        <ArtifactPreview
          key={part.artifact.id}
          artifact={part.artifact}
          conversationId={conversationId}
          turnId={message.turnId}
          onOpenImage={onOpenImage}
          live={!message.done}
        />
      ) : part.kind === 'artifact-pile' ? (
        <ArtifactPile
          key={`pile-${part.artifacts[0].id}`}
          artifacts={part.artifacts}
          conversationId={conversationId}
          turnId={message.turnId}
          onOpenImage={onOpenImage}
          live={!message.done}
        />
      ) : (
        <AssistantActivityGroup
          key={index}
          actions={part.actions}
          onOpenLiveAction={onOpenLiveAction}
          // Reprendre passe par le canal d'orchestration DIRECT : le main y retrouve l'acquis
          // persisté et repart à la phase suivante, sans écrire dans le fil un message que
          // l'utilisateur n'a pas tapé (le renvoi par le composer fabriquait un faux tour).
          // Le résultat est RENVOYÉ au bouton (plus de `void`) : il porte l'état de
          // chargement et rend visible un `{ok:false, error}` au lieu de le jeter.
          onResume={(task) =>
            window.api?.orchestrate?.(task, conversationId ?? undefined) ??
            Promise.resolve({ ok: false, error: 'orchestration indisponible' })
          }
        />
      )
    return (
      <div className={`msg assistant fade-in msg--rail${avecHeures ? ' avec-heures' : ''}`}>
        {/* PLUS DE LIGNE « AGENT » au-dessus de la reponse, dans aucun theme (conv-227, 2026-10-11 :
            « enleve carrement cette ligne de tous les themes elle pollue pour rien »). Son spinner
            part avec elle : le tour en cours se lit aux capsules Raisonnement / Actions et au bouton
            d'arret de la saisie. Les styles `.msg.assistant > .msg-meta` restent : l'en-tete
            « Bureau cache » de HdeskTv.tsx porte le meme balisage. */}
        {/* Le raisonnement se lit ICI, repliable, écrit en direct pendant que le modèle pense.
            L'attente AVANT le premier fragment de pensée passe par le MÊME bloc (corps vide) :
            l'ancien placeholder texte « réflexion… » etait un vestige qui court-circuitait le
            bloc depliable et donnait l'impression d'une retrogradation. */}
        {/* LES DEUX BLOCS SURVIVENT A LA FIN DU TOUR (demande du 2026-09-12 : « les blocs action et
            raisonnement doivent pas disparaitre a la fin du tour »). Avant, la condition exigeait
            `message.reasoning` des que le tour etait clos : sur un modele dont la pensee arrive
            chiffree (opus-5), tout le journal d'actions s'effacait a la seconde ou le tour finissait
            et il n'en restait aucune trace lisible dans le fil. Le journal des actions suffit donc
            desormais a garder les deux blocs. */}
        {(message.reasoning ||
          message.providerStatusLog?.length ||
          message.providerStatus ||
          (!message.done && message.parts.length === 0)) &&
          noeud(
            'tour',
            'tour',
            debut,
            <ThinkingBlock
              text={message.reasoning ?? ''}
              done={message.done}
              {...(message.providerStatus ? { status: message.providerStatus } : {})}
              {...(message.providerStatusLog?.length
                ? { statusLog: message.providerStatusLog }
                : {})}
              {...(message.turnId ? { turnId: message.turnId } : {})}
              {...(message.reasoningMs !== undefined ? { reasoningMs: message.reasoningMs } : {})}
            />
          )}
        <div className="msg-turn">
          {timeline.map((timelineItem, timelineIndex) =>
            timelineItem.kind === 'receipt' ? (
              noeud(
                `receipt-${timelineItem.receipt.id}`,
                'autre',
                undefined,
                <DirectiveReceiptRow receipt={timelineItem.receipt} />
              )
            ) : (
              <Fragment key={`parts-${timelineIndex}`}>
                {blocsParElement[timelineIndex].map((part, index) => {
                  const estReponse = reponse?.[0] === timelineIndex && reponse[1] === index
                  const point = noeud(
                    cleDuBloc(part, index),
                    estReponse ? 'reponse' : natureDuBloc(part),
                    instantDuBloc(part),
                    rendreBloc(part, index)
                  )
                  return estReponse && juges ? (
                    <Fragment key="reponse-et-juges">
                      {juges}
                      {point}
                    </Fragment>
                  ) : (
                    point
                  )
                })}
              </Fragment>
            )
          )}
          {/* Tour sans réponse écrite (orchestration seule) : le verdict reste le dernier point. */}
          {reponse ? null : juges}
        </div>
        {/* Statuts terminaux MUETS : un tour annulé, interrompu ou EN ÉCHEC ne poussait aucune
            action — la bulle restait une impasse. `failed` rejoint le bloc : sans lui, un tour
            raté n'offrait qu'un `⚠️ …` inerte, indistinguable d'un contenu modèle. */}
        {message.done &&
          (message.status === 'cancelled' ||
            message.status === 'interrupted' ||
            // Un `failed` porteur d'une part d'ERREUR structurée a déjà sa barre d'actions dans
            // le bloc d'alerte : la dupliquer ici donnerait deux « ↻ Renvoyer » côte à côte.
            (message.status === 'failed' &&
              !message.parts.some((part) => part.kind === 'error'))) &&
          (() => {
            const status = message.status as TerminalStatus
            const echoue = status === 'failed'
            const annule = status === 'cancelled'
            const prompt = retryPrompt?.trim()
            // Un tour en échec se RENVOIE (le tour n'a rien produit à poursuivre) ; un tour
            // interrompu se REPREND là où il s'est arrêté.
            const raison = terminalFailureReason(message)
            return (
              <div className="msg-terminal" data-status={message.status}>
                <span className="msg-terminal-text">
                  {echoue
                    ? 'Réponse en échec'
                    : annule
                      ? 'Réponse annulée'
                      : 'Réponse interrompue avant la fin'}
                </span>
                {prompt && echoue && onResend && (
                  <button
                    type="button"
                    className="msg-terminal-action"
                    title={`Renvoyer : ${prompt}`}
                    onClick={() => onResend(prompt)}
                  >
                    ↻ Renvoyer
                  </button>
                )}
                {/* Rejouer À L'IDENTIQUE un tour qui vient d'échouer refait le même échec. Ce
                    troisième bouton prépare une reprise INFORMÉE dans le composer — et n'envoie
                    rien : l'utilisateur précise d'abord ce qui doit changer. */}
                {prompt && echoue && onRefineResume && (
                  <button
                    type="button"
                    className="msg-terminal-action msg-terminal-refine"
                    data-testid="resume-refine"
                    title="Pré-remplir le composer avec ce prompt et le motif d’échec, sans envoyer"
                    onClick={() => onRefineResume(prompt, status, raison)}
                  >
                    ✎ Reprendre en précisant…
                  </button>
                )}
              </div>
            )
          })()}
        <div className="msg-turn-actions">
          <CopyMessageButton message={message} />
          {libelleCoutDuTour((message as { coutUsd?: number }).coutUsd) && (
            <span className="c-faint tnum msg-turn-cost" data-testid="msg-turn-cost">
              {libelleCoutDuTour((message as { coutUsd?: number }).coutUsd)}
            </span>
          )}
          {message.turnId && message.turnId !== 'pending' && conversationId && onInspectTurn && (
            <button
              type="button"
              className="msg-turn-icon"
              title="Inspecter ce tour dans l'Observatory"
              aria-label="Inspecter ce tour"
              // Un message COPIE par un fork garde son tour, mais le journal de ce tour vit dans
              // la conversation d'origine : on l'ouvre LA-BAS plutot que de chercher sous le fork.
              onClick={() =>
                onInspectTurn({
                  conversationId: message.turnConversationId ?? conversationId,
                  turnId: message.turnId!
                })
              }
            >
              <InspectIcon />
            </button>
          )}
          {message.messageId && onFork && (
            <button
              type="button"
              className="msg-turn-icon"
              title="Créer une branche à partir de ce tour"
              aria-label="Créer une branche à partir de ce tour"
              onClick={() => onFork(message.messageId!)}
            >
              <ForkIcon />
            </button>
          )}
        </div>
      </div>
    )
  },
  (prev, next) =>
    // Comparateur DATA-ONLY : la ligne ne re-rend QUE si sa donnée change (message/conversation/reçus).
    // Les props callbacks sont déjà stables (send via sendRef→pickSuggestion, fork/inspect via useCallback,
    // setters useState) → les ignorer n'introduit aucun stale et immunise la ligne contre le churn du
    // composer (frappe/ghost-text) : garantit l'invariant perf « composer change ≠ re-render des lignes ».
    prev.message === next.message &&
    prev.conversationId === next.conversationId &&
    prev.retryPrompt === next.retryPrompt &&
    prev.askReponse === next.askReponse &&
    prev.directiveReceipts === next.directiveReceipts &&
    prev.tourEnCours === next.tourEnCours
)
