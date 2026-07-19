import { useEffect, useState } from 'react'
import { ChatView } from './components/ChatView'
import { GraphView } from './components/GraphView'
import { HarnessView } from './components/HarnessView'
import { RolesView } from './components/RolesView'
import { HermesControlsView } from './components/HermesControlsView'
import { BehaviourView } from './components/BehaviourView'
import { LoopBuilderView } from './components/LoopBuilderView'
import { ModelQuestionPopup } from './components/ModelQuestionPopup'
import { PromptLoadView } from './components/PromptLoadView'
import { normalizeTab, type Tab } from './tabs'
import autowinLogo from './assets/autowin-logo.png'
import './assets/app-shell.css'
import './assets/cosmic-outline.css'
import { importMigratedStorage, migrateAutowinStorage } from './storage-keys'

// Icônes : petits SVG path (stroke) — style linéaire, cohérent.
const I: Record<Tab, string> = {
  chat: 'M4 5h16v10H8l-4 4V5z',
  memory: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  harness: 'M4 7h5l3-3 3 3h5v10h-5l-3 3-3-3H4V7zm5 0v10m6-10v10',
  agents: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0',
  prompt: 'M5 4h14v4H5V4zm0 6h9v4H5v-4zm0 6h12v4H5v-4',
  skills: 'M8 3h8v4h4v8h-4v4H8v-4H4V7h4V3z',
  hooks: 'M8 5a4 4 0 118 0v8a6 6 0 11-12 0v-2',
  tools: 'M14 6l4-4 4 4-4 4m-4-4L4 16l4 4L18 10',
  behaviour: 'M6 3h9l3 3v15H6V3zm3 5h6M9 12h6M9 16h4',
  loops: 'M8 7h8a5 5 0 010 10H7m1-3l-3 3 3 3M16 10l3-3-3-3'
}

const NAV: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'harness', label: 'Harnais' },
  { id: 'agents', label: 'Agents' },
  { id: 'prompt', label: 'Prompt Load' },
  { id: 'skills', label: 'Skills' },
  { id: 'hooks', label: 'Hooks' },
  { id: 'tools', label: 'Tools' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'loops', label: 'Loops' }
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
    <div className="shell cosmic-outline">
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
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={I[it.id]} />
                </svg>
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
            <GraphView />
          </div>
        )}
        {visitedTabs.has('harness') && (
          <div className={`view-slot${tab === 'harness' ? ' is-active' : ''}`}>
            <HarnessView />
          </div>
        )}
        {visitedTabs.has('agents') && (
          <div className={`view-slot${tab === 'agents' ? ' is-active' : ''}`}>
            <RolesView />
          </div>
        )}
        {visitedTabs.has('prompt') && (
          <div className={`view-slot${tab === 'prompt' ? ' is-active' : ''}`}>
            <PromptLoadView active={tab === 'prompt'} />
          </div>
        )}
        {visitedTabs.has('skills') && (
          <div className={`view-slot${tab === 'skills' ? ' is-active' : ''}`}>
            <HermesControlsView active={tab === 'skills'} kind="skills" />
          </div>
        )}
        {visitedTabs.has('hooks') && (
          <div className={`view-slot${tab === 'hooks' ? ' is-active' : ''}`}>
            <HermesControlsView active={tab === 'hooks'} kind="hooks" />
          </div>
        )}
        {visitedTabs.has('tools') && (
          <div className={`view-slot${tab === 'tools' ? ' is-active' : ''}`}>
            <HermesControlsView active={tab === 'tools'} kind="tools" />
          </div>
        )}
        {visitedTabs.has('behaviour') && (
          <div className={`view-slot${tab === 'behaviour' ? ' is-active' : ''}`}>
            <BehaviourView />
          </div>
        )}
        {visitedTabs.has('loops') && (
          <div className={`view-slot${tab === 'loops' ? ' is-active' : ''}`}>
            <LoopBuilderView />
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
