import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './RouterView.css'
import { ModuleHeader } from './ModuleHeader'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import type { RuntimeModel, OrchestratorModelOption } from './chat-view-model'
import { agentStudioProviderIds } from './provider-catalog'
import { libraryModels } from './model-library'
import type { ClaudeAccountEntry } from '../../../preload/index.d'

/**
 * Page « Routeur » — voir les providers/modèles connectés + leur statut d'auth RÉEL, (ré)authentifier,
 * et choisir le modèle par défaut du chat.
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
const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  kimi: 'Kimi',
  gemini: 'Gemini'
}
const RE_AUTH_HINT: Record<string, string> = {
  claude:
    'CLI Claude introuvable ou non authentifié — installer/authentifier Claude, puis relance « Tester ».',
  codex:
    'CLI Codex ou session OAuth indisponible — installer/reconnecter Codex, puis rouvre la page.',
  kimi: 'CLI Kimi introuvable — installer/authentifier Kimi, puis relance « Tester ».',
  gemini: 'Session Gemini absente — reconnecte le compte Google, puis relance « Tester ».'
}

interface Binding {
  provider: string
  model?: string
  reasoningEffort?: string
}

export function RouterView({ active = true }: { active?: boolean }): React.JSX.Element {
  const [models, setModels] = useState<RuntimeModel[]>([])
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [binding, setBinding] = useState<Binding | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [modePending, setModePending] = useState<Record<string, boolean>>({})
  const [accounts, setAccounts] = useState<ClaudeAccountEntry[]>([])
  const [accountBusy, setAccountBusy] = useState(false)
  const [modelPending, setModelPending] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [catalogActive, setCatalogActive] = useState(active)
  const reloadGenerationRef = useRef(0)

  if (catalogActive !== active) {
    setCatalogActive(active)
    setModels([])
    setStatuses([])
    setLoaded(false)
  }

  const reloadCatalog = useCallback(async (): Promise<void> => {
    const generation = ++reloadGenerationRef.current
    setModels([])
    setStatuses([])
    setLoaded(false)
    const [nextModels, nextStatuses, roles] = await Promise.all([
      window.api.models().catch(() => []),
      window.api.providerStatus().catch(() => []),
      window.api.roles().catch(() => ({}))
    ])
    if (generation !== reloadGenerationRef.current) return
    setModels(nextModels as RuntimeModel[])
    setStatuses(nextStatuses as ProviderStatus[])
    const nextRoles = roles as Record<string, Binding>
    setBinding(nextRoles.orchestrator ?? null)
    setLoaded(true)
  }, [])

  const invalidatePendingReloads = (): void => {
    reloadGenerationRef.current += 1
  }

  const refreshBinding = useCallback(async (): Promise<void> => {
    const roles = (await window.api.roles().catch(() => ({}))) as Record<string, Binding>
    setBinding(roles.orchestrator ?? null)
  }, [])

  useEffect(() => {
    if (!active) return
    void Promise.resolve().then(reloadCatalog)
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && event.scope === 'roles') void reloadCatalog()
    })
    return () => {
      invalidatePendingReloads()
      off()
    }
  }, [active, reloadCatalog])

  const byProvider = useMemo(() => {
    const map = new Map<string, RuntimeModel[]>()
    // `libraryModels` et pas `models` : c'est LA liste partagée avec « Modèles & topologie ».
    // Sans elle, les alias du CLI Claude s'affichaient à côté du modèle concret dont ils portent
    // le label, donc en doublon apparent.
    for (const m of libraryModels(models)) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return map
  }, [models])

  const providers = useMemo(() => {
    // Volontairement le catalogue COMPLET, pas la liste filtrée : un provider dont aucun modèle
    // n'est listé garde sa carte et son badge d'authentification. Routage existe d'abord pour
    // montrer cet état ; le filtrer ici ferait disparaître kimi et gemini de l'écran entier.
    return agentStudioProviderIds(models, statuses)
  }, [models, statuses])

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
      await reloadCatalog()
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

  const reloadAccounts = useCallback(async (): Promise<void> => {
    const payload = await window.api.claudeAccounts().catch(() => null)
    if (payload) setAccounts(payload.accounts)
  }, [])

  useEffect(() => {
    if (!active) return
    void reloadAccounts()
  }, [active, reloadAccounts])

  // Toute mutation de comptes rend la liste a jour : on la reprend telle quelle plutot que de
  // recalculer l'etat cote renderer, pour qu'il n'existe qu'UNE verite (celle du store principal).
  const runAccountAction = async (
    action: () => Promise<{ accounts: ClaudeAccountEntry[] } | { ok: true }>
  ): Promise<void> => {
    if (accountBusy) return
    setAccountBusy(true)
    try {
      const result = await action()
      if ('accounts' in result) setAccounts(result.accounts)
      // Le compte actif change l'identite du CLI : le badge d'auth affiche ne vaut plus rien tant
      // qu'il n'a pas ete re-teste. On recharge donc les statuts au lieu de laisser un vert perime.
      await reloadCatalog()
    } catch {
      // fail-open : la liste precedente reste affichee plutot qu'un ecran vide
    } finally {
      setAccountBusy(false)
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
              {provider === 'claude' && (
                <div className="router-accounts" data-testid="claude-accounts">
                  <span className="router-accounts-title">Comptes</span>
                  <div className="router-accounts-list">
                    {accounts.map((account) => (
                      <span key={account.id} className="router-account">
                        <button
                          type="button"
                          className={`router-account-chip${account.active ? ' is-active' : ''}`}
                          aria-pressed={account.active}
                          disabled={accountBusy || account.active}
                          title={account.email ?? account.displayName}
                          onClick={() =>
                            void runAccountAction(() => window.api.claudeAccountSwitch(account.id))
                          }
                        >
                          {account.displayName}
                          {account.tier && (
                            <em className="router-account-tier">{account.tier}</em>
                          )}
                        </button>
                        {account.id !== 'default' && (
                          <button
                            type="button"
                            className="router-account-remove"
                            aria-label={`Retirer ${account.displayName}`}
                            disabled={accountBusy}
                            onClick={() =>
                              void runAccountAction(() =>
                                window.api.claudeAccountRemove(account.id)
                              )
                            }
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    <button
                      type="button"
                      className="router-account-add"
                      disabled={accountBusy}
                      onClick={() => void runAccountAction(() => window.api.claudeAccountAdd())}
                    >
                      + Ajouter un compte
                    </button>
                  </div>
                  <p className="router-hint">
                    Chaque compte garde sa propre session : basculer ne redemande pas de connexion.
                    Ajouter un compte ouvre un terminal de login dédié.
                  </p>
                </div>
              )}
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
