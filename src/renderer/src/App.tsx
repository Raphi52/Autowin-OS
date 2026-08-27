import { useCallback, useEffect, useRef, useState } from 'react'
import packageManifest from '../../../package.json'
import { messageMoteurPerime } from '../../shared/moteur-perime'

// Gravés au build par `electron.vite.config.ts` (remplacement littéral Vite). Hors build (tests
// unitaires happy-dom, où `define` ne s'applique pas), ils sont indéfinis → repli lisible.
declare const __BUILD_NUMBER__: string
declare const __BUILD_SHA__: string
const buildNumber = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : 'dev'
const buildSha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'local'
import { ChatView } from './components/ChatView'
import { HomeView } from './components/HomeView'
import { DecorDeFond } from './components/DecorDeFond'
import { FirstRunWizard } from './components/FirstRunWizard'
import { ObservatoryView } from './components/ObservatoryView'
// L'onglet Worktrees porte la vue à FRISE D'HISTORIQUE GIT (`WorktreeView`), restaurée sur demande de
// l'utilisateur. Elle avait été supprimée en deux commits — la vue elle-même, puis son socle
// `git-graph` — et remplacée par un plan de métro des copies (`WorktreeMapView`). L'utilisateur ne
// retrouvait plus l'historique, qui était précisément ce qu'il utilisait.
//
// Le plan de métro (`WorktreeMapView`) a ensuite été SUPPRIMÉ, avec tout son membre : canal IPC
// `git:worktreeMap`, `worktree-map-main.ts`, `worktree-doctor.ts` et `shared/worktree-map.ts`. Il
// n'avait aucun consommateur, deux garde-fous le surveillaient pour rien, et du travail y a été
// dépensé sans jamais atteindre l'écran. Les chiffres qui manquaient à la frise (branche,
// changements locaux, travaux actifs, alertes) vivent dans sa barre d'état. Récupérable tel quel :
// `git checkout  -- src/renderer/src/components/WorktreeMapView.tsx` (et ses voisins).
import { WorktreeView } from './components/WorktreeView'
import { UpdateBanner } from './components/UpdateBanner'
import { pickTurnToResume } from './components/resume-unfinished'
import { TicketsView } from './components/TicketsView'
import { TaskManagerView } from './components/TaskManagerView'
import { AgentStudioView } from './components/AgentStudioView'
import { KnowledgeView } from './components/KnowledgeView'
import { SettingsView } from './components/SettingsView'
import { ModelQuestionPopup } from './components/ModelQuestionPopup'
import {
  APP_DESTINATIONS,
  resolveAppLocation,
  type AgentStudioSection,
  type SettingsSection,
  type Tab,
  type TaskManagerSection
} from './tabs'
import autowinLogo from './assets/autowin-logo-transparent.png'
import './assets/app-shell.css'
import './assets/cosmic-outline.css'
import './assets/theme-modes.css'
import './assets/ui-system.css'
import { importMigratedStorage, migrateAutowinStorage } from './storage-keys'
import type { InspectTurnTarget, ObservatoryFocus } from './observatory-focus'

const NAV = APP_DESTINATIONS

function WorktreeIcon(): React.JSX.Element {
  return (
    <svg
      data-icon="git-branch"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="3" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="21" r="2" />
      <path d="M6 5v14M18 8a9 9 0 0 1-9 9H6" />
    </svg>
  )
}

function TaskManagerIcon(): React.JSX.Element {
  return (
    <svg
      data-icon="task-manager"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="task-manager-calendar-gradient" x1="3" y1="5" x2="21" y2="21">
          <stop stopColor="#36e6ff" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect
        x="2.75"
        y="4.75"
        width="18.5"
        height="16.5"
        rx="3"
        fill="rgba(54, 230, 255, 0.1)"
        stroke="url(#task-manager-calendar-gradient)"
        strokeWidth="1.5"
      />
      <path d="M7.5 3v4M16.5 3v4M3 9.75h18" stroke="#fb7185" strokeWidth="1.7" />
      <circle
        cx="14.5"
        cy="15.25"
        r="3.75"
        fill="#f59e0b"
        fillOpacity="0.18"
        stroke="#fbbf24"
        strokeWidth="1.4"
      />
      <path d="M14.5 13.25v2.25l1.7 1" stroke="#fde68a" strokeWidth="1.35" />
      <circle cx="7.5" cy="14" r="1.15" fill="#34d399" />
    </svg>
  )
}

export function MainApp(): React.JSX.Element {
  const testInstance = new URLSearchParams(window.location.search).get('instance') === 'test'
  // L'accueil est la vue d'ouverture : c'est l'endroit ou l'on lit l'etat de sa journee d'un coup
  // d'oeil. Le repli d'une destination INCONNUE reste `chat` (voir `normalizeDestination`) : un agent
  // qui se trompe de nom doit atterrir la ou il peut parler, pas sur un tableau de bord.
  const [tab, setTab] = useState<Tab>('accueil')
  const [driven, setDriven] = useState(false) // un agent pilote → halo sur la vue
  // #11 — l'état replié/déplié de la rail est PERSISTÉ (comme le zoom), pour ne pas re-replier à
  // chaque lancement.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(
    () => localStorage.getItem('autowin:rail-collapsed') === '1'
  )
  /**
   * L'AVERTISSEMENT « moteur perime », ou `null` quand tout est sain.
   *
   * Interroge UNE FOIS a l'ouverture : la reponse compare l'instant de demarrage du processus aux
   * dates des sources, et ni l'un ni les autres ne bougent tant que l'app tourne. Repeter la
   * question ne changerait rien -- sauf a payer un balayage disque pour le meme resultat.
   */
  const [moteurPerime, setMoteurPerime] = useState<string | null>(null)
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(['accueil']))
  useEffect(() => {
    // Un pied de page ne fait jamais tomber l'interface : toute panne laisse l'avertissement absent
    // plutot que de propager une erreur. Silence = rien a signaler, jamais « on ne sait pas ».
    void window.api
      .etatDuMoteur?.()
      .then((etat) => setMoteurPerime(messageMoteurPerime(etat) ?? null))
      .catch(() => setMoteurPerime(null))
  }, [])
  const [observatoryFocus, setObservatoryFocus] = useState<ObservatoryFocus | null>(null)
  const [agentStudioSection, setAgentStudioSection] = useState<AgentStudioSection>('topology')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('capabilities')
  // L'alerte preflight vit dans la NAV principale : un prérequis KO ne doit pas rester caché
  // derrière deux clics dans l'onglet Diagnostic.
  const [preflightAlert, setPreflightAlert] = useState(false)
  // Une section choisie par l'humain (ou par une navigation ciblée) fait autorité : le défaut
  // « Diagnostic » ne s'applique que tant que personne n'a tranché.
  const settingsSectionPinned = useRef(false)
  // Planification par défaut : c'est le contenu historique de Task Manager. Le Watchdog est le second
  // écran, atteignable par le sélecteur ou par un deep-link d'agent (« va sur le watchdog »).
  const [taskManagerSection, setTaskManagerSection] = useState<TaskManagerSection>('planification')
  const [navigationOrigin] = useState(() => `renderer-${globalThis.crypto.randomUUID()}`)
  const navigationGeneration = useRef(0)

  useEffect(() => {
    document.title = testInstance ? 'Autowin OS Test' : 'Autowin OS'
  }, [testInstance])

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
        settingsSectionPinned.current = true
        setSettingsSection(location.section as SettingsSection)
      }
      if (location.destination === 'task-manager' && location.section) {
        setTaskManagerSection(location.section as TaskManagerSection)
      }
      activateTab(location.destination)
    },
    [activateTab]
  )

  useEffect(() => {
    let alive = true
    const apply = (result: { ok?: boolean; checks?: Array<{ ok: boolean }> } | null): void => {
      if (!alive || !result) return
      const ko = result.ok === false || (result.checks ?? []).some((check) => !check.ok)
      setPreflightAlert(ko)
      // Point d'entrée honnête : Settings s'ouvre sur le Diagnostic tant que quelque chose cloche.
      if (!settingsSectionPinned.current) setSettingsSection(ko ? 'preflight' : 'capabilities')
    }
    void (async () => {
      try {
        apply((await window.api?.getPreflight?.()) as never)
      } catch {
        // UN DIAGNOSTIC QUI ECHOUE N'EST PAS UN DIAGNOSTIC VERT. Ce `catch` etait vide : quand
        // `getPreflight()` jetait, aucune alerte n'etait posee et la navigation avait l'air saine
        // precisement parce que le controle de sante etait casse. Candidat du scout interne du
        // 2026-08-19 (score 82), confirme par son juge (« erreur preflight avalee »).
        //
        // L'absence d'API reste silencieuse — `window.api?.getPreflight?.()` rend alors `undefined`
        // et `apply` sort tot, sans alerte : un shell plus ancien n'est pas une panne. Seule une
        // EXCEPTION leve l'alerte, et elle ne casse toujours pas le shell.
        if (alive) {
          setPreflightAlert(true)
          if (!settingsSectionPinned.current) setSettingsSection('preflight')
        }
      }
    })()
    const off = window.api?.onPreflight?.((result) => apply(result as never))
    return () => {
      alive = false
      off?.()
    }
  }, [])

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

  // #11 — raccourcis clavier : Ctrl/Cmd+1..N changent d'onglet, Ctrl/Cmd+K focalise la recherche de
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

  /**
   * Survie niveau 2 — REPRISE AUTOMATIQUE, sans popup : au démarrage, si un tour a été interrompu
   * par la fermeture de l'app, on rouvre DIRECTEMENT sa conversation (la plus récemment active) pour
   * y retrouver ce que le CLI a produit. Rien à reprendre → démarrage normal, inchangé.
   */
  useEffect(() => {
    let alive = true
    void window.api
      .unfinishedTurns?.()
      .then((turns) => {
        if (!alive) return
        // Seule responsabilité d'App : AMENER l'utilisateur sur le Chat. L'ouverture de la
        // conversation + le rejeu du journal sont faits par ChatView, qui sait quand ses
        // conversations sont chargées (un dispatch temporisé ratait la reprise — vu en essai réel).
        if (pickTurnToResume(turns)) navigate('chat')
      })
      .catch(() => {
        /* pas de journal / IPC indisponible → démarrage normal */
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /** Preuve d'une occurrence : on ouvre la conversation réelle, le tour n'est transmis que s'il existe. */
  function openTaskConversation(target: { conversationId: string; turnId?: string }): void {
    navigate('chat')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: target }))
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
    <div
      className="shell cosmic-outline theme-serious"
      data-automation-instance={testInstance ? 'test' : 'user'}
    >
      {testInstance && (
        <div className="test-instance-banner" role="status">
          INSTANCE DE TEST — AUTOMATISATION EN COURS
        </div>
      )}
      {/* Le fond 3D de l'application, sous tout le reste. Voir `DecorDeFond`. */}
      <DecorDeFond />
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
                  {it.id === 'worktree' ? (
                    <WorktreeIcon />
                  ) : it.id === 'task-manager' ? (
                    <TaskManagerIcon />
                  ) : (
                    it.icon
                  )}
                </span>
                <span>{it.label}</span>
                {it.id === 'settings' && preflightAlert && (
                  <span
                    className="domain-badge-alert nav-alert-badge"
                    data-testid="nav-settings-alert"
                    title="Un prérequis est en échec"
                    aria-label="Un prérequis est en échec"
                  >
                    !
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
        <UpdateBanner collapsed={railCollapsed} />
        {/* Le NUMÉRO DE BUILD (nombre de commits) incrémente à chaque commit → l'utilisateur voit d'un
            coup s'il lance une version plus récente. Le SHA court lève l'ambiguïté. `__BUILD_*__` sont
            gravés au build par `electron.vite.config.ts` ; en test (non défini) on retombe proprement. */}
        <div className="rail-foot c-faint" title={`commit ${buildSha}`}>
          {`v${packageManifest.version} · build ${buildNumber} · ${buildSha}`}
        </div>
        {/* MOTEUR PÉRIMÉ — mesuré le 25/08 : `electron-vite dev` ne reconstruit PAS le processus
            principal, donc un correctif reste invisible jusqu'à un redémarrage manuel. Le renderer,
            lui, est bien rechargé à chaud : l'interface bouge, le moteur non, et rien ne le disait.
            On MONTRE au lieu de redémarrer — `--watch` tuait l'app pendant le travail
            (`dev-sans-watch.test.ts`). Rien n'est rendu quand l'état est sain. */}
        {moteurPerime && (
          <div className="rail-foot rail-foot--perime" role="status" title={moteurPerime}>
            ⚠ {moteurPerime}
          </div>
        )}
      </aside>
      <main className={`main${driven ? ' driven' : ''}`} data-driven={driven}>
        {visitedTabs.has('accueil') && (
          <div className={`view-slot${tab === 'accueil' ? ' is-active' : ''}`}>
            <HomeView active={tab === 'accueil'} onNavigate={applyLocation} />
          </div>
        )}
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
            <KnowledgeView active={tab === 'knowledge'} onCleanMemory={openBrainwashConversation} />
          </div>
        )}
        {visitedTabs.has('observatory') && (
          <div className={`view-slot${tab === 'observatory' ? ' is-active' : ''}`}>
            <ObservatoryView
              active={tab === 'observatory'}
              focus={observatoryFocus}
              onDismissFocus={() => setObservatoryFocus(null)}
              onOpenCapabilities={() => {
                setSettingsSection('capabilities')
                navigate('settings')
              }}
            />
          </div>
        )}
        {visitedTabs.has('worktree') && (
          <div className={`view-slot${tab === 'worktree' ? ' is-active' : ''}`}>
            <WorktreeView active={tab === 'worktree'} />
          </div>
        )}
        {visitedTabs.has('task-manager') && (
          <div className={`view-slot${tab === 'task-manager' ? ' is-active' : ''}`}>
            <TaskManagerView
              active={tab === 'task-manager'}
              onOpenConversation={openTaskConversation}
              section={taskManagerSection}
              onSectionChange={setTaskManagerSection}
            />
          </div>
        )}
        {visitedTabs.has('tickets') && (
          <div className={`view-slot${tab === 'tickets' ? ' is-active' : ''}`}>
            <TicketsView active={tab === 'tickets'} />
          </div>
        )}
        {visitedTabs.has('settings') && (
          <div className={`view-slot${tab === 'settings' ? ' is-active' : ''}`}>
            <SettingsView
              active={tab === 'settings'}
              section={settingsSection}
              onSectionChange={(next) => {
                settingsSectionPinned.current = true
                setSettingsSection(next)
              }}
              onOpenRouter={() => {
                setAgentStudioSection('routing')
                navigate('agent-studio')
              }}
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
