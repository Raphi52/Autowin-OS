import { useEffect, useState } from 'react'
import { ChatView } from './components/ChatView'
import { GraphView } from './components/GraphView'
import { ObservatoryView } from './components/ObservatoryView'
import { RolesView } from './components/RolesView'
import { HermesControlsView } from './components/HermesControlsView'
import { BehaviourView } from './components/BehaviourView'
import { ModelQuestionPopup } from './components/ModelQuestionPopup'
import { normalizeTab, type Tab } from './tabs'
import autowinLogo from './assets/autowin-logo.png'
import './assets/app-shell.css'
import './assets/cosmic-outline.css'
import './assets/theme-modes.css'
import './assets/ui-system.css'
import { importMigratedStorage, migrateAutowinStorage } from './storage-keys'

// Icônes : petits SVG path (stroke) — style linéaire, cohérent.
const I: Record<Tab, string> = {
  chat: 'M5 5h14a3 3 0 013 3v6a3 3 0 01-3 3H11l-5 3v-3H5a3 3 0 01-3-3V8a3 3 0 013-3zm3 6h.01M12 11h.01M16 11h.01',
  memory:
    'M5 7l6 4m2 0l6-4M5 17l6-4m2 0l6 4M5 5a2 2 0 110 4 2 2 0 010-4zm7 5a2 2 0 110 4 2 2 0 010-4zm7-5a2 2 0 110 4 2 2 0 010-4zM5 15a2 2 0 110 4 2 2 0 010-4zm14 0a2 2 0 110 4 2 2 0 010-4z',
  observatory: 'M7 7h9l-2 6h-5L7 7zm3 6l-5 7m8-7l5 7M4 21h16M5 4l2 3m10-3l-2 3',
  agents:
    'M7 8V6h10v2m-11 1h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2zm4 4h.01M14 13h.01M9 17c1.8 1 4.2 1 6 0',
  capabilities: 'M5 10h14v10H5V10zm3 0V7h8v3m-8 4l2-2 2 2 2-2 2 2m-7 6l2-2m5 2l-2-2',
  behaviour:
    'M8 5a4 4 0 017 2 4 4 0 013 6 4 4 0 01-5 5 4 4 0 01-7-2 4 4 0 012-11zm2 7h.01M14 12h.01M10 15c1.2.8 2.8.8 4 0'
}

void I
const TOY: Record<Tab, string> = {
  chat: '💬',
  memory: '🕸️',
  observatory: '🔭',
  agents: '🤖',
  capabilities: '🧰',
  behaviour: '🧠'
}

const NAV: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'observatory', label: 'Observatory' },
  { id: 'agents', label: 'Models' },
  { id: 'capabilities', label: 'Skills · Hooks · Tools' },
  { id: 'behaviour', label: 'Behaviour' }
]

function MainApp(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  const [driven, setDriven] = useState(false) // un agent pilote → halo sur la vue
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(['chat']))

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
            <ChatView isActive={tab === 'chat'} />
          </div>
        )}
        {visitedTabs.has('memory') && (
          <div className={`view-slot${tab === 'memory' ? ' is-active' : ''}`}>
            <GraphView visualMode="serious" onCleanMemory={openBrainwashConversation} />
          </div>
        )}
        {visitedTabs.has('observatory') && (
          <div className={`view-slot${tab === 'observatory' ? ' is-active' : ''}`}>
            <ObservatoryView active={tab === 'observatory'} />
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
