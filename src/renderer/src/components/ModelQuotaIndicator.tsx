import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  ModelQuota,
  ModelQuotaLevel,
  ModelQuotaSnapshot,
  ModelQuotaWindow
} from '../../../shared/model-quotas'
import type { ContextGauge } from '../../../shared/context-gauge'
import './ModelQuotaIndicator.css'

const providerLabels: Record<string, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
  kimi: 'Kimi'
}

function windowKey(window: ModelQuotaWindow): string {
  return `${window.id}\0${window.modelFamily ?? ''}`
}

function quotasByProvider(models: readonly ModelQuota[]): ModelQuota[] {
  const providers = new Map<string, ModelQuota>()
  for (const model of models) {
    const current = providers.get(model.provider)
    if (!current) {
      providers.set(model.provider, {
        ...model,
        modelId: model.provider,
        label: providerLabels[model.provider] ?? model.provider,
        windows: [...model.windows]
      })
      continue
    }
    const knownWindows = new Set(current.windows.map(windowKey))
    for (const window of model.windows) {
      const key = windowKey(window)
      if (!knownWindows.has(key)) {
        current.windows.push(window)
        knownWindows.add(key)
      }
    }
  }
  return [...providers.values()]
}

/**
 * Fenêtre que la barre doit RÉSUMER pour un provider donné.
 *
 * Par défaut la fenêtre courte (5 h) : c'est elle qui bloque l'utilisateur MAINTENANT, et un weekly
 * plus bas ne doit pas alarmer sur une capacité immédiate disponible.
 *
 * ChatGPT (codex) est l'exception : sur ces offres, c'est le quota HEBDOMADAIRE qui contraint
 * réellement l'usage — la 5 h se recharge dans la demi-journée alors que le 7 j, lui, dicte ce qui
 * reste utilisable sur la semaine. Afficher la 5 h y donnait une wheel rassurante et sans rapport
 * avec la limite qu'on atteint vraiment.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec cet indicateur
export function summaryWindowId(provider: string | undefined): string {
  return provider === 'codex' ? 'seven-day' : 'five-hour'
}

/**
 * Libellé court d'une fenêtre, dérivé de son ID — PAS du provider.
 *
 * Cause du bug corrigé : l'ancien `summaryWindowLabel(provider)` annonçait « 7 j » dès que le provider
 * était `codex`, alors que `summaryForProvider` a un REPLI vers la fenêtre courte quand la 7 j n'est pas
 * exposée (déclencheur constaté : compte ChatGPT dont l'échantillon n'expose que `five-hour` — premiers
 * événements d'une session, ou offre sans weekly). La wheel montrait donc 37 % de la 5 h en affirmant
 * « 7 j » : l'utilisateur calibrait sa SEMAINE sur un chiffre qui se recharge en une demi-journée.
 * Le libellé doit venir de la fenêtre RETENUE, jamais de l'intention.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec cet indicateur
export function windowIdLabel(windowId: string | undefined): string {
  if (windowId === 'seven-day') return '7 j'
  if (windowId === 'five-hour') return '5 h'
  return windowId ?? 'fenêtre inconnue'
}

/**
 * Nom NEUTRE de la fenêtre voulue, pour signaler un repli sans jamais écrire « 7 j » à côté d'un
 * chiffre qui n'est pas le weekly : un lecteur pressé (ou une capture) ne retiendrait que « 7 j ».
 */
function wantedWindowName(windowId: string): string {
  return windowId === 'seven-day' ? 'hebdo' : 'court terme'
}

function levelOf(remainingPercent: number): ModelQuotaLevel {
  return remainingPercent <= 10 ? 'critical' : remainingPercent <= 30 ? 'warning' : 'healthy'
}

/**
 * Résumé destiné à la barre : la VALEUR (fenêtre voulue) est dissociée du STATUT d'alerte.
 * `windowLabel` décrit ce qui est réellement mesuré ; `statusWindowLabel` nomme la fenêtre qui dicte
 * la couleur quand ce n'est pas celle affichée.
 */
export interface QuotaWheelSummary {
  remainingPercent?: number
  status: ModelQuotaLevel
  /** Fenêtre réellement RETENUE pour le chiffre affiché (déjà libellée). */
  windowLabel: string
  /** Renseignée seulement si une AUTRE fenêtre est plus sévère que celle affichée. */
  statusWindowLabel?: string
}

// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec cet indicateur
export function summaryForProvider(
  snapshot: ModelQuotaSnapshot | undefined,
  provider: string | undefined
): QuotaWheelSummary | undefined {
  const wantedId = summaryWindowId(provider)
  if (!snapshot || !provider) {
    if (!snapshot?.summary) return undefined
    return { ...snapshot.summary, windowLabel: windowIdLabel(wantedId) }
  }
  // `stale` compte AUSSI : chez ChatGPT (codex) le quota vient d'un fichier local ecrit par la CLI,
  // donc il depasse les 15 min de fraicheur des qu'on n'utilise pas Codex — l'exclure laissait la
  // wheel GRISE (`unknown`) alors que le popover affichait bien le 7 j. Seul `unavailable` (aucune
  // mesure) reste hors du resume.
  const summarizable = snapshot.models
    .filter((model) => model.provider === provider && model.status !== 'unavailable')
    .flatMap((model) => model.windows.filter((window) => window.limitKnown !== false))
  // Repli assume : la fenetre voulue absente (provider qui ne l'expose pas encore) -> minimum de ce
  // qui est connu, comportement historique prudent plutot qu'une barre vide.
  const preferred = summarizable.filter((window) => window.id === wantedId)
  const fellBack = preferred.length === 0
  const pool = fellBack ? summarizable : preferred
  if (pool.length === 0) return { status: 'unknown', windowLabel: windowIdLabel(wantedId) }
  // La fenêtre RETENUE est celle qui porte le minimum : c'est elle que le chiffre décrit, donc c'est
  // elle qui doit être libellée (cf. `windowIdLabel`).
  const retained = pool.reduce((low, window) =>
    window.remainingPercent < low.remainingPercent ? window : low
  )
  const minimum = retained.remainingPercent
  // Statut DISSOCIÉ de la valeur : sur le chemin nominal codex la barre affiche le 7 j (voulu), mais
  // une 5 h à 2 % bloque l'utilisateur MAINTENANT — la couleur ne doit pas rassurer pendant ce temps.
  //
  // MAIS on n'agrège PAS toutes les fenêtres : un weekly bas ne bloque rien dans l'immédiat, et faire
  // rougir la wheel pour lui contredirait la justification d'origine (cf. `summaryWindowId` : « un
  // weekly plus bas ne doit pas alarmer sur une capacité immédiate disponible »). Une première version
  // de ce correctif prenait le minimum de TOUTES les fenêtres et rendait donc la wheel Claude rouge
  // sur un 7 j bas — régression silencieuse contre une décision assumée.
  //
  // On retient donc exactement deux fenêtres : celle AFFICHÉE (le chiffre doit être cohérent avec sa
  // couleur) et la fenêtre COURTE (la seule qui bloque MAINTENANT).
  const blocking = summarizable.filter(
    (window) => window.id === retained.id || window.id === 'five-hour'
  )
  const severest = blocking.reduce((low, window) =>
    window.remainingPercent < low.remainingPercent ? window : low
  )
  const windowLabel = fellBack
    ? `${windowIdLabel(retained.id)} — ${wantedWindowName(wantedId)} non exposée`
    : windowIdLabel(retained.id)
  return {
    remainingPercent: minimum,
    status: levelOf(severest.remainingPercent),
    windowLabel,
    ...(severest.id !== retained.id && levelOf(severest.remainingPercent) !== levelOf(minimum)
      ? { statusWindowLabel: windowIdLabel(severest.id) }
      : {})
  }
}

function resetLabel(window: ModelQuotaWindow): string {
  if (!window.resetsAt) return 'reset non exposé'
  const date = new Date(window.resetsAt)
  if (!Number.isFinite(date.valueOf())) return 'reset non exposé'
  return `reset ${date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

function observedLabel(observedAt: string | undefined, stale: boolean): string {
  if (!observedAt) return ''
  const date = new Date(observedAt)
  if (!Number.isFinite(date.valueOf())) return ''
  return `${stale ? 'Mesure ancienne' : 'Mesuré'} ${date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

/**
 * La jauge de CONTEXTE, rendue dans la popup — ou RIEN.
 *
 * `undefined` signifie « on ne sait pas » (fenêtre du modèle non déclarée, ou entrée non mesurée) :
 * on n'affiche alors aucune barre. Un 0 % affirmerait « ce fil est vide » là où la vérité est
 * « on l'ignore » — même discipline que dans ChatView, d'où vient cette jauge.
 */
function ContextGaugeRow({
  gauge,
  onCompact,
  busy
}: {
  gauge?: ContextGauge
  onCompact?: () => void
  busy?: boolean
}): React.JSX.Element | null {
  if (!gauge) return null
  const pourcent = Math.round(gauge.ratio * 100)
  const titre =
    `Contexte : ${gauge.used.toLocaleString('fr-FR')} tokens sur ` +
    `${gauge.limit.toLocaleString('fr-FR')} (${pourcent} %), dont ` +
    `${gauge.cacheRead.toLocaleString('fr-FR')} relus du cache.`
  return (
    <article
      className={`model-quota-row quota-context-gauge is-${gauge.level}`}
      data-testid="quota-context-gauge"
      aria-label={titre}
      title={titre}
    >
      <div className="model-quota-name">
        <span>
          <strong>Contexte de cette conversation</strong>
          <small>
            {gauge.used.toLocaleString('fr-FR')} / {gauge.limit.toLocaleString('fr-FR')} tokens ·{' '}
            {gauge.cacheRead.toLocaleString('fr-FR')} relus du cache
          </small>
        </span>
      </div>
      <div className="model-quota-window">
        <div className="quota-context-gauge-track" aria-hidden="true">
          <i className="quota-context-gauge-fill" style={{ width: `${pourcent}%` }} />
        </div>
        <strong className="model-quota-values">
          <span>{pourcent} % occupé</span>
          <small>fenêtre du modèle servi</small>
        </strong>
        {/* Le bouton n'existe QUE si l'occupation est MESURÉE (on est déjà dans `gauge`) et qu'un
            gestionnaire est câblé : proposer de compacter un fil dont on ignore le remplissage, ou
            sans destinataire, serait un bouton qui ment. */}
        {onCompact && (
          <button
            type="button"
            className="quota-context-compact"
            data-testid="quota-context-compact"
            disabled={busy === true}
            title={
              busy === true
                ? 'Compaction indisponible : un tour est déjà en cours'
                : 'Demander à l’agent un résumé dense du fil, puis repartir de ce résumé'
            }
            onClick={onCompact}
          >
            Compacter
          </button>
        )}
      </div>
    </article>
  )
}

export function ModelQuotaIndicator({
  provider,
  contextGauge,
  onCompact,
  busy
}: {
  provider?: string
  contextGauge?: ContextGauge
  /** Absent = AUCUN bouton Compacter : la popup ne fabrique pas une action sans destinataire. */
  onCompact?: () => void
  busy?: boolean
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ModelQuotaSnapshot>()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)
  const requestSequenceRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (typeof window.api?.modelQuotas !== 'function') {
      setError('Redémarrage requis pour activer les quotas')
      return
    }
    const requestSequence = ++requestSequenceRef.current
    setLoading(true)
    setError(undefined)
    try {
      const value = await window.api.modelQuotas(true)
      if (requestSequence === requestSequenceRef.current) setSnapshot(value)
    } catch (failure) {
      if (requestSequence === requestSequenceRef.current) {
        setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (typeof window.api?.modelQuotas !== 'function') return
    const load = (): void => {
      const requestSequence = ++requestSequenceRef.current
      void window.api
        .modelQuotas()
        .then((value) => {
          if (active && requestSequence === requestSequenceRef.current) {
            setSnapshot(value)
            setError(undefined)
          }
        })
        .catch((failure: unknown) => {
          if (active && requestSequence === requestSequenceRef.current) {
            setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
          }
        })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const summary = summaryForProvider(snapshot, provider)
  const remaining = summary?.remainingPercent
  const level = summary?.status ?? 'unknown'
  // Le libellé vient du résumé (fenêtre RETENUE), jamais du provider : au repli il dit « 5 h ».
  const windowLabel = summary?.windowLabel ?? windowIdLabel(summaryWindowId(provider))
  const alert = summary?.statusWindowLabel ? ` · ${summary.statusWindowLabel} plus contrainte` : ''
  const providerQuotas = quotasByProvider(snapshot?.models ?? [])
  return (
    <div className="model-quota" ref={rootRef}>
      <button
        type="button"
        className={`model-quota-trigger is-${level}`}
        data-testid="model-quota-trigger"
        style={{ '--quota-fill': `${remaining ?? 0}%` } as CSSProperties}
        aria-label={
          remaining === undefined
            ? 'Afficher les quotas fournisseurs'
            : `Afficher les quotas fournisseurs, ${Math.round(remaining)} % restant sur ${windowLabel}${alert}`
        }
        aria-expanded={open}
        title={`Quotas par fournisseur — barre sur ${windowLabel}${alert}`}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void refresh()
        }}
      >
        <span className="model-quota-bar" aria-hidden="true">
          <i className="model-quota-bar-fill" />
        </span>
        <span className="model-quota-bar-value">
          {remaining === undefined ? '···' : Math.round(remaining)}
        </span>
      </button>
      {open && (
        <section
          className="model-quota-popover"
          data-testid="model-quota-popover"
          aria-label="Quotas par fournisseur"
        >
          <header>
            <div>
              <strong>Quotas fournisseurs</strong>
              <small>
                {error
                  ? 'Indisponible'
                  : snapshot
                    ? `Actualisé ${new Date(snapshot.observedAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}`
                    : 'Lecture en cours'}
              </small>
            </div>
            <button
              type="button"
              aria-label="Actualiser les quotas"
              aria-busy={loading}
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? '…' : '↻'}
            </button>
          </header>
          {error && <p className="model-quota-error">{error}</p>}
          <div className="model-quota-list">
            <ContextGaugeRow
              gauge={contextGauge}
              busy={busy}
              onCompact={
                onCompact
                  ? () => {
                      setOpen(false)
                      onCompact()
                    }
                  : undefined
              }
            />
            {providerQuotas.map((model) => (
              <article key={model.modelId} className="model-quota-row">
                <div className="model-quota-name">
                  <span>
                    <strong>{model.label}</strong>
                    <small>
                      {model.source}
                      {model.observedAt
                        ? ` · ${observedLabel(model.observedAt, model.status === 'stale')}`
                        : ''}
                    </small>
                  </span>
                </div>
                {model.windows.length === 0 ? (
                  <div className="model-quota-unavailable">
                    Non exposé
                    {model.error && <small>{model.error}</small>}
                  </div>
                ) : (
                  model.windows.map((window) => (
                    <div className="model-quota-window" key={windowKey(window)}>
                      <span>
                        <b>
                          {window.label}
                          <em className="model-quota-scope">
                            {window.modelFamily
                              ? `Spécifique ${window.modelFamily}`
                              : 'Quota partagé'}
                          </em>
                        </b>
                        <small>{resetLabel(window)}</small>
                      </span>
                      {window.limitKnown === false ? (
                        // Aucun plafond officiel exposé (mesure locale) : afficher les tokens
                        // CONSOMMÉS, jamais une jauge de « restant » qui serait inventée.
                        <strong className="model-quota-values">
                          <span>
                            {(window.usedTokens ?? 0).toLocaleString('fr-FR')} tokens consommés
                          </span>
                          <small>plafond non exposé par le fournisseur</small>
                        </strong>
                      ) : (
                        <>
                          <div className="model-quota-meter" aria-hidden="true">
                            <i style={{ width: `${window.remainingPercent}%` }} />
                          </div>
                          <strong className="model-quota-values">
                            <span>{Math.round(window.remainingPercent)} % restant</span>
                            <small>{Math.round(window.usedPercent)} % utilisé</small>
                          </strong>
                        </>
                      )}
                    </div>
                  ))
                )}
              </article>
            ))}
          </div>
          <footer>Capacité restante · un quota de compte par fournisseur</footer>
        </section>
      )}
    </div>
  )
}
