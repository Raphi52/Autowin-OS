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
interface ProviderStatus {
  provider: string
  status: AuthStatus
  testable: boolean
}

const STATUS_LABEL: Record<AuthStatus, string> = {
  authenticated: 'Authentifié',
  expired: 'Expiré · à reconnecter',
  'installed-untested': 'Installé · validité non testée',
  absent: 'Non connecté',
  unknown: 'Indéterminé'
}
const PROVIDER_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi' }
const RE_AUTH_HINT: Record<string, string> = {
  claude: 'Authentifie le CLI Claude dans un terminal, puis relance « Tester ».',
  codex: 'Reconnecte Codex (npm run codex:login), puis rouvre la page.'
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

  const connectKimi = async (): Promise<void> => {
    await window.api.kimiLogin().catch(() => undefined)
  }

  const changeDefaultModel = async (option: OrchestratorModelOption): Promise<void> => {
    if (modelPending) return
    setModelPending(true)
    setModelError(null)
    try {
      await window.api.setRole('orchestrator', option.provider, option.model, option.reasoningEffort)
      await refreshBinding()
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelPending(false)
    }
  }

  return (
    <section className="router-view">
      <ModuleHeader
        eyebrow="Providers et modèles connectés"
        title="Routeur"
      />

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
                <span className={`router-badge is-${st.status}`}>{STATUS_LABEL[st.status]}</span>
                <span className="router-actions">
                  {st.testable && (
                    <button type="button" onClick={() => void test(provider)} disabled={testing[provider]}>
                      {testing[provider] ? 'Test…' : 'Tester'}
                    </button>
                  )}
                  {provider === 'kimi' && st.status !== 'authenticated' && (
                    <button type="button" onClick={() => void connectKimi()}>
                      Se connecter
                    </button>
                  )}
                </span>
              </header>
              {(st.status === 'expired' || st.status === 'absent') && RE_AUTH_HINT[provider] && (
                <p className="router-hint">{RE_AUTH_HINT[provider]}</p>
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
