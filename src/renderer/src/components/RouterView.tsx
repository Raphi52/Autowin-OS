import { useEffect, useMemo, useState } from 'react'
import './RouterView.css'
import { ModuleHeader } from './ModuleHeader'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import type { RuntimeModel, OrchestratorModelOption } from './chat-view-model'

/**
 * Page « Routeur » — voir les providers/modèles connectés + leur statut d'auth RÉEL, (ré)authentifier,
 * et choisir le modèle par défaut du chat. Remplace l'ancienne page OmniRoute (supprimée).
 * Invariant : un badge ne ment jamais — « authentifié » n'apparaît que sur preuve réelle
 * (codex expiry au chargement ; claude/kimi via le bouton « Tester »).
 */
type AuthStatus = 'authenticated' | 'expired' | 'installed-untested' | 'absent' | 'unknown'
type ProviderDisplayStatus = AuthStatus | 'standby'
interface ProviderStatus {
  provider: string
  status: ProviderDisplayStatus
  testable: boolean
  detail?: string
  lastCheckedAt?: number
}

const STATUS_LABEL: Record<ProviderDisplayStatus, string> = {
  authenticated: 'Authentifié',
  expired: 'Expiré · à reconnecter',
  'installed-untested': 'Installé · validité non testée',
  absent: 'Non connecté',
  unknown: 'Indéterminé',
  standby: 'En standby'
}
const PROVIDER_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi' }
const RE_AUTH_HINT: Record<string, string> = {
  claude:
    'CLI Claude introuvable ou non authentifié — installer/authentifier Claude, puis relance « Tester ».',
  codex:
    'CLI Codex ou session OAuth indisponible — installer/reconnecter Codex, puis rouvre la page.',
  kimi: 'CLI Kimi introuvable — installer/authentifier Kimi, puis relance « Tester ».'
}

interface Binding {
  provider: string
  model?: string
  reasoningEffort?: string
}

export function RouterView(): React.JSX.Element {
  const [models, setModels] = useState<RuntimeModel[]>([])
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [binding, setBinding] = useState<Binding | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [modePending, setModePending] = useState<Record<string, boolean>>({})
  const [modelPending, setModelPending] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const loadStatuses = async (): Promise<void> => {
    const s = (await window.api.providerStatus().catch(() => [])) as ProviderStatus[]
    setStatuses(s)
  }
  const refreshBinding = async (): Promise<void> => {
    const roles = (await window.api.roles().catch(() => ({}))) as Record<string, Binding>
    setBinding(roles.orchestrator ?? null)
  }

  useEffect(() => {
    void (async () => {
      const m = (await window.api.models().catch(() => [])) as RuntimeModel[]
      setModels(m)
      await Promise.all([loadStatuses(), refreshBinding()])
      setLoaded(true)
    })()
  }, [])

  const byProvider = useMemo(() => {
    const map = new Map<string, RuntimeModel[]>()
    for (const m of models) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return map
  }, [models])

  const providers = useMemo(() => {
    const ids = new Set<string>([...byProvider.keys(), ...statuses.map((s) => s.provider)])
    return [...ids].sort()
  }, [byProvider, statuses])

  const statusOf = (provider: string): ProviderStatus =>
    statuses.find((s) => s.provider === provider) ?? {
      provider,
      status: 'unknown',
      testable: true
    }

  const test = async (provider: string): Promise<void> => {
    setTesting((t) => ({ ...t, [provider]: true }))
    try {
      const res = (await window.api.providerTest(provider)) as { status: AuthStatus }
      setStatuses((prev) =>
        prev.map((s) =>
          s.provider === provider ? { ...s, status: res.status, testable: s.testable } : s
        )
      )
    } catch {
      // le probe borné a échoué → on laisse le statut inchangé (jamais « authentifié » à tort)
    } finally {
      setTesting((t) => ({ ...t, [provider]: false }))
    }
  }

  const changeProviderMode = async (
    provider: string,
    mode: 'active' | 'standby'
  ): Promise<void> => {
    setModePending((pending) => ({ ...pending, [provider]: true }))
    try {
      await window.api.setProviderMode(provider, mode)
      await loadStatuses()
    } finally {
      setModePending((pending) => ({ ...pending, [provider]: false }))
    }
  }

  const [launched, setLaunched] = useState<Record<string, boolean>>({})
  const reconnect = async (provider: string): Promise<void> => {
    try {
      await window.api.providerLogin(provider)
      setLaunched((l) => ({ ...l, [provider]: true }))
    } catch {
      // le spawn du terminal a échoué → on n'affiche pas « lancé »
    }
  }

  const changeDefaultModel = async (option: OrchestratorModelOption): Promise<void> => {
    if (modelPending) return
    setModelPending(true)
    setModelError(null)
    try {
      await window.api.setRole(
        'orchestrator',
        option.provider,
        option.model,
        option.reasoningEffort
      )
      await refreshBinding()
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelPending(false)
    }
  }

  return (
    <section className="router-view">
      <ModuleHeader eyebrow="Providers et modèles connectés" title="Routeur" />

      <section className="router-default">
        <header>
          <h3>Modèle par défaut du chat</h3>
          <small>le provider/modèle qui répond quand tu écris dans le Chat</small>
        </header>
        <OrchestratorModelSelector
          busy={false}
          catalogLoaded={loaded}
          models={models}
          binding={binding}
          pending={modelPending}
          error={modelError}
          onSelect={(option) => void changeDefaultModel(option)}
        />
      </section>

      <div className="router-providers">
        {providers.map((provider) => {
          const st = statusOf(provider)
          const list = byProvider.get(provider) ?? []
          return (
            <section
              key={provider}
              className={`router-provider is-${st.status}`}
              data-provider={provider}
              data-status={st.status}
            >
              <header>
                <strong>{PROVIDER_LABEL[provider] ?? provider}</strong>
                <span className={`router-badge is-${st.status}`}>
                  {st.lastCheckedAt
                    ? `Dernier test : ${STATUS_LABEL[st.status]}`
                    : STATUS_LABEL[st.status]}
                </span>
                <span className="router-actions">
                  {st.status !== 'standby' && st.testable && (
                    <button
                      type="button"
                      onClick={() => void test(provider)}
                      disabled={testing[provider]}
                    >
                      {testing[provider] ? 'Test…' : 'Tester'}
                    </button>
                  )}
                  {st.status !== 'authenticated' && st.status !== 'standby' && (
                    <button
                      type="button"
                      className="router-reconnect"
                      onClick={() => void reconnect(provider)}
                    >
                      Se reconnecter
                    </button>
                  )}
                  <button
                    type="button"
                    className="router-standby"
                    disabled={modePending[provider]}
                    onClick={() =>
                      void changeProviderMode(
                        provider,
                        st.status === 'standby' ? 'active' : 'standby'
                      )
                    }
                  >
                    {modePending[provider]
                      ? 'Enregistrement…'
                      : st.status === 'standby'
                        ? 'Réactiver'
                        : 'Mettre en standby'}
                  </button>
                </span>
              </header>
              {st.status === 'standby' ? (
                <p className="router-hint">
                  Aucun test ni login automatique. Les modèles restent disponibles dans le
                  catalogue.
                </p>
              ) : launched[provider] ? (
                <p className="router-hint">
                  Login lancé dans un terminal — termine l’authentification, puis clique « Tester ».
                </p>
              ) : (
                (st.status === 'expired' || st.status === 'absent') &&
                RE_AUTH_HINT[provider] && <p className="router-hint">{RE_AUTH_HINT[provider]}</p>
              )}
              {st.status !== 'standby' && st.lastCheckedAt && (
                <p className="router-hint">
                  Dernier test réel : {new Date(st.lastCheckedAt).toLocaleString('fr-FR')}
                </p>
              )}
              {list.length > 0 ? (
                <ul className="router-models">
                  {list.map((m) => (
                    <li key={m.id}>
                      <strong>{m.label ?? m.model}</strong>
                      {m.reasoningEfforts?.length ? (
                        <span className="router-efforts">{m.reasoningEfforts.join(' · ')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="router-empty">Aucun modèle listé pour ce provider.</p>
              )}
            </section>
          )
        })}
        {loaded && providers.length === 0 && (
          <p className="router-empty">Aucun provider détecté.</p>
        )}
      </div>
    </section>
  )
}
