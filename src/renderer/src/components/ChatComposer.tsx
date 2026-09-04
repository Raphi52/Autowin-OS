/**
 * LE COMPOSER, ISOLÉ. Extrait de `ChatView.tsx` (conv-1466) parce qu'une frappe y coûtait un rendu
 * de la vue ENTIÈRE : listes de conversations, panneaux, fil. Symptôme mesuré par l'utilisateur —
 * les lettres n'apparaissent pas, puis tombent d'un coup.
 *
 * Le contrat de l'extraction :
 * - le TEXTE en cours de frappe (et les palettes `/` et `;`, qui n'en dépendent que) vit ICI ;
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
import {
  Dictee,
  GAIN_MAX,
  GAIN_MIN,
  dependancesDicteeNavigateur,
  insererDictee,
  type EtatDictee
} from './composer-dictee'

/** Où le volume de capture est mémorisé : un micro trop faible doit se régler UNE fois, pas à chaque dictée. */
const CLE_GAIN_DICTEE = 'autowin.dictee.gain'

function gainMemorise(): number {
  try {
    const brut = Number(window.localStorage?.getItem(CLE_GAIN_DICTEE))
    if (Number.isFinite(brut) && brut >= GAIN_MIN && brut <= GAIN_MAX) return brut
  } catch {
    // Stockage indisponible (fenêtre restreinte) : on retombe sur le son du micro tel quel.
  }
  return 1
}

/** Le pont vers la transcription LOCALE (whisper.cpp), exposé par le préchargement. */
interface ApiWhisper {
  whisperTranscrire?: (w: Uint8Array) => Promise<string>
  whisperEtat?: () => Promise<{ installe: boolean }>
}
const apiWhisper = (): ApiWhisper | undefined => (window as unknown as { api?: ApiWhisper }).api

const pontWhisper = (): ((wav: Uint8Array) => Promise<string>) | undefined => {
  const api = apiWhisper()
  return api?.whisperTranscrire ? api.whisperTranscrire.bind(api) : undefined
}

/**
 * WHISPER EST-IL INSTALLÉ ? La seule présence de la fonction du pont ne le dit PAS : le processus
 * principal refuse de transcrire tant que le binaire et le modèle ne sont pas là
 * (`whisper-local.ts`, `transcrire`). Sans cette lecture, le micro s'ouvrait pour rien et l'échec
 * ressortait en « Rien n'a été reconnu » — un message faux.
 * Rend `null` quand l'état est illisible (pont absent) : on ne bloque pas sur une inconnue.
 */
async function whisperInstalle(): Promise<boolean | null> {
  const api = apiWhisper()
  if (!api?.whisperEtat) return null
  try {
    return (await api.whisperEtat()).installe === true
  } catch {
    return null
  }
}

/** Le texte affiché quand la reconnaissance vocale n'est pas installée sur le poste. */
const DICTEE_NON_INSTALLEE =
  'Reconnaissance vocale non installée — installez-la depuis les enregistrements parlés.'

/**
 * ICÔNES DU MICRO — dessinées, pas des emojis.
 *
 * DEMANDE DE L'UTILISATEUR (2026-09-02) : « l'icone est pourri, mets en un autre ». Un emoji 🎤 est
 * rendu par la police du système : couleur imposée, trait épais, taille imprévisible. Ces tracés
 * suivent `currentColor` (donc la couleur du bouton : neutre au repos, rouge en écoute) et restent
 * nets à 15 px comme à 13 px en mosaïque.
 */
function IconeMicroTrait(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </g>
    </svg>
  )
}

/** ENVOYER : une flèche dessinée d'un trait, même graisse que le micro et l'arrêt. */
function IconeEnvoyer(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 19V6" />
      <path d="m6 11.5 6-6 6 6" />
    </svg>
  )
}

/** Le carré d'arrêt : même trait, même graisse que le micro. */
function IconeArret(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  )
}

/** Les trois points de la transcription en cours. */
function IconeTranscription(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <circle cx="6" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="18" cy="12" r="1.8" />
      </g>
    </svg>
  )
}

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
  /**
   * LA JAUGE DE CONTEXTE, PEINTE SUR LE FILET AU-DESSUS DU CHAMP (demande utilisateur conv-240,
   * « joindre l'utile a l'agreable », reference claude.exe). Part occupee de la fenetre du modele,
   * entre 0 et 1. `undefined` = on ne SAIT pas (fenetre non declaree, entree non mesuree) : le
   * filet reste alors gris, il ne montre PAS 0 % — ce serait affirmer que le fil est vide.
   */
  contextRatio?: number
  /** Palier deja decide par `contextGauge()` : la vue peint, elle ne juge pas. */
  contextLevel?: 'ok' | 'tendu' | 'critique'
  /** Libelle de survol, ecrit par le parent qui detient les nombres. */
  contextTitle?: string
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

    /**
     * DICTÉE (micro) — même bouton pour le chat plein et la mosaïque : elles partagent CE composer.
     * Le texte reconnu repasse par `pousserTexte`, sinon le brouillon tenu par le parent serait
     * perdu au changement de conversation.
     */
    const [dicteeEtat, setDicteeEtat] = useState<EtatDictee>('inactif')
    const [dicteeErreur, setDicteeErreur] = useState<string | null>(null)
    /**
     * APERÇU EN COURS DE PHRASE — texte PROVISOIRE, jamais inséré dans le champ : il est remplacé au
     * rafraîchissement suivant, puis effacé quand la phrase finie est écrite pour de bon. Sans lui,
     * quelqu'un qui parle sans pause voit un champ vide et croit que le micro est mort.
     */
    const [dicteeApercu, setDicteeApercu] = useState('')
    /** Niveau du micro (0..1) : c'est le SEUL signe visible que la voix entre pendant qu'on parle. */
    const [dicteeNiveau, setDicteeNiveau] = useState(0)
    /** Volume de capture, réglable pendant qu'on parle : lu à chaque bloc audio via `dicteeGainRef`. */
    const [dicteeGain, setDicteeGain] = useState(gainMemorise)
    const dicteeGainRef = useRef(dicteeGain)
    dicteeGainRef.current = dicteeGain
    const dicteeRef = useRef<Dictee | null>(null)
    // `null` = pas encore su. Le bouton n'est barré que sur un « non » LU, jamais sur une inconnue.
    const [dicteeInstallee, setDicteeInstallee] = useState<boolean | null>(null)
    // Démonter la vue ne doit pas laisser un micro ouvert.
    useEffect(() => () => dicteeRef.current?.annuler(), [])
    useEffect(() => {
      let vivant = true
      void whisperInstalle().then((etat) => {
        if (!vivant) return
        setDicteeInstallee(etat)
        if (etat === false) setDicteeErreur(DICTEE_NON_INSTALLEE)
      })
      return () => {
        vivant = false
      }
    }, [])

    /**
     * ÉCRIRE DANS LE CHAMP au fil de la parole. La valeur est LUE dans le champ à cet instant, pas
     * capturée au clic : l'utilisateur peut taper pendant que le micro tourne.
     */
    function ecrireDictee(texte: string): void {
      if (texte === '') return
      const el = inputRef.current
      const courant = el?.value ?? input
      const caret = el?.selectionStart ?? courant.length
      const suivant = insererDictee(courant, texte, caret)
      pousserTexte(suivant.texte)
      requestAnimationFrame(() => {
        const champ = inputRef.current
        if (!champ) return
        champ.focus()
        champ.setSelectionRange(suivant.caret, suivant.caret)
      })
    }

    async function basculerDictee(): Promise<void> {
      if (dicteeEtat === 'transcription') return
      if (dicteeEtat === 'ecoute') {
        setDicteeEtat('transcription')
        const dictee = dicteeRef.current
        // La FIN de phrase restée dans le tampon ; les phrases précédentes sont déjà écrites.
        const texte = (await dictee?.arreter()) ?? ''
        dicteeRef.current = null
        setDicteeApercu('')
        setDicteeEtat('inactif')
        setDicteeNiveau(0)
        if (texte === '') {
          if (dictee?.aDejaEcrit !== true) setDicteeErreur('Rien n’a été reconnu.')
          return
        }
        ecrireDictee(texte)
        return
      }
      const transcrire = pontWhisper()
      if (!transcrire) {
        setDicteeErreur('Reconnaissance vocale indisponible.')
        return
      }
      // Re-lecture au clic : l'installation a pu se faire depuis l'ouverture de la vue.
      const installee = await whisperInstalle()
      setDicteeInstallee(installee)
      if (installee === false) {
        setDicteeErreur(DICTEE_NON_INSTALLEE)
        return
      }
      const dictee = new Dictee(
        dependancesDicteeNavigateur(
          transcrire,
          (texte) => {
            // Micro encore ouvert : le texte apparaît dans la barre de prompt pendant qu'on parle.
            if (dicteeRef.current === dictee) {ecrireDictee(texte); setDicteeApercu('');}
          },
          (apercu) => {
            if (dicteeRef.current === dictee) setDicteeApercu(apercu)
          },
          (niveau) => {
            if (dicteeRef.current === dictee) setDicteeNiveau(niveau)
          },
          () => dicteeGainRef.current
        )
      )
      dicteeRef.current = dictee
      setDicteeErreur(null)
      setDicteeApercu('')
      setDicteeNiveau(0)
      setDicteeEtat('ecoute')
      if (!(await dictee.demarrer())) {
        dicteeRef.current = null
        setDicteeEtat('inactif')
        setDicteeNiveau(0)
        setDicteeErreur('Micro indisponible.')
      }
    }

    const canResume = props.resumeAvailable && !input.trim() && props.attachmentCount === 0
    const mentions = matchMentions(input, props.mentionSources)
    const mentionsVisibles = mentionDismissed ? [] : mentions
    const slashItems = matchSlashCommands(input, props.skillCommands)
    const slashVisibles = slashDismissed ? [] : slashItems

    return (
      <div
        className="composer"
        /* Le filet qui separe le fil du champ EST la jauge : aucun element ajoute, aucune place
           prise. La var reste absente quand l'occupation est inconnue -> filet gris inchange. */
        style={
          props.contextRatio != null
            ? ({
                '--context-fill': `${Math.min(100, Math.max(0, props.contextRatio * 100))}%`
              } as React.CSSProperties)
            : undefined
        }
        data-context-level={props.contextRatio != null ? (props.contextLevel ?? 'ok') : undefined}
        data-testid="composer-context-rule"
        title={props.contextRatio != null ? props.contextTitle : undefined}
      >
        <div className="composer-field">
          {props.attachmentsNode}
          {props.errorNode}
          {props.cadrageNode}
          {props.frictionNode}
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
                        {c.kind === 'run' ? ';run' : ';fichier'} {c.label}
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
            {/*
              APERCU DE DICTEE, EN GRIS, DANS LE CHAMP LUI-MEME.
              Un textarea natif ne sait pas afficher deux couleurs : le texte provisoire est donc
              peint par un calque pose EXACTEMENT sur le champ (memes police, taille et marges),
              ou le texte deja saisi est rendu invisible pour reserver sa place, et seul l'apercu
              se voit. Le calque ne recoit aucun clic : le curseur reste dans le vrai champ.
            */}
            {dicteeApercu !== '' && dicteeEtat === 'ecoute' ? (
              <div
                className="composer-dictee-apercu"
                data-testid="composer-dictee-apercu"
                aria-hidden="true"
              >
                <span className="composer-dictee-apercu-place">{input}</span>
                <span className="composer-dictee-apercu-texte">
                  {input !== '' && !input.endsWith(' ') ? ' ' : ''}
                  {dicteeApercu}
                </span>
              </div>
            ) : null}
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
            <button
              type="button"
              className={`btn composer-dictee${dicteeEtat === 'ecoute' ? ' is-recording' : ''}${
                dicteeEtat === 'transcription' ? ' is-transcribing' : ''
              }`}
              data-testid="composer-dictee"
              onClick={() => void basculerDictee()}
              disabled={dicteeEtat === 'transcription' || dicteeInstallee === false}
              aria-pressed={dicteeEtat === 'ecoute'}
              aria-label={
                dicteeEtat === 'ecoute'
                  ? 'Arrêter la dictée et transcrire'
                  : dicteeEtat === 'transcription'
                    ? 'Transcription en cours'
                    : 'Dicter au micro'
              }
              title={
                dicteeInstallee === false
                  ? DICTEE_NON_INSTALLEE
                  : (dicteeErreur ??
                    (dicteeEtat === 'ecoute'
                      ? 'Arrêter la dictée'
                      : 'Dicter au micro (Whisper local)'))
              }
            >
              {dicteeEtat === 'transcription' ? (
                <IconeTranscription />
              ) : dicteeEtat === 'ecoute' ? (
                <IconeArret />
              ) : (
                <IconeMicroTrait />
              )}
            </button>
            {dicteeEtat === 'ecoute' ? (
              <span
                className="composer-dictee-niveau"
                data-testid="composer-dictee-niveau"
                // Niveau brut ×4 : la parole normale vit vers 0,05-0,25 en valeur efficace, une
                // barre à l'échelle 1 resterait plate et ne prouverait rien à l'oeil.
                style={{ '--niveau': String(Math.min(1, dicteeNiveau * 4)) } as React.CSSProperties}
                title={`Niveau du micro · volume ×${dicteeGain.toFixed(1)}`}
              >
                <i aria-hidden="true" />
                {/* Le réglage VIT SUR la barre verticale : curseur vertical transparent posé
                    dessus, pas une seconde barre horizontale à côté (demande du 2026-09-03). */}
                <input
                  type="range"
                  className="composer-dictee-gain"
                  data-testid="composer-dictee-gain"
                  min={GAIN_MIN}
                  max={GAIN_MAX}
                  step={0.1}
                  value={dicteeGain}
                  onChange={(e) => {
                    const valeur = Number(e.target.value)
                    setDicteeGain(valeur)
                    try {
                      window.localStorage?.setItem(CLE_GAIN_DICTEE, String(valeur))
                    } catch {
                      // Réglage non mémorisé : il vaut quand même pour la dictée en cours.
                    }
                  }}
                  aria-label="Volume de capture du micro"
                  title={`Volume de capture : ×${dicteeGain.toFixed(1)}`}
                />
              </span>
            ) : null}
            {props.metaNode}
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
              <span className="composer-btn-glyph" aria-hidden="true">
                {canResume ? '↻' : <IconeEnvoyer />}
              </span>
              <span className="composer-btn-label">
                {canResume ? 'Reprendre' : props.busy ? 'Orienter' : 'Envoyer'}
              </span>
            </button>
          </div>
          {dicteeErreur ? (
            <div
              className="composer-dictee-message"
              data-testid="composer-dictee-message"
              role="status"
            >
              {dicteeErreur}
            </div>
          ) : null}
        </div>
      </div>
    )
  }
)
