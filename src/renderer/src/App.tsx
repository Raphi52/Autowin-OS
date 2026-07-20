import { useEffect, useState } from 'react'
import { ChatView } from './components/ChatView'
import { GraphView } from './components/GraphView'
import { ObservatoryView } from './components/ObservatoryView'
import { RolesView } from './components/RolesView'
import { HermesControlsView } from './components/HermesControlsView'
import { BehaviourView } from './components/BehaviourView'
import { RouterView } from './components/RouterView'
import { ModelQuestionPopup } from './components/ModelQuestionPopup'
import { normalizeTab, type Tab } from './tabs'
import autowinLogo from './assets/autowin-logo.png'
import './assets/app-shell.css'
import './assets/cosmic-outline.css'
import './assets/theme-modes.css'
import './assets/ui-system.css'
import { importMigratedStorage, migrateAutowinStorage } from './storage-keys'
import type { InspectTurnTarget, ObservatoryFocus } from './observatory-focus'

// Icônes de navigation : emoji, un par onglet.
const TOY: Record<Tab, string> = {
  chat: '💬',
  memory: '🧠',
  observatory: '🔭',
  router: '🛰️',
  agents: '🤖',
  capabilities: '🧰',
  behaviour: '🧬'
}

const NAV: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'observatory', label: 'Observatory' },
  { id: 'router', label: 'Router' },
  { id: 'agents', label: 'Models' },
  { id: 'capabilities', label: 'Skills · Hooks · Tools' },
  { id: 'behaviour', label: 'Behaviour' }
]

export function MainApp(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  const [driven, setDriven] = useState(false) // un agent pilote → halo sur la vue
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(['chat']))
  const [observatoryFocus, setObservatoryFocus] = useState<ObservatoryFocus | null>(null)

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

  function navigate(nextTab: Tab): void {
    setVisitedTabs((visited) => {
      if (visited.has(nextTab)) return visited
      const next = new Set(visited)
      next.add(nextTab)
      return next
    })
    setTab(nextTab)
  }

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
    const off = window.api.onAppEvent((e) => {
      if (e.type === 'navigate' && e.tab) {
        const nextTab = normalizeTab(e.tab)
        setVisitedTabs((visited) => {
          if (visited.has(nextTab)) return visited
          const next = new Set(visited)
          next.add(nextTab)
          return next
        })
        setTab(nextTab)
        setDriven(true)
        setTimeout(() => setDriven(false), 900)
      }
    })
    return off
  }, [])

  return (
    <div className="shell cosmic-outline theme-serious">
      <aside className={`rail${railCollapsed ? ' is-collapsed' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src={autowinLogo} alt="" aria-hidden="true" />
          <span className="brand-name">
            Autowin <b>OS</b>
          </span>
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
                className={`nav-item${tab === it.id ? ' active' : ''}`}
                onClick={() => navigate(it.id)}
              >
                <span className="space-toy-icon" aria-hidden="true">
                  {TOY[it.id]}
                </span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="rail-foot c-faint">v0 · MVP</div>
      </aside>
      <main className={`main${driven ? ' driven' : ''}`} data-driven={driven}>
        {visitedTabs.has('chat') && (
          <div className={`view-slot${tab === 'chat' ? ' is-active' : ''}`}>
            <ChatView isActive={tab === 'chat'} onInspectTurn={inspectTurn} />
          </div>
        )}
        {visitedTabs.has('memory') && (
          <div className={`view-slot${tab === 'memory' ? ' is-active' : ''}`}>
            <GraphView visualMode="serious" onCleanMemory={openBrainwashConversation} />
          </div>
        )}
        {visitedTabs.has('observatory') && (
          <div className={`view-slot${tab === 'observatory' ? ' is-active' : ''}`}>
            <ObservatoryView active={tab === 'observatory'} focus={observatoryFocus} />
          </div>
        )}
        {visitedTabs.has('router') && (
          <div className={`view-slot${tab === 'router' ? ' is-active' : ''}`}>
            <RouterView active={tab === 'router'} />
          </div>
        )}
        {visitedTabs.has('agents') && (
          <div className={`view-slot${tab === 'agents' ? ' is-active' : ''}`}>
            <RolesView />
          </div>
        )}
        {visitedTabs.has('capabilities') && (
          <div className={`view-slot${tab === 'capabilities' ? ' is-active' : ''}`}>
            <HermesControlsView active={tab === 'capabilities'} />
          </div>
        )}
        {visitedTabs.has('behaviour') && (
          <div className={`view-slot${tab === 'behaviour' ? ' is-active' : ''}`}>
            <BehaviourView />
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
