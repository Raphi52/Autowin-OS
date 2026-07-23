import { useCallback, useEffect, useRef, useState } from 'react'
import packageManifest from '../../../package.json'
import { ChatView } from './components/ChatView'
import { PreflightBanner } from './components/PreflightBanner'
import { FirstRunWizard } from './components/FirstRunWizard'
import { ObservatoryView } from './components/ObservatoryView'
import { AgentStudioView } from './components/AgentStudioView'
import { KnowledgeView } from './components/KnowledgeView'
import { SettingsView } from './components/SettingsView'
import { ModelQuestionPopup } from './components/ModelQuestionPopup'
import {
  APP_DESTINATIONS,
  resolveAppLocation,
  type AgentStudioSection,
  type SettingsSection,
  type Tab
} from './tabs'
import autowinLogo from './assets/autowin-logo-transparent.png'
import './assets/app-shell.css'
import './assets/cosmic-outline.css'
import './assets/theme-modes.css'
import './assets/ui-system.css'
import { importMigratedStorage, migrateAutowinStorage } from './storage-keys'
import type { InspectTurnTarget, ObservatoryFocus } from './observatory-focus'

const NAV = APP_DESTINATIONS

export function MainApp(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  const [driven, setDriven] = useState(false) // un agent pilote → halo sur la vue
  // #11 — l'état replié/déplié de la rail est PERSISTÉ (comme le zoom), pour ne pas re-replier à
  // chaque lancement.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(
    () => localStorage.getItem('autowin:rail-collapsed') === '1'
  )
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(['chat']))
  const [observatoryFocus, setObservatoryFocus] = useState<ObservatoryFocus | null>(null)
  const [agentStudioSection, setAgentStudioSection] = useState<AgentStudioSection>('topology')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('capabilities')
  const [navigationOrigin] = useState(() => `renderer-${globalThis.crypto.randomUUID()}`)
  const navigationGeneration = useRef(0)

  useEffect(() => {
    migrateAutowinStorage(localStorage)
    void (async () => {
      try {
        const legacyStorageValues = await window.api.storageMigration()
        importMigratedStorage(localStorage, legacyStorageValues)
        const acknowledged = await window.api.completeStorageMigration()
        if (!acknowledged) {
          console.warn(
            '[Autowin migration] LocalStorage import not acknowledged; will retry on next application launch'
          )
        }
      } catch {
        console.warn(
          '[Autowin migration] LocalStorage import failed; will retry on next application launch'
        )
      }
    })()
  }, [])

  // Zoom app-wide (accessibilité malvoyant) : Ctrl + molette agrandit/réduit TOUT le rendu,
  // Ctrl+0 réinitialise, Ctrl+±/= ajustent au clavier. Persisté entre lancements. Borné 0.5–3.
  useEffect(() => {
    const api = window.api
    if (!api?.setZoomFactor || !api?.getZoomFactor) return
    const KEY = 'autowin:zoom-factor'
    const MIN = 0.5
    const MAX = 3
    const STEP = 0.1
    const clamp = (f: number): number => Math.min(MAX, Math.max(MIN, Math.round(f * 100) / 100))
    const apply = (f: number): void => {
      const z = clamp(f)
      api.setZoomFactor(z)
      localStorage.setItem(KEY, String(z))
    }
    const saved = Number(localStorage.getItem(KEY))
    if (saved && saved > 0) api.setZoomFactor(clamp(saved))
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      apply(api.getZoomFactor() + (e.deltaY < 0 ? STEP : -STEP))
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) return
      if (e.key === '0') {
        e.preventDefault()
        apply(1)
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        apply(api.getZoomFactor() + STEP)
      } else if (e.key === '-') {
        e.preventDefault()
        apply(api.getZoomFactor() - STEP)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // #11 — persiste l'état de la rail.
  useEffect(() => {
    localStorage.setItem('autowin:rail-collapsed', railCollapsed ? '1' : '0')
  }, [railCollapsed])

  const activateTab = useCallback((nextTab: Tab): void => {
    setVisitedTabs((visited) => {
      if (visited.has(nextTab)) return visited
      const next = new Set(visited)
      next.add(nextTab)
      return next
    })
    setTab(nextTab)
  }, [])

  const applyLocation = useCallback(
    (requestedTab: string): void => {
      const location = resolveAppLocation(requestedTab)
      if (location.destination === 'agent-studio' && location.section) {
        setAgentStudioSection(location.section as AgentStudioSection)
      }
      if (location.destination === 'settings' && location.section) {
        setSettingsSection(location.section as SettingsSection)
      }
      activateTab(location.destination)
    },
    [activateTab]
  )

  const navigate = useCallback(
    (nextTab: Tab): void => {
      const command = window.api?.appCommand
      if (!command) return
      const generation = ++navigationGeneration.current
      void command('navigate', { tab: nextTab, origin: navigationOrigin }).then(
        (result) => {
          if (result.ok && generation === navigationGeneration.current) activateTab(nextTab)
        },
        () => {
          // Le main reste l'autorité : sans accusé IPC, la vue locale ne diverge pas de appState().
        }
      )
    },
    [activateTab, navigationOrigin]
  )

  // #11 — raccourcis clavier : Ctrl/Cmd+1..6 changent d'onglet, Ctrl/Cmd+K focalise la recherche de
  // conversation (best-effort : ne fait rien si le champ n'est pas monté). N'interfère pas avec le
  // zoom (Ctrl+0/±) ni la saisie (on ignore Alt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((!e.ctrlKey && !e.metaKey) || e.altKey) return
      // Ne pas voler les raccourcis à un champ de saisie actif (le contrat le promettait).
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= NAV.length) {
        e.preventDefault()
        const id = NAV[n - 1].id
        navigate(id)
      } else if (e.key.toLowerCase() === 'k') {
        const el = document.querySelector<HTMLInputElement>('input.conv-search, .conv-search input')
        if (el) {
          e.preventDefault()
          el.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  function openBrainwashConversation(brainLabel: string): void {
    navigate('chat')
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('autowin:brainwash', {
          detail: {
            prompt: `$brainwash\n\nAudite l’intégrité du brain « ${brainLabel} ». Vérifie les fichiers source, liens cassés, doublons, métadonnées incohérentes et index obsolètes. N’efface ni ne réécris rien sans me proposer un plan, puis rends un rapport d’intégrité priorisé.`
          }
        })
      )
    }, 0)
  }

  function inspectTurn(target: InspectTurnTarget): void {
    setObservatoryFocus({ ...target, requestId: Date.now() })
    navigate('observatory')
  }

  useEffect(() => {
    // Un agent pilote l'app → l'UI suit EN DIRECT (navigate change la vue active).
    // Les refresh de données sont gérés PAR les vues (pas de remount : il tuerait
    // le fil de chat en plein tour d'agent).
    let disposed = false
    const off = window.api.onAppEvent((e) => {
      if (e.type === 'navigate' && e.tab) {
        navigationGeneration.current += 1
        applyLocation(e.tab)
        if (e.origin !== navigationOrigin) {
          setDriven(true)
          setTimeout(() => setDriven(false), 900)
        }
      }
    })
    const readAppState = window.api?.appState
    if (typeof readAppState === 'function') {
      const hydrationGeneration = navigationGeneration.current
      void readAppState().then(
        (state) => {
          const stateTab =
            state && typeof state === 'object' && 'tab' in state
              ? (state as { tab?: unknown }).tab
              : undefined
          if (
            !disposed &&
            hydrationGeneration === navigationGeneration.current &&
            typeof stateTab === 'string'
          ) {
            applyLocation(stateTab)
          }
        },
        () => {
          // L'événementiel reste l'autorité si le snapshot initial est indisponible.
        }
      )
    }
    return () => {
      disposed = true
      off()
    }
  }, [applyLocation, navigationOrigin])

  return (
    <div className="shell cosmic-outline theme-serious">
      <FirstRunWizard />
      <aside className={`rail${railCollapsed ? ' is-collapsed' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src={autowinLogo} alt="" aria-hidden="true" />
          <span className="brand-name">Autowin OS</span>
          <button
            type="button"
            className="rail-toggle"
            aria-label={railCollapsed ? 'Déployer le menu' : 'Réduire le menu'}
            aria-expanded={!railCollapsed}
            title={railCollapsed ? 'Déployer le menu' : 'Réduire le menu'}
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={railCollapsed ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
            </svg>
          </button>
        </div>
        <nav className="nav">
          <div className="nav-group">
            {NAV.map((it) => (
              <button
                key={it.id}
                data-testid={`nav-${it.id}`}
                className={`nav-item${tab === it.id ? ' active' : ''}`}
                onClick={() => navigate(it.id)}
              >
                <span className="space-toy-icon" aria-hidden="true">
                  {it.icon}
                </span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="rail-foot c-faint">{`v${packageManifest.version} · preview`}</div>
      </aside>
      <main className={`main${driven ? ' driven' : ''}`} data-driven={driven}>
        <PreflightBanner />
        {visitedTabs.has('chat') && (
          <div className={`view-slot${tab === 'chat' ? ' is-active' : ''}`}>
            <ChatView isActive={tab === 'chat'} onInspectTurn={inspectTurn} />
          </div>
        )}
        {visitedTabs.has('agent-studio') && (
          <div className={`view-slot${tab === 'agent-studio' ? ' is-active' : ''}`}>
            <AgentStudioView
              active={tab === 'agent-studio'}
              section={agentStudioSection}
              onSectionChange={setAgentStudioSection}
            />
          </div>
        )}
        {visitedTabs.has('knowledge') && (
          <div className={`view-slot${tab === 'knowledge' ? ' is-active' : ''}`}>
            <KnowledgeView onCleanMemory={openBrainwashConversation} />
          </div>
        )}
        {visitedTabs.has('observatory') && (
          <div className={`view-slot${tab === 'observatory' ? ' is-active' : ''}`}>
            <ObservatoryView
              active={tab === 'observatory'}
              focus={observatoryFocus}
              onOpenCapabilities={() => {
                setSettingsSection('capabilities')
                navigate('settings')
              }}
            />
          </div>
        )}
        {visitedTabs.has('settings') && (
          <div className={`view-slot${tab === 'settings' ? ' is-active' : ''}`}>
            <SettingsView
              active={tab === 'settings'}
              section={settingsSection}
              onSectionChange={setSettingsSection}
            />
          </div>
        )}
      </main>
    </div>
  )
}

function App(): React.JSX.Element {
  if (window.location.hash === '#storage-migration') return <></>
  return window.location.hash === '#model-question' ? <ModelQuestionPopup /> : <MainApp />
}

export default App
