import { useCallback, useEffect, useState } from 'react'
import type { SettingsSection } from '../tabs'
import { BehaviourView } from './BehaviourView'
import { CapabilitiesView } from './CapabilitiesView'
import { OrchestrationBudgetSettings } from './OrchestrationBudgetSettings'
import { ShadowRoutingPilotSettings } from './ShadowRoutingPilotSettings'
import { ViewTopBar } from './ViewTopBar'
import './ViewPage.css'
import './DomainShell.css'

type PreflightResult = Awaited<ReturnType<typeof window.api.recheckPreflight>>

interface ProviderRow {
  provider: string
  status: string
  detail?: string
}

export function SettingsView({
  active,
  section,
  onSectionChange,
  onOpenRouter
}: {
  active: boolean
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  /** Navigation RÉELLE vers la page Routeur (Agent Studio · routing) — pas un simple texte. */
  onOpenRouter?: () => void
}): React.JSX.Element {
  const [preflight, setPreflight] = useState<PreflightResult>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairDone, setRepairDone] = useState<string | null>(null)

  const [providers, setProviders] = useState<ProviderRow[] | null>(null)
  const [providersError, setProvidersError] = useState<string | null>(null)
  /** Incrémenté par « Réessayer » : relance la lecture sans changer de section. */
  const [providersReload, setProvidersReload] = useState(0)
  const providersLoading = providers === null && providersError === null

  /**
   * `keepError` : le recheck déclenché par un échec de réparation ne doit PAS effacer le message
   * d'erreur qui vient d'être posé — sinon l'échec devient invisible pour l'utilisateur.
   */
  const recheck = useCallback(async (options?: { keepError?: boolean }) => {
    setChecking(true)
    if (!options?.keepError) setError(null)
    try {
      setPreflight(await window.api.recheckPreflight(true))
    } catch {
      // Un diagnostic qui échoue ne doit JAMAIS être silencieux : l'utilisateur voit l'échec et
      // le bouton reste actionnable (finally) pour réessayer.
      setError('Le diagnostic a échoué. Vérifiez la configuration puis réessayez.')
    } finally {
      setChecking(false)
    }
  }, [])

  /**
   * Hydratation immédiate : le dernier preflight est déjà en mémoire côté main (`preflight:current`)
   * → la section Diagnostic affiche les checks à l'ouverture, sans clic. Puis abonnement aux pushs
   * live (désabonnement au démontage).
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const current = await window.api?.getPreflight?.()
        if (alive && current) setPreflight(current as PreflightResult)
      } catch {
        /* l'hydratation est un confort : son échec ne casse pas la vue, le recheck reste dispo. */
      }
    })()
    const off = window.api?.onPreflight?.((r) => setPreflight(r as PreflightResult))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  /** Providers : lecture seule via l'IPC existant `providerStatus` (aucun IPC inventé). */
  useEffect(() => {
    if (section !== 'providers') return
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setProviders(null)
      setProvidersError(null)
    })
    void (async () => {
      const load = window.api?.providerStatus
      if (typeof load !== 'function') {
        if (alive) setProvidersError("L'état des providers n'est pas exposé par l'application.")
        return
      }
      try {
        const rows = await load()
        if (alive) {
          setProviders(rows as ProviderRow[])
          setProvidersError(null)
        }
      } catch {
        if (alive) setProvidersError("La lecture de l'état des providers a échoué.")
      }
    })()
    return () => {
      alive = false
    }
  }, [section, providersReload])

  const repair = useCallback(
    async (checkId: string) => {
      setRepairing(checkId)
      setError(null)
      setRepairDone(null)
      let repairFailed = false
      try {
        await window.api?.repairPreflight?.(checkId)
        setRepairDone(checkId)
      } catch {
        repairFailed = true
        setError('La réparation a échoué. Suivez la consigne affichée puis réessayez.')
      } finally {
        setRepairing(null)
        // Le re-diagnostic tranche : on n'affirme jamais qu'un prérequis est réparé.
        // …mais il n'efface pas l'échec de réparation qui vient d'être signalé.
        await recheck({ keepError: repairFailed })
      }
    },
    [recheck]
  )

  // Une erreur/succès posé dans une section ne doit pas survivre ORPHELIN dans une autre.
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setError(null)
      setRepairDone(null)
    })
    return () => {
      alive = false
    }
  }, [section])

  const preflightAlert = preflight ? !preflight.ok || preflight.checks.some((c) => !c.ok) : false

  return (
    <section className="view-page domain-shell" data-testid="settings-view">
      <ViewTopBar
        eyebrow="CONFIGURATION"
        title="Settings"
        description="Budget, capacités accordées aux agents, comportement, providers et prérequis machine."
        ariaLabel="Sections Settings"
        active={section}
        onSelect={onSectionChange}
        tabs={[
          { id: 'budget', label: 'Budget' },
          { id: 'capabilities', label: 'Skills · Hooks · Tools' },
          { id: 'behaviour', label: 'Behaviour' },
          { id: 'providers', label: 'Providers' },
          {
            id: 'preflight',
            label: 'Diagnostic',
            alert: {
              active: preflightAlert,
              mark: '!',
              title: 'Un prérequis est en échec',
              testId: 'settings-preflight-alert'
            }
          }
        ]}
      />
      <div className="domain-content">
        {section === 'capabilities' && <CapabilitiesView active={active} />}
        {section === 'budget' && (
          <>
            <OrchestrationBudgetSettings />
            <ShadowRoutingPilotSettings />
          </>
        )}
        {section === 'behaviour' && <BehaviourView />}
        {section === 'providers' && (
          <section className="settings-providers surface-panel" aria-label="Providers">
            <header>
              <div>
                <span className="domain-eyebrow">Fournisseurs</span>
                <h2>Providers</h2>
              </div>
            </header>
            {providersError && (
              <div className="domain-warning">
                <p role="alert">{providersError}</p>
                <button type="button" onClick={() => setProvidersReload((token) => token + 1)}>
                  Réessayer
                </button>
              </div>
            )}
            {providersLoading && <p role="status">Chargement des providers…</p>}
            {!providersLoading &&
              !providersError &&
              (providers && providers.length > 0 ? (
                <ul className="settings-providers-list">
                  {providers.map((entry) => (
                    <li key={entry.provider} data-testid={`settings-provider-${entry.provider}`}>
                      <strong>{entry.provider}</strong>
                      <span>{entry.status}</span>
                      {entry.detail && <span>{entry.detail}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucun provider n&apos;est exposé par l&apos;application.</p>
              ))}
            <p className="domain-hint">
              Lecture seule : la configuration (connexion, test, mode) se pilote depuis la page{' '}
              <button
                type="button"
                className="domain-link"
                data-testid="settings-open-router"
                onClick={() => onOpenRouter?.()}
              >
                Routeur
              </button>
              .
            </p>
          </section>
        )}
        {section === 'preflight' && (
          <section
            className="settings-preflight surface-panel"
            aria-label="Diagnostic de configuration"
          >
            <header>
              <div>
                <span className="domain-eyebrow">Configuration locale</span>
                <h2>Diagnostic de démarrage</h2>
              </div>
              <button type="button" onClick={() => void recheck()} disabled={checking}>
                {checking ? 'Vérification…' : 'Relancer le diagnostic'}
              </button>
            </header>
            {error && (
              <p className="domain-warning" role="alert">
                {error}
              </p>
            )}
            {repairDone && (
              <p className="domain-ok" role="status" data-testid="settings-repair-status">
                Réparation effectuée pour « {repairDone} » : le diagnostic a été relancé.
              </p>
            )}
            {!preflight ? (
              <p>Relance le même contrôle que l’onboarding, à tout moment.</p>
            ) : (
              <>
                <p className={preflight.ok ? 'domain-ok' : 'domain-warning'}>{preflight.summary}</p>
                <ul className="settings-preflight-list">
                  {preflight.checks.map((check) => (
                    <li key={check.id} className={check.ok ? 'is-ok' : 'is-ko'}>
                      <strong>
                        {check.ok ? '✓' : '✗'} {check.label}
                      </strong>
                      {check.detail && <span>{check.detail}</span>}
                      {!check.ok && (
                        <button
                          type="button"
                          className="settings-preflight-repair"
                          data-testid={`settings-repair-${check.id}`}
                          onClick={() => void repair(check.id)}
                          disabled={repairing !== null || checking}
                        >
                          {repairing === check.id ? 'Réparation…' : 'Réparer'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </section>
  )
}
