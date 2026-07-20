import { useCallback, useEffect, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'
import { connectionIdentity, statusLabel } from './router-view-model'
import './RouterView.css'

type Snapshot = Awaited<ReturnType<typeof window.api.routerSnapshot>>
type RouterConnection = Snapshot['connections'][number]
type MigrationState = Awaited<ReturnType<typeof window.api.routerMigrationState>>
type RouteTest = Awaited<ReturnType<typeof window.api.testOmniRoute>>

function formatReset(value?: string): string {
  if (!value) return 'Remise à zéro inconnue'
  return `Reset ${new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
}

const SOURCE_LABEL = { health: 'Santé', connections: 'Comptes', quotas: 'Quotas' } as const

export function RouterAccountCards({
  connections
}: {
  connections: RouterConnection[]
}): React.JSX.Element {
  return (
    <section className="router-account-grid">
      {connections.map((connection) => (
        <article className="router-account surface-card" key={connection.id}>
          <div className="router-account-head">
            <div className="router-provider-mark">
              {connection.provider.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <span>{connection.provider}</span>
              <h3>{connectionIdentity(connection)}</h3>
            </div>
            <span className={`router-pill is-${connection.status}`}>
              {statusLabel(connection.status)}
            </span>
          </div>
          {connection.incident && (
            <p className="router-incident">
              {connection.incident.label}
              {connection.incident.at
                ? ` · ${new Date(connection.incident.at).toLocaleString('fr-FR')}`
                : ''}
            </p>
          )}
          <div className="router-quota-list">
            {connection.quotas.length === 0 ? (
              <p>Quota non communiqué par ce provider.</p>
            ) : (
              connection.quotas.map((quota) => (
                <div className="router-quota" key={quota.label}>
                  <div>
                    <strong>{quota.label}</strong>
                    <span>{formatReset(quota.resetAt)}</span>
                  </div>
                  <div className="router-quota-value">
                    {quota.remainingPercent === undefined
                      ? '—'
                      : `${Math.round(quota.remainingPercent)} %`}
                  </div>
                  <div className="router-quota-track">
                    <i style={{ width: `${quota.remainingPercent ?? 0}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      ))}
      {connections.length === 0 && (
        <div className="router-empty-inline surface-card">
          Aucun compte visible. Connecte tes comptes dans le dashboard OmniRoute.
        </div>
      )}
    </section>
  )
}

export function RouterView({ active }: { active: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [migration, setMigration] = useState<MigrationState>()
  const [routeTest, setRouteTest] = useState<RouteTest>()
  const [credential, setCredential] = useState('')
  const [routeModel, setRouteModel] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSnapshot, nextMigration] = await Promise.all([
        window.api.routerSnapshot(),
        window.api.routerMigrationState()
      ])
      setSnapshot(nextSnapshot)
      setMigration(nextMigration)
      if (nextMigration.routeModel) setRouteModel(nextMigration.routeModel)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    // Le passage sur l'onglet doit charger son snapshot sans interaction supplémentaire.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void refresh()
  }, [active, refresh])
  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setActionBusy(true)
      setActionError('')
      try {
        await action()
        await refresh()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      } finally {
        setActionBusy(false)
      }
    },
    [refresh]
  )

  const status = snapshot?.status ?? 'unavailable'
  const connectionsSourceAvailable =
    snapshot?.sources.find((source) => source.id === 'connections')?.status === 'ok'
  return (
    <section className="router-view">
      <header className="router-head">
        <ModuleHeader eyebrow="Comptes et routage multi-modèles" title="Router" />
        <div className="router-actions">
          <button
            className="router-icon-button"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Rafraîchir Router"
            title="Rafraîchir"
          >
            ↻
          </button>
          <button
            className="router-dashboard-button"
            type="button"
            onClick={() => void window.api.openOmniRouteDashboard()}
          >
            Ouvrir OmniRoute ↗
          </button>
        </div>
      </header>
      <div className="router-scroll">
        <div className="router-grid">
          <section className="router-hero surface-card">
            <div className="router-hero-head">
              <span className={`router-status-dot is-${status}`} />
              <span className="router-kicker">Instance locale</span>
            </div>
            <h2>{statusLabel(status)}</h2>
            <p className="router-endpoint">{snapshot?.endpoint ?? 'http://127.0.0.1:20128'}</p>
            <div className="router-metrics">
              <div>
                <strong>{snapshot?.version ?? '—'}</strong>
                <span>Version</span>
              </div>
              <div>
                <strong>{snapshot?.connectionCount ?? '—'}</strong>
                <span>Comptes</span>
              </div>
              <div>
                <strong>{snapshot?.availableConnectionCount ?? '—'}</strong>
                <span>Disponibles</span>
              </div>
            </div>
          </section>

          <section className="router-route surface-card">
            <span className="router-kicker">Route active</span>
            <h2 className="router-route-current">
              {migration?.routeModel ?? 'Aucune route configurée'}
            </h2>
            <p>
              Transport EXCLUSIF des conversations. Le provider final et les fallbacks restent gérés
              dans OmniRoute — aucun chemin direct Claude/Codex/Kimi.
            </p>
            <label className="router-field">
              <span>Gateway token</span>
              <input
                type="password"
                value={credential}
                placeholder={
                  migration?.credentialConfigured
                    ? 'Credential Windows configuré'
                    : 'Coller le token local'
                }
                onChange={(event) => {
                  setCredential(event.target.value)
                  setRouteTest(undefined)
                }}
                autoComplete="off"
              />
            </label>
            <div className="router-route-actions">
              <button
                type="button"
                disabled={actionBusy || (!credential && !migration?.credentialConfigured)}
                onClick={() =>
                  void runAction(async () => {
                    if (credential) {
                      await window.api.setOmniRouteCredential(credential)
                      setCredential('')
                    }
                    const result = await window.api.testOmniRoute()
                    setRouteTest(result)
                    if (!result.ok) throw new Error(result.reason ?? 'Test OmniRoute échoué')
                    if (!routeModel && result.models[0]) setRouteModel(result.models[0].id)
                  })
                }
              >
                Tester la connexion
              </button>
              <select
                value={routeModel}
                onChange={(event) => setRouteModel(event.target.value)}
                disabled={!routeTest?.ok || actionBusy}
              >
                <option value="">Choisir une route</option>
                {routeTest?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <button
                className="is-primary"
                type="button"
                disabled={!routeTest?.ok || !routeModel || actionBusy}
                onClick={() =>
                  void runAction(async () => {
                    setMigration(await window.api.activateOmniRoute(routeModel))
                  })
                }
              >
                Appliquer la route
              </button>
            </div>
            {actionError && (
              <p className="router-action-error" role="alert">
                {actionError}
              </p>
            )}
            {routeTest?.ok && (
              <p className="router-action-ok">
                Catalogue vérifié · {routeTest.models.length} routes
              </p>
            )}
          </section>
        </div>

        {snapshot && snapshot.sources.length > 0 && (
          <section className="router-health surface-panel" aria-label="Santé OmniRoute">
            <div className="router-source-list">
              {snapshot.sources.map((source) => (
                <span className={`router-source is-${source.status}`} key={source.id}>
                  <i /> {SOURCE_LABEL[source.id]} ·{' '}
                  {source.status === 'ok' ? 'disponible' : 'indisponible'}
                </span>
              ))}
            </div>
            <div className="router-stat-tiles">
              <div className="router-stat">
                <strong>{snapshot.protections?.circuitBreakers ?? '—'}</strong>
                <span>Circuits ouverts</span>
              </div>
              <div className="router-stat">
                <strong>{snapshot.protections?.lockouts ?? '—'}</strong>
                <span>Verrouillages</span>
              </div>
              <div className="router-stat">
                <strong>{snapshot.protections?.quotaAlerts ?? '—'}</strong>
                <span>Alertes quota</span>
              </div>
            </div>
          </section>
        )}

        {!snapshot || snapshot.status === 'unavailable' ? (
          <section className="router-empty surface-panel">
            <div className="router-orbit" aria-hidden="true">
              ◎
            </div>
            <div>
              <h2>OmniRoute n’est pas connecté</h2>
              <p>
                Lance OmniRoute sur le port 20128, puis rafraîchis cette vue. Les conversations
                restent bloquées tant que le gateway est indisponible.
              </p>
            </div>
          </section>
        ) : (
          <>
            <div className="router-section-title">
              <div>
                <span>Connexions</span>
                <h2>Comptes détectés</h2>
              </div>
              <small>
                {snapshot.connectionCount ?? '—'} connexion
                {snapshot.connectionCount === 1 ? '' : 's'}
              </small>
            </div>
            {connectionsSourceAvailable ? (
              <RouterAccountCards connections={snapshot.connections} />
            ) : (
              <div className="router-empty-inline surface-card">
                Comptes indisponibles : OmniRoute n’a pas pu fournir cette source.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
