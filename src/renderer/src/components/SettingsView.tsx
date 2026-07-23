import { useCallback, useState } from 'react'
import type { SettingsSection } from '../tabs'
import { BehaviourView } from './BehaviourView'
import { CapabilitiesView } from './CapabilitiesView'
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

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      setPreflight(await window.api.recheckPreflight(true))
    } finally {
      setChecking(false)
    }
  }, [])

  return (
    <section className="domain-shell" data-testid="settings-view">
      <nav className="domain-tabs" aria-label="Sections Settings">
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
        {section === 'behaviour' && <BehaviourView />}
        {section === 'preflight' && (
          <section className="settings-preflight surface-panel" aria-label="Diagnostic de configuration">
            <header>
              <div>
                <span className="domain-eyebrow">Configuration locale</span>
                <h2>Diagnostic de démarrage</h2>
              </div>
              <button type="button" onClick={() => void recheck()} disabled={checking}>
                {checking ? 'Vérification…' : 'Relancer le diagnostic'}
              </button>
            </header>
            {!preflight ? (
              <p>Relance le même contrôle que l’onboarding, à tout moment.</p>
            ) : (
              <>
                <p className={preflight.ok ? 'domain-ok' : 'domain-warning'}>{preflight.summary}</p>
                <ul className="settings-preflight-list">
                  {preflight.checks.map((check) => (
                    <li key={check.id} className={check.ok ? 'is-ok' : 'is-ko'}>
                      <strong>{check.ok ? '✓' : '✗'} {check.label}</strong>
                      {check.detail && <span>{check.detail}</span>}
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
