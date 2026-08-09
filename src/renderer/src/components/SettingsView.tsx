import { useCallback, useEffect, useState } from 'react'
import type { SettingsSection } from '../tabs'
import { BehaviourView } from './BehaviourView'
import { CapabilitiesView } from './CapabilitiesView'
import { OrchestrationBudgetSettings } from './OrchestrationBudgetSettings'
import './DomainShell.css'

type PreflightResult = Awaited<ReturnType<typeof window.api.recheckPreflight>>

export function SettingsView({
  active,
  section,
  onSectionChange
}: {
  active: boolean
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}): React.JSX.Element {
  const [preflight, setPreflight] = useState<PreflightResult>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)

  const recheck = useCallback(async () => {
    setChecking(true)
    setError(null)
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
    if (section !== 'preflight') return
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
  }, [section])

  const repair = useCallback(
    async (checkId: string) => {
      setRepairing(checkId)
      setError(null)
      try {
        await window.api?.repairPreflight?.(checkId)
      } catch {
        setError('La réparation a échoué. Suivez la consigne affichée puis réessayez.')
      } finally {
        setRepairing(null)
        // Le re-diagnostic tranche : on n'affirme jamais qu'un prérequis est réparé.
        await recheck()
      }
    },
    [recheck]
  )

  return (
    <section className="domain-shell" data-testid="settings-view">
      <nav className="domain-tabs" aria-label="Sections Settings">
        <button
          type="button"
          className={section === 'budget' ? 'is-active' : ''}
          aria-pressed={section === 'budget'}
          onClick={() => onSectionChange('budget')}
        >
          Budget
        </button>
        <button
          type="button"
          className={section === 'capabilities' ? 'is-active' : ''}
          aria-pressed={section === 'capabilities'}
          onClick={() => onSectionChange('capabilities')}
        >
          Skills · Hooks · Tools
        </button>
        <button
          type="button"
          className={section === 'behaviour' ? 'is-active' : ''}
          aria-pressed={section === 'behaviour'}
          onClick={() => onSectionChange('behaviour')}
        >
          Behaviour
        </button>
        <button
          type="button"
          className={section === 'preflight' ? 'is-active' : ''}
          aria-pressed={section === 'preflight'}
          onClick={() => onSectionChange('preflight')}
        >
          Diagnostic
        </button>
      </nav>
      <div className="domain-content">
        {section === 'capabilities' && <CapabilitiesView active={active} />}
        {section === 'budget' && <OrchestrationBudgetSettings />}
        {section === 'behaviour' && <BehaviourView />}
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
