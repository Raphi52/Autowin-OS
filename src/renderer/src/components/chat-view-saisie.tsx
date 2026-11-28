import { VueMesuree } from './VueMesuree'
import { ChatComposer, type ChatComposerHandle } from './ChatComposer'
import { CadrageHypotheses } from './CadrageHypotheses'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { texteFil, IconeInfini, type ModeleDuFil } from './chat-view-outils'
import { BoutonQuestionACote } from './QuestionACote'
import type { ChatAttachment, SendOptions } from './chat-view-types'
import type { OrchestratorAccounts } from './OrchestratorModelSelector'
import type { FrictionEchecsRepetes } from '../../../shared/friction-echecs-repetes'
import type { HypotheseDeCadrage } from '../../../shared/cadrage-confiance'
import type { MentionSources } from './chat-mentions'
import type { PropositionSuite } from '../../../shared/prompt-suivant'
import type { SlashCommand } from './chat-view-model'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** La zone de saisie du fil unique : composer, pièces jointes, cadrage, suites proposées et quota. */
export function SaisieDuFil({
  activeId,
  addFiles,
  attachmentError,
  attachments,
  autoConvs,
  autoNouveauFil,
  basculerModeAuto,
  bindingEffectif,
  busy,
  cadrageReplie,
  composerDraftKeyRef,
  composerRef,
  comptesDeConversation,
  fileInputRef,
  friction,
  ghostRecommendation,
  handleBtw,
  hypothesesCadrage,
  interruptingConversations,
  mentionSources,
  propositionsSuite,
  questionACoteOuverte,
  queueCurrentMessage,
  rendrePiecesJointesEnAttente,
  resumeAvailable,
  resumePilotTurn,
  retirerPieceJointeDuBrouillonCourant,
  runDuCadrageRef,
  send,
  setBrouillonPresent,
  setCadrageReplie,
  setDraftInput,
  setQuestionACoteOuverte,
  skillCommands,
  stopPilotTurn
}: {
  activeId: string | null
  addFiles: (
    files: FileList | File[],
    cible?: string | undefined,
    cleDeDoublon?: (fichier: { name: string; size: number }) => string
  ) => Promise<void>
  attachmentError: string | null
  attachments: ChatAttachment[]
  autoConvs: Set<string>
  autoNouveauFil: boolean
  basculerModeAuto: () => void
  bindingEffectif: ModeleDuFil | null
  busy: boolean
  cadrageReplie: Record<string, string>
  composerDraftKeyRef: React.RefObject<string>
  composerRef: React.RefObject<ChatComposerHandle | null>
  comptesDeConversation: OrchestratorAccounts | undefined
  fileInputRef: React.RefObject<HTMLInputElement | null>
  friction: FrictionEchecsRepetes | undefined
  ghostRecommendation: string | null
  handleBtw: () => boolean
  hypothesesCadrage: Record<string, HypotheseDeCadrage[]>
  interruptingConversations: Set<string>
  mentionSources: MentionSources
  propositionsSuite: PropositionSuite[]
  questionACoteOuverte: boolean
  queueCurrentMessage: () => void
  rendrePiecesJointesEnAttente: (
    fichiers: ChatAttachment[],
    retirer: (index: number) => void
  ) => React.ReactNode
  resumeAvailable: boolean
  resumePilotTurn: (cible?: string | undefined) => Promise<void>
  retirerPieceJointeDuBrouillonCourant: (fileIndex: number) => void
  runDuCadrageRef: React.RefObject<Record<string, string>>
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setBrouillonPresent: React.Dispatch<React.SetStateAction<boolean>>
  setCadrageReplie: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setDraftInput: (key: string, value: string) => void
  setQuestionACoteOuverte: React.Dispatch<React.SetStateAction<boolean>>
  skillCommands: SlashCommand[]
  stopPilotTurn: (cible?: string | undefined) => void
}): React.JSX.Element {
  return (
    <VueMesuree id="chat-saisie" bloc cle={activeId}>
      <ChatComposer
        ref={composerRef}
        busy={busy}
        hasActiveConversation={Boolean(activeId)}
        resumeAvailable={resumeAvailable}
        attachmentCount={attachments.length}
        mentionSources={mentionSources}
        skillCommands={skillCommands}
        ghostRecommendation={ghostRecommendation}
        propositionsSuite={propositionsSuite}
        placeholderPendantTour={busy && activeId !== null}
        onDraftInput={(value) => setDraftInput(composerDraftKeyRef.current, value)}
        onDraftPresence={setBrouillonPresent}
        onBtw={handleBtw}
        onSend={() => void send()}
        onQueue={() => queueCurrentMessage()}
        onResume={() => void resumePilotTurn()}
        onPaste={(files) => void addFiles(files)}
        attachmentsNode={rendrePiecesJointesEnAttente(
          attachments,
          retirerPieceJointeDuBrouillonCourant
        )}
        errorNode={
          attachmentError ? <div className="attachment-error">{attachmentError}</div> : null
        }
        cadrageNode={
          /* CADRAGE : ce sur quoi le run repose SANS l'avoir vérifié, montré pendant qu'il
               tourne. Ne bloque rien ; un clic pré-remplit le composer pour corriger. */
          activeId && hypothesesCadrage[activeId]?.length ? (
            <CadrageHypotheses
              hypotheses={hypothesesCadrage[activeId]}
              onCorriger={(amorce) => setDraftInput(composerDraftKeyRef.current, amorce)}
              replie={cadrageReplie[activeId] !== undefined}
              onBasculerRepli={() =>
                setCadrageReplie((current) => {
                  const suivant = { ...current }
                  if (suivant[activeId] !== undefined) delete suivant[activeId]
                  else suivant[activeId] = runDuCadrageRef.current[activeId] ?? ''
                  return suivant
                })
              }
            />
          ) : null
        }
        frictionNode={
          /* FRICTION : une série d'orchestrations sans livraison, visible AVANT la relance
               suivante. Ne bloque rien — la décision reste humaine. */
          friction ? (
            <div className="composer-friction" data-testid="friction-echecs-repetes" role="status">
              <span aria-hidden="true">⚠</span> {friction.message}
            </div>
          ) : null
        }
        leadingNode={
          <>
            {/* La barre des quotas ouvre la popup et detache la rangee d'outils du champ. */}
            <ModelQuotaIndicator
              provider={bindingEffectif?.provider}
              comptes={comptesDeConversation}
            />
            {/* MODE AUTO DE CE FIL — distinct du bouton global de la liste des conversations. */}
            <button
              type="button"
              className={`btn composer-auto${
                (activeId ? autoConvs.has(activeId) : autoNouveauFil) || autoConvs.has('*')
                  ? ' actif'
                  : ''
              }`}
              data-testid="composer-auto-toggle"
              aria-pressed={
                (activeId ? autoConvs.has(activeId) : autoNouveauFil) || autoConvs.has('*')
              }
              aria-label={
                autoConvs.has(activeId ?? '')
                  ? texteFil('saisie.auto.arreter')
                  : texteFil('saisie.auto')
              }
              onClick={() => basculerModeAuto()}
              title={
                autoConvs.has('*')
                  ? texteFil('saisie.auto.tous')
                  : autoConvs.has(activeId ?? '')
                    ? texteFil('saisie.auto.arreter')
                    : // « Recommandé : rien » reste en français : c'est la ligne que l'agent écrit.
                      texteFil('saisie.auto.titre')
              }
            >
              {/* Rond du mode auto, signe INFINI : « ça continue sans moi ». */}
              <IconeInfini />
            </button>
            {/* `btn` comme ∞ et le micro voisins : même fond, même survol, même état
                      désactivé. Sans elle, le trombone gardait un style à part (survol vert,
                      contour voilé) que les thèmes générés recopiaient.
                      JAMAIS DÉSACTIVÉ PENDANT UN TOUR (2026-10-13 : « ça m'empêche
                      d'upload et de préparer mon prochain prompt pendant que la conv travaille »).
                      Le glisser-déposer et le collage joignaient déjà pendant le tour ; l'envoi en
                      cours de tour emporte les pièces jointes (submitBtw, repli en file avec elles). */}
            <button
              type="button"
              className="btn attachment-button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={texteFil('saisie.joindre')}
              title={texteFil('saisie.joindre')}
            >
              <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m8.75 12.85 5.9-5.9a3.05 3.05 0 0 1 4.31 4.31l-7.42 7.42a5.05 5.05 0 0 1-7.14-7.14l7.25-7.25"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m7.55 15.45 7.16-7.16a1.25 1.25 0 0 1 1.77 1.77l-6.12 6.12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {activeId && (
              <BoutonQuestionACote
                ouvert={questionACoteOuverte}
                onBasculer={() => setQuestionACoteOuverte((ouverte) => !ouverte)}
              />
            )}
            <input
              ref={fileInputRef}
              className="attachment-input"
              type="file"
              multiple
              onChange={(event) => {
                if (event.currentTarget.files) void addFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </>
        }
        stopNode={
          /*
              ARRÊTER ne doit dépendre de RIEN d'autre que « un tour est en cours » : ni du texte
              tapé, ni d'un état accessoire. Stop a donc son propre bouton, et il reste dans le
              parent — il ne dépend pas de la frappe.
            */
          busy ? (
            <button
              className="btn composer-stop"
              data-testid="composer-stop"
              onClick={() => stopPilotTurn()}
              disabled={!activeId || interruptingConversations.has(activeId ?? '')}
              aria-label={texteFil('saisie.arreterReponse')}
              title={texteFil('saisie.arreterReponse.titre')}
            >
              <span className="composer-btn-glyph" aria-hidden="true">
                ■
              </span>
              <span className="composer-btn-label">
                {/* « Stop » s'écrit pareil en anglais. */}
                {interruptingConversations.has(activeId ?? '') ? texteFil('saisie.arret') : 'Stop'}
              </span>
            </button>
          ) : null
        }
        metaNode={
          <div className="composer-meta">
            <span className="composer-hint">{texteFil('saisie.aide')}</span>
          </div>
        }
      />
    </VueMesuree>
  )
}
