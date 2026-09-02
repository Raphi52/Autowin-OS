/**
 * SECTION « Logs » du panneau droit : la TRACE de ce que les modèles ont fait dans la conversation
 * ouverte — appel modèle, raisonnement, commande, verdict, artefact, erreur, fin de tour.
 *
 * Deux sources, fusionnées par `buildModelActivityLog` : le journal fichier du tour (le plus
 * complet, mais nettoyé après 7 jours) et les parts persistées du message (durables). Le composant
 * ne fait QUE : charger les journaux des tours affichés, et rendre le résultat du modèle pur.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import './ModelActivityLogPane.css'
import type { Msg } from './chat-view-types'
import { HumanJson } from './HumanJson'
import { deltaMs, grouperParTour, type ModelActivityTour } from './model-activity-tours'
import {
  buildModelActivityLog,
  type ModelActivityEntry,
  type ModelActivityKind,
  type ModelActivitySource
} from './model-activity-log'

const KIND_LABEL: Record<ModelActivityKind, string> = {
  prompt: 'Demande',
  'model-call': 'Modèle',
  reasoning: 'Réflexion',
  text: 'Réponse',
  action: 'Action',
  artifact: 'Artefact',
  error: 'Erreur',
  done: 'Fin',
  injection: 'Injection',
  boundary: 'Frontière',
  usage: 'Coût',
  status: 'Signe de vie',
  brain: 'Brain',
  event: 'Journal'
}

/**
 * Nombre de lignes RENDUES par défaut. Le journal réunit désormais quatre sources et vise à
 * remplacer l'Observatory : il devient ÉNORME. Rendre tout le filtré faisait un nœud DOM par ligne
 * (mesuré : 20 000 lignes = 20 000 nœuds, plusieurs secondes de rendu). On affiche donc la FIN —
 * l'activité récente, comme le fil — et on remonte à la demande. Rien n'est perdu : le compte total
 * reste affiché et le bouton dit combien de lignes plus anciennes attendent.
 */
const FENETRE = 300

const SOURCE_LABEL: Record<ModelActivitySource, string> = {
  thread: 'fil',
  journal: 'journal',
  parts: 'persisté',
  causal: 'trace causale',
  activity: 'activité',
  brain: 'brain'
}

/** Heure locale HH:MM:SS — le journal n'écrit qu'un epoch, et parfois rien du tout. */
function heure(at?: number): string | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return new Date(at).toLocaleTimeString('fr-FR', { hour12: false })
}

/** Durée lisible d'un tour : ms sous la seconde, sinon secondes, sinon minutes. */
function duree(ms: number): string {
  if (ms < 1_000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`
}

export type ModelActivityLogPaneProps = {
  conversationId: string | null
  messages: readonly Msg[]
  /** Un tour est en cours : on recharge les journaux pour suivre l'activité vivante. */
  live?: boolean
}

export function ModelActivityLogPane({
  conversationId,
  messages,
  live
}: ModelActivityLogPaneProps): React.JSX.Element {
  const [journalByTurn, setJournalByTurn] = useState<
    Record<string, ReadonlyArray<Record<string, unknown>>>
  >({})
  const [filtre, setFiltre] = useState('')
  // Les DEUX sources que ce panneau ignorait : la trace causale (ce qu'analysait l'Observatory) et
  // le journal d'activite facturee (provider, tokens, cout, duree).
  const [causal, setCausal] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [activity, setActivity] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [kindMasque, setKindMasque] = useState<ModelActivityKind | ''>('')
  const [sourceMasquee, setSourceMasquee] = useState<ModelActivitySource | ''>('')
  const [erreursSeules, setErreursSeules] = useState(false)
  // Fenêtre d'affichage PAR sélection (conversation + filtres) : changer de filtre repart donc de
  // la taille par défaut sans le moindre effet, et revenir à une sélection retrouve sa fenêtre.
  const [fenetres, setFenetres] = useState<Record<string, number>>({})
  const listRef = useRef<HTMLDivElement | null>(null)

  // CLÉ des tours, et non le tableau `messages` : celui-ci change à CHAQUE fragment de stream, ce
  // qui relancerait la lecture des journaux des dizaines de fois par seconde.
  const turnKey = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => (message as { turnId?: string }).turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
    .join('|')

  // Chargement des journaux : à l'ouverture, quand la liste des tours change, et en boucle courte
  // tant qu'un tour est VIVANT (le journal est écrit au fil de l'eau côté main).
  useEffect(() => {
    if (!conversationId) return
    const turnIds = turnKey ? turnKey.split('|') : []
    let annule = false
    const charger = async (): Promise<void> => {
      const lecture = await Promise.all(
        turnIds.map(async (turnId) => {
          try {
            const events = (await window.api?.turnJournal?.(conversationId, turnId)) ?? []
            return [turnId, events] as const
          } catch {
            // Journal absent (nettoyé) : le tour reste tracé par ses parts durables.
            return [turnId, []] as const
          }
        })
      )
      if (annule) return
      setJournalByTurn(Object.fromEntries(lecture.filter(([, events]) => events.length > 0)))
    }
    void charger()
    if (!live)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger(), 2_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  // Trace causale et activite facturee sont scopees a la CONVERSATION (pas au tour) : une seule
  // lecture, rejouee tant qu'un tour est vivant.
  useEffect(() => {
    // Pas de reinitialisation ICI : un `setState` synchrone dans un effet cascade les rendus. Sans
    // conversation il n'y a rien a lire, et l'affichage derive de `conversationId` plus bas.
    if (!conversationId) return
    let annule = false
    const charger = async (): Promise<void> => {
      const [trace, activite] = await Promise.all([
        window.api?.causalTrace?.(conversationId).catch(() => []) ?? [],
        window.api?.conversationActivity?.(conversationId).catch(() => []) ?? []
      ])
      if (annule) return
      setCausal((trace ?? []) as ReadonlyArray<Record<string, unknown>>)
      setActivity((activite ?? []) as ReadonlyArray<Record<string, unknown>>)
    }
    void charger()
    if (!live)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger(), 4_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  const entries = useMemo(
    () =>
      buildModelActivityLog({
        messages,
        journalByTurn,
        // DERIVE, pas remis a zero par un effet : sans conversation, ces deux sources n'existent pas.
        causal: conversationId ? causal : [],
        activity: conversationId ? activity : []
      }),
    [messages, journalByTurn, causal, activity, conversationId]
  )
  const motif = filtre.trim().toLowerCase()
  const visibles = entries.filter((entry) => {
    // Le rouge d'abord : chercher un echec parmi des milliers de lignes vertes est la premiere
    // chose qu'on vient faire ici, et rien ne le permettait.
    if (erreursSeules && entry.ok !== false && entry.kind !== 'error') return false
    if (kindMasque && entry.kind !== kindMasque) return false
    if (sourceMasquee && entry.source !== sourceMasquee) return false
    if (!motif) return true
    return `${entry.label} ${entry.detail ?? ''} ${KIND_LABEL[entry.kind]} ${SOURCE_LABEL[entry.source]}`
      .toLowerCase()
      .includes(motif)
  })
  // On ne rend que la FIN de ce que le filtre retient ; le reste est atteignable par le bouton.
  const selection = `${conversationId ?? ''}|${motif}|${kindMasque}|${sourceMasquee}|${erreursSeules}`
  const fenetre = fenetres[selection] ?? FENETRE
  const affichees =
    fenetre >= visibles.length ? visibles : visibles.slice(visibles.length - fenetre)
  const plusAnciennes = visibles.length - affichees.length
  // Les gestes sont RANGES par tour : sans cet en-tete, une liste plate de milliers de lignes ne
  // dit plus quel tour a fait quoi, ni ce qu'il a coute.
  const tours = grouperParTour(affichees)
  // Les listes de filtres viennent des lignes REELLEMENT presentes : jamais une categorie vide.
  const kindsPresents = [...new Set(entries.map((entry) => entry.kind))]
  const sourcesPresentes = [...new Set(entries.map((entry) => entry.source))]

  // Le journal se lit par la FIN : l'activité récente est en bas, comme le fil.
  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [affichees.length])

  return (
    <div className="col grow model-log" style={{ minHeight: 0, gap: 'var(--s2)' }}>
      <div className="model-log-filter">
        <input
          className="input"
          type="search"
          value={filtre}
          onChange={(event) => setFiltre(event.target.value)}
          placeholder="Filtrer les logs…"
          aria-label="Filtrer les logs"
        />
        <select
          className="input"
          aria-label="Filtrer par nature"
          value={kindMasque}
          onChange={(event) => setKindMasque(event.target.value as ModelActivityKind | '')}
        >
          <option value="">Tout</option>
          {kindsPresents.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filtrer par source"
          value={sourceMasquee}
          onChange={(event) => setSourceMasquee(event.target.value as ModelActivitySource | '')}
        >
          <option value="">Toutes sources</option>
          {sourcesPresentes.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
        {/* Le compte dit ce que le filtre a retenu SUR le total : sans lui, un filtre trop etroit
            ressemble a un journal vide. */}
        <button
          type="button"
          className={`btn ghost model-log-toggle${erreursSeules ? ' is-on' : ''}`}
          aria-pressed={erreursSeules}
          data-testid="model-log-erreurs"
          onClick={() => setErreursSeules((prev) => !prev)}
          title="N’afficher que les gestes en échec"
        >
          Erreurs
        </button>
        <button
          type="button"
          className="btn ghost model-log-toggle"
          data-testid="model-log-export"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(visibles, null, 2))}
          title="Copier les lignes affichées, filtres compris, au format JSON"
        >
          Exporter
        </button>
        {entries.length > 0 && (
          <span className="model-log-count">
            {visibles.length === entries.length
              ? `${entries.length}`
              : `${visibles.length}/${entries.length}`}
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="scroll-y col grow model-log-list"
        data-testid="model-activity-log"
        style={{ minHeight: 0 }}
      >
        {visibles.length === 0 && (
          <div className="model-log-empty">
            {conversationId
              ? 'Aucune activité modèle tracée pour l’instant — chaque appel, commande, verdict et artefact s’inscrira ici.'
              : 'Sélectionne une conversation pour lire ce que les modèles y ont fait.'}
          </div>
        )}
        {plusAnciennes > 0 && (
          <button
            type="button"
            className="btn ghost model-log-more-btn"
            data-testid="model-log-plus"
            onClick={() =>
              setFenetres((prev) => ({
                ...prev,
                [selection]: (prev[selection] ?? FENETRE) + FENETRE
              }))
            }
          >
            Afficher plus ancien ({plusAnciennes})
          </button>
        )}
        {tours.map((tour) => (
          <section key={tour.turnId} className="model-log-tour" data-testid="model-log-tour">
            <details open>
              <summary className="model-log-tour__head">
                <strong>Tour {tour.index}</strong>
                <span>{heure(tour.debut) ?? '—'}</span>
                <span>{tour.entries.length} gestes</span>
                {typeof tour.dureeMs === 'number' && <span>{duree(tour.dureeMs)}</span>}
                {typeof tour.tokens === 'number' && (
                  <span>{tour.tokens.toLocaleString('fr-FR')} tokens</span>
                )}
                {typeof tour.cout === 'number' && <span>{tour.cout.toFixed(4)} $</span>}
                {tour.erreur && <span className="model-log-tour__ko">échec</span>}
              </summary>
              {tour.entries.map((entry) => (
                <LogRow key={entry.id} entry={entry} tour={tour} />
              ))}
            </details>
          </section>
        ))}

      </div>
    </div>
  )
}

function LogRow({
  entry,
  tour
}: {
  entry: ModelActivityEntry
  tour?: ModelActivityTour
}): React.JSX.Element {
  // Ecart depuis le debut du tour : l'heure absolue ne dit pas ou le temps est parti.
  const ecart = tour ? deltaMs(entry, tour) : undefined
  const dot =
    entry.ok === false
      ? 'st-err'
      : entry.ok === true
        ? 'st-ok'
        : entry.kind === 'error'
          ? 'st-err'
          : ''
  // Le detail A PLAT ne suffisait pas : les champs bruts du geste (sessionId, args, data, usage,
  // erreur, charges causales) etaient colles en une chaine. Ils sont desormais DEPLIABLES cle par
  // cle, et la ligne entiere est copiable telle qu'elle a ete lue.
  const depliable = Boolean(entry.detail || entry.fields)
  return (
    <div
      className="model-log-row"
      data-log-kind={entry.kind}
      data-log-ok={entry.ok === undefined ? undefined : String(entry.ok)}
      title={entry.turnId ? `tour ${entry.turnId}` : undefined}
    >
      <time className="model-log-time">
        {heure(entry.at) ?? '—'}
        {typeof ecart === 'number' && ecart > 0 && (
          <small className="model-log-delta">+{duree(ecart)}</small>
        )}
      </time>
      <div className="model-log-body">
        <div className="model-log-head">
          {dot ? <span className={`status-dot ${dot}`} /> : null}
          <span className="model-log-kind">{KIND_LABEL[entry.kind]}</span>
          <span className="model-log-source" data-log-source={entry.source}>
            {SOURCE_LABEL[entry.source]}
          </span>
          <span className="model-log-label">{entry.label}</span>
        </div>
        {depliable ? (
          <details className="model-log-detail" data-testid="model-log-detail">
            {/* Le detail ENTIER vit dans le summary, clampe a deux lignes par le CSS et declampe
                a l'ouverture : le texte n'est donc jamais duplique ni tronque pour de bon. */}
            <summary>{entry.detail ?? entry.label}</summary>
            <div className="model-log-expand">
              <div className="model-log-meta">
                {entry.turnId ? <span>tour {entry.turnId}</span> : null}
                <span>id {entry.id}</span>
                {typeof entry.at === 'number' ? (
                  <span>{new Date(entry.at).toISOString()}</span>
                ) : null}
                <button
                  type="button"
                  className="model-log-copy"
                  onClick={(clic) => {
                    clic.preventDefault()
                    void navigator.clipboard?.writeText(JSON.stringify(entry, null, 2))
                  }}
                >
                  Copier
                </button>
              </div>
              {entry.fields ? (
                <HumanJson className="model-log-json" value={entry.fields} />
              ) : null}
            </div>
            <span className="model-log-more" aria-hidden="true" />
          </details>
        ) : null}
      </div>
    </div>
  )
}
