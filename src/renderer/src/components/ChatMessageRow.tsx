/**
 * Ligne de message du fil (bulle utilisateur / assistant) et ses satellites, extraits de
 * `ChatView.tsx` (levier « découpe »). Déplacement PUR : aucune ligne de logique modifiée.
 *
 * Ce module est volontairement PROP-DRIVEN : il ne connaît ni l'état du composer, ni la file, ni
 * l'IPC. C'est ce qui rend tenable l'invariant perf « composer change ≠ re-render des lignes »
 * (comparateur data-only en bas de fichier).
 */
import React, { Fragment, memo } from 'react'
import { Markdown } from './Markdown'
import { SuggestionGrid } from './SuggestionGrid'
import { CandidatsPickPanel } from './CandidatsPickPanel'
import { AskDecisionBlock } from './AskDecision'
import { JugesPanel } from './JugesPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { AssistantActivityGroup } from './ChatView.parts'
import { ForkIcon, InspectIcon } from './chat-view-icons'
import { formatFileSize } from './chat-attachments'
import { groupAssistantActivity, type ChatErrorPart, type ChatPart } from './chat-view-model'
import { bilanDuTour, formaterBilan } from './bilan-tour'
import type { TerminalStatus } from './chat-resume-refine'
import type { AttachmentMeta, DirectiveReceipt, Msg } from './chat-view-types'
import type { InspectTurnTarget } from '../observatory-focus'
import type { ChatArtifact } from '../../../shared/artifacts'
import { Spinner } from './Spinner'
import { ThinkingBlock } from './ThinkingBlock'

export function DirectiveReceiptRow({ receipt }: { receipt: DirectiveReceipt }): React.JSX.Element {
  return (
    <div className={`msg user directive-receipt is-${receipt.status}`}>
      <div className="msg-meta">
        <span className="msg-role">Toi</span>
        <span className="directive-receipt-status" role="status">
          {receipt.status === 'sending' ? (
            <>
              <Spinner /> {receipt.reponse ? 'Réponse…' : 'Orientation…'}
            </>
          ) : receipt.status === 'sent' ? (
            receipt.reponse ? (
              '✓ Répondu'
            ) : (
              '✓ Reçue — l’agent répondra dans sa prochaine réponse'
            )
          ) : receipt.status === 'differee' ? (
            '⏸ Reçue — l’agent la lira à la phase suivante du run'
          ) : (
            '⚠ Échec — remis en file'
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
  onRefineResume
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
}): React.JSX.Element {
  return (
    <div className="msg-error" role="alert" data-cause={part.cause}>
      <span className="msg-error-cause">⚠️ {ERROR_CAUSE_LABEL[part.cause]}</span>
      <span className="msg-error-message">{part.message}</span>
      {bilan && (
        <span className="msg-error-bilan" data-testid="erreur-bilan">
          {bilan}
        </span>
      )}
      {retryPrompt && (onResend || onRefineResume) && (
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
    askRepondu,
    onAnswerAsk
  }: {
    message: Msg
    conversationId: string | null
    /** Prompt utilisateur à l'origine de ce tour — ce qu'on renvoie ou reprend. */
    retryPrompt?: string
    onResend?: (prompt: string) => void
    /** Pré-remplit le composer avec le prompt d'origine + le motif d'échec. N'ENVOIE RIEN. */
    onRefineResume?: (prompt: string, status: TerminalStatus, reason?: string | null) => void
    onInspectTurn?: (target: InspectTurnTarget) => void
    onFork?: (messageId: string) => void
    onOpenImage?: (image: { src: string; name: string }) => void
    onPickSuggestion?: (prompt: string) => void
    onOpenLiveAction?: (mode: 'live' | 'history') => void
    directiveReceipts?: DirectiveReceipt[]
    /** Une question de ce tour a deja sa reponse dans le fil (message utilisateur posterieur). */
    askRepondu?: boolean
    /**
     * Reponse a une question `ask`. Chemin DEDIE, jamais celui des suggestions : une reponse a une
     * question est un message ORDINAIRE, pas une orientation en vol (pastille « ✓ Orienté »).
     */
    onAnswerAsk?: (prompt: string) => void
  }): React.JSX.Element {
    if (message.role === 'user') {
      return (
        <div className={`msg user fade-in${message.orientation ? ' is-orientation' : ''}`}>
          <div className="msg-meta">
            <span className="msg-role">Toi</span>
            {/* MESSAGE INJECTE EN COURS DE TOUR (conv-257, 2026-09-04). Le drapeau `orientation`
                existait deja cote donnees, mais RIEN ne le montrait : un message tape pendant un
                tour n'ouvre pas de nouveau tour, il rejoint celui qui court -- et l'utilisateur
                concluait qu'il etait perdu (« mon dernier msg a pas lance de tour »). */}
            {message.orientation ? (
              <span className="msg-orientation-tag" title="Envoyé pendant un tour en cours : ce texte a rejoint la réponse en cours au lieu d’ouvrir un nouveau tour">
                orienté en cours de tour
              </span>
            ) : null}
          </div>
          {message.content && (
            <div className="msg-body" dir="auto">
              {message.content}
            </div>
          )}
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
          {message.messageId && onFork && (
            <div className="msg-turn-actions">
              {onFork && (
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
          )}
        </div>
      )
    }
    return (
      <div className="msg assistant fade-in">
        <div className="msg-meta">
          <span className="msg-role">Agent</span>
          {!message.done && <Spinner />}
        </div>
        {/* Le raisonnement se lit ICI, repliable, écrit en direct pendant que le modèle pense.
            L'attente AVANT le premier fragment de pensée passe par le MÊME bloc (corps vide) :
            l'ancien placeholder texte « réflexion… » etait un vestige qui court-circuitait le
            bloc depliable et donnait l'impression d'une retrogradation. */}
        {(message.reasoning ||
          (!message.done && (message.parts.length === 0 || message.providerStatus))) && (
          <ThinkingBlock
            text={message.reasoning ?? ''}
            done={message.done}
            {...(message.providerStatus ? { status: message.providerStatus } : {})}
            {...(message.providerStatusLog?.length ? { statusLog: message.providerStatusLog } : {})}
          />
        )}
        <div className="msg-turn">
          {splitAssistantTimeline(message.parts, directiveReceipts ?? []).map(
            (timelineItem, timelineIndex) =>
              timelineItem.kind === 'receipt' ? (
                <DirectiveReceiptRow
                  key={`receipt-${timelineItem.receipt.id}`}
                  receipt={timelineItem.receipt}
                />
              ) : (
                <Fragment key={`parts-${timelineIndex}`}>
                  {groupAssistantActivity(timelineItem.parts).map((part, index) =>
                    part.kind === 'text' ? (
                      <div key={index} className="msg-body" dir="auto">
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
                          dejaRepondu={askRepondu}
                          onPick={(prompt) => onAnswerAsk?.(prompt)}
                        />
                      )
                    ) : part.kind === 'candidats-pick' ? (
                      <CandidatsPickPanel
                        key={index}
                        candidats={part.candidats}
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
                      />
                    ) : part.kind === 'artifact' ? (
                      <ArtifactPreview
                        key={part.artifact.id}
                        artifact={part.artifact}
                        conversationId={conversationId}
                        turnId={message.turnId}
                        onOpenImage={onOpenImage}
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
                  )}
                  {/* Panneau des JUGES : décisions en barre, verdict complet en dépliant — même
                      manière que les candidats du scout (14/08). Rendu sous les tours qui ont
                      orchestré, alimenté par le fil de sous-agents persisté du dernier run. */}
                  {conversationId &&
                    message.status === 'completed' &&
                    message.parts.some(
                      (candidate) => candidate.kind === 'action' && candidate.name === 'orchestrate'
                    ) && <JugesPanel conversationId={conversationId} />}
                </Fragment>
              )
          )}
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
    prev.askRepondu === next.askRepondu &&
    prev.directiveReceipts === next.directiveReceipts
)
