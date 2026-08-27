/**
 * LE COMPOSER, ISOLÉ. Extrait de `ChatView.tsx` (conv-1466) parce qu'une frappe y coûtait un rendu
 * de la vue ENTIÈRE : listes de conversations, panneaux, fil. Symptôme mesuré par l'utilisateur —
 * les lettres n'apparaissent pas, puis tombent d'un coup.
 *
 * Le contrat de l'extraction :
 * - le TEXTE en cours de frappe (et les palettes `/` et `@`, qui n'en dépendent que) vit ICI ;
 * - les BROUILLONS restent à ChatView (une carte par conversation) : chaque frappe lui est notifiée
 *   par `onDraftInput`, qui écrit la carte SANS re-rendre la vue ;
 * - ChatView réimpose une valeur (changement de conversation, préremplissage) via le handle
 *   impératif, jamais par une prop d'état — sinon la frappe repasserait par le parent.
 *
 * Ce qui n'appartient pas au composer (pièces jointes, cadrage, friction, méta) est reçu en
 * `ReactNode` : le parent les rend, elles ne se recalculent donc pas à chaque caractère.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { matchSlashCommands, type SlashCommand } from './chat-view-model'
import {
  applyMention,
  matchMentions,
  type MentionCandidate,
  type MentionSources
} from './chat-mentions'
import { buildScopeEcho, formatScopeEcho } from './chat-scope-echo'

export interface ChatComposerHandle {
  /** Impose une valeur (brouillon rechargé, préremplissage) sans passer par un rendu du parent. */
  setInput: (value: string) => void
  focus: () => void
  /** Focus + caret placé (`-1` = fin du texte). */
  focusAt: (caret: number) => void
}

export interface ChatComposerProps {
  busy: boolean
  hasActiveConversation: boolean
  /** Le dernier tour est reprenable — le composer y ajoute « et rien n'est tapé ». */
  resumeAvailable: boolean
  attachmentCount: number
  mentionSources: MentionSources
  skillCommands: SlashCommand[]
  ghostRecommendation: string | null
  placeholderPendantTour: boolean
  /** Chaque frappe : le parent écrit son brouillon. Ne doit PAS re-rendre le parent. */
  onDraftInput: (value: string) => void
  /** Bascule vide ↔ non-vide seulement : la home en dépend, pas chaque caractère. */
  onDraftPresence: (present: boolean) => void
  /** True si le texte est un `/btw` déjà traité — le composer n'envoie alors pas. */
  onBtw: () => boolean
  onSend: () => void
  onQueue: () => void
  onResume: () => void
  onPaste: (files: FileList) => void
  attachmentsNode?: ReactNode
  errorNode?: ReactNode
  cadrageNode?: ReactNode
  frictionNode?: ReactNode
  leadingNode?: ReactNode
  stopNode?: ReactNode
  metaNode?: ReactNode
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(props, ref): React.JSX.Element {
    const [input, setInput] = useState('')
    const [slashIndex, setSlashIndex] = useState(0)
    const [slashDismissed, setSlashDismissed] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const [mentionDismissed, setMentionDismissed] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      setInput: (value: string) => setInput(value),
      focus: () => inputRef.current?.focus(),
      focusAt: (caret: number) => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        const pos = caret < 0 ? el.value.length : caret
        el.setSelectionRange(pos, pos)
      }
    }))

    // Auto-hauteur : même règle qu'avant l'extraction (180 px de plafond).
    useEffect(() => {
      const el = inputRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    }, [input])

    // Le parent n'a besoin que du BOOLÉEN « il y a un brouillon », pas de sa valeur.
    const present = input.trim().length > 0
    const presenceRef = useRef<boolean | null>(null)
    const onPresence = props.onDraftPresence
    useEffect(() => {
      if (presenceRef.current === present) return
      presenceRef.current = present
      onPresence(present)
    }, [present, onPresence])

    const scopeEcho = useMemo(
      () => buildScopeEcho(input, props.mentionSources),
      [input, props.mentionSources]
    )

    function pousserTexte(value: string): void {
      setInput(value)
      props.onDraftInput(value)
    }

    function acceptSlash(cmd: SlashCommand): void {
      pousserTexte(cmd.insert)
      setSlashIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }

    function acceptMention(candidate: MentionCandidate): void {
      const caret = inputRef.current?.selectionStart ?? input.length
      const { text, caret: nextCaret } = applyMention(input, candidate, caret)
      pousserTexte(text)
      setMentionIndex(0)
      setMentionDismissed(true)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    }

    const canResume = props.resumeAvailable && !input.trim() && props.attachmentCount === 0
    const mentions = matchMentions(input, props.mentionSources)
    const mentionsVisibles = mentionDismissed ? [] : mentions
    const slashItems = matchSlashCommands(input, props.skillCommands)
    const slashVisibles = slashDismissed ? [] : slashItems

    return (
      <div className="composer">
        <div className="composer-field">
          {props.attachmentsNode}
          {props.errorNode}
          {props.cadrageNode}
          {props.frictionNode}
          {/* Écho de PÉRIMÈTRE : ce que le tour va probablement faire, et sur quoi — AVANT
              l'envoi, pour pouvoir corriger la visée plutôt que de découvrir l'écart après. */}
          {scopeEcho && (
            <div className="composer-scope-echo" data-testid="scope-echo">
              <span aria-hidden="true">◎</span> {formatScopeEcho(scopeEcho)}
            </div>
          )}
          {mentionsVisibles.length > 0 &&
            (() => {
              const sel = Math.min(mentionIndex, mentionsVisibles.length - 1)
              return (
                <ul
                  className="slash-palette mention-palette"
                  role="listbox"
                  aria-label="Cibles"
                  data-testid="mention-palette"
                >
                  {mentionsVisibles.map((c, i) => (
                    <li
                      key={`${c.kind}:${c.id}`}
                      role="option"
                      aria-selected={i === sel}
                      className={`slash-item${i === sel ? ' is-selected' : ''}`}
                      data-testid="mention-item"
                      onMouseDown={(ev) => {
                        ev.preventDefault() // garde le focus du composer
                        acceptMention(c)
                      }}
                    >
                      <span className="slash-name mono">
                        {c.kind === 'run' ? '@run' : '@fichier'} {c.label}
                      </span>
                      {c.hint && <span className="slash-hint">{c.hint}</span>}
                    </li>
                  ))}
                </ul>
              )
            })()}
          {slashVisibles.length > 0 &&
            (() => {
              const sel = Math.min(slashIndex, slashVisibles.length - 1)
              return (
                <ul className="slash-palette" role="listbox" aria-label="Commandes">
                  {slashVisibles.map((c, i) => (
                    <li
                      key={c.name}
                      role="option"
                      aria-selected={i === sel}
                      className={`slash-item${i === sel ? ' is-selected' : ''}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault() // garde le focus du composer
                        acceptSlash(c)
                      }}
                    >
                      <span className="slash-name mono">/{c.name}</span>
                      <span className="slash-hint">{c.hint}</span>
                    </li>
                  ))}
                </ul>
              )
            })()}
          <div className="composer-input-row">
            {props.leadingNode}
            <textarea
              ref={inputRef}
              className="input grow"
              rows={1}
              value={input}
              onChange={(e) => {
                pousserTexte(e.target.value)
                setSlashDismissed(false)
                setSlashIndex(0)
                setMentionDismissed(false)
                setMentionIndex(0)
              }}
              onKeyDown={(e) => {
                // La palette de MENTIONS passe avant la slash : les deux ne peuvent pas être
                // ouvertes en même temps (une mention exclut un `/` en tête de frappe).
                if (!mentionDismissed && mentions.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIndex((i) => (i + 1) % mentions.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex((i) => (i - 1 + mentions.length) % mentions.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    acceptMention(mentions[Math.min(mentionIndex, mentions.length - 1)])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMentionDismissed(true)
                    return
                  }
                }
                if (!slashDismissed && slashItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashIndex((i) => (i + 1) % slashItems.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    acceptSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSlashDismissed(true)
                    return
                  }
                }
                // Ghost-text (CLI-like) : Tab accepte la recommandation quand le champ est vide
                // et qu'aucun menu slash n'est actif. Remplit l'input avec l'étape recommandée.
                if (e.key === 'Tab' && props.ghostRecommendation && input.trim() === '') {
                  e.preventDefault()
                  pousserTexte(props.ghostRecommendation)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (props.onBtw()) return
                  if (props.busy && props.hasActiveConversation) props.onQueue()
                  else props.onSend()
                }
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData?.files
                if (pasted && pasted.length > 0) {
                  e.preventDefault()
                  props.onPaste(pasted)
                }
              }}
              placeholder={
                props.placeholderPendantTour
                  ? 'Orienter l’agent sans l’interrompre (Entrée)'
                  : props.ghostRecommendation
                    ? `⇥ ${props.ghostRecommendation}`
                    : 'Écrire à l’agent ou déposer des fichiers…'
              }
            />
            {props.stopNode}
            <button
              className={`btn-accent btn composer-send${canResume ? ' is-resume' : ''}`}
              data-testid="composer-send"
              onClick={() => {
                if (props.onBtw()) return
                // Plus de branche « composer vide → arrêter » : Stop a son propre bouton, ce bouton
                // ne fait plus qu'une chose à la fois — reprendre, mettre en file, ou envoyer.
                if (canResume) {
                  props.onResume()
                  return
                }
                if (props.busy && props.hasActiveConversation) props.onQueue()
                else props.onSend()
              }}
              disabled={
                props.busy
                  ? !props.hasActiveConversation || !input.trim()
                  : canResume
                    ? false
                    : !input.trim() && props.attachmentCount === 0
              }
              aria-label={
                canResume
                  ? 'Reprendre la réponse'
                  : props.busy
                    ? 'Orienter l’agent sans l’interrompre'
                    : 'Envoyer le message'
              }
            >
              {canResume ? '↻ Reprendre' : props.busy ? '🧭 Orienter' : 'Envoyer'}
            </button>
          </div>
          {props.metaNode}
        </div>
      </div>
    )
  }
)
