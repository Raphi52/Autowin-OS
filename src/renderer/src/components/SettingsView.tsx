import { useCallback, useEffect, useState } from 'react'
import type { SettingsSection } from '../tabs'
import { langueCourante } from '../langue'
import { traduire, useTextes } from '../textes'
import { BehaviourView } from './BehaviourView'
import { CapabilitiesView, type CapabilityKind } from './CapabilitiesView'
import { ExecutionWorkspaceSettings } from './ExecutionWorkspaceSettings'
import { BrainSettings } from './BrainSettings'
import { BrainPersoSettings } from './BrainPersoSettings'
import { RulesView } from './RulesView'
import { InterfaceView } from './InterfaceView'
import { ModeAutoSeuilsSettings } from './ModeAutoSeuilsSettings'
import { RouterView } from './RouterView'
import { ShadowRoutingPilotSettings } from './ShadowRoutingPilotSettings'
import { useProvidersAReconnecter } from './useProvidersAReconnecter'
import { OngletMarques, ViewTopBar, type ViewTopBarTab } from './ViewTopBar'
import './ViewPage.css'
import './DomainShell.css'
import './SettingsView.css'
import { Spinner } from './Spinner'

type PreflightResult = Awaited<ReturnType<typeof window.api.recheckPreflight>>

interface ProviderRow {
  provider: string
  status: string
  detail?: string
}

/** Le registre de capacités qu'ouvre chaque section qui en montre un (conv-1109). */
const REGISTRE_DE_SECTION: Partial<Record<SettingsSection, CapabilityKind>> = {
  capabilities: 'skills',
  hooks: 'hooks',
  gates: 'gates',
  mods: 'plugins',
  tools: 'tools'
}

/** Controles qui ont un plan de reparation cote main — voir planPreflightRepair. */
const REPARABLES = new Set(['claude-session', 'brain', 'brain-venv'])

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
  // Les textes suivent la langue de Settings · Interface, sans redémarrage (conv-1146).
  const { t } = useTextes()
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
      setError(traduire('settings.preflight.erreur', langueCourante()))
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
        if (alive) setProvidersError(traduire('settings.providers.nonExpose', langueCourante()))
        return
      }
      try {
        const rows = await load()
        if (alive) {
          setProviders(rows as ProviderRow[])
          setProvidersError(null)
        }
      } catch {
        if (alive) setProvidersError(traduire('settings.providers.echec', langueCourante()))
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
        setError(traduire('settings.preflight.reparationEchec', langueCourante()))
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
  /** Alerte de l'onglet Routage, venue d'Agent Studio avec lui (conv-963). */
  const providersExpires = useProvidersAReconnecter(active)

  const registre = REGISTRE_DE_SECTION[section]

  const sections: readonly ViewTopBarTab<SettingsSection>[] = [
    // Une section par registre de capacités (conv-1109) : c'était un seul écran à onglets internes.
    { id: 'capabilities', label: 'Skills' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'gates', label: 'Gates' },
    { id: 'mods', label: 'Mods' },
    { id: 'tools', label: 'Tools' },
    { id: 'behaviour', label: 'Behaviour' },
    { id: 'interface', label: 'Interface' },
    { id: 'providers', label: 'Providers' },
    {
      id: 'routing',
      label: t('settings.section.routing'),
      anomaly: {
        count: providersExpires.length,
        title: t('settings.routing.anomalie', { liste: providersExpires.join(', ') }),
        testId: 'settings-anomaly-routing'
      }
    },
    { id: 'rules', label: 'Rules' },
    {
      id: 'preflight',
      label: t('settings.section.preflight'),
      alert: {
        active: preflightAlert,
        mark: '!',
        title: t('alerte.prerequis'),
        testId: 'settings-preflight-alert'
      }
    }
  ]

  return (
    <section className="view-page domain-shell settings-view" data-testid="settings-view">
      <ViewTopBar
        eyebrow={t('settings.eyebrow')}
        title={t('settings.titre')}
        description={t('settings.description')}
      />
      {/* LES SECTIONS EN LISTE À GAUCHE, comme les conversations du chat (conv-1109, 2026-10-23).
          Elles étaient une rangée de pastilles dans la barre du haut : avec huit sections, la rangée
          passait sur deux lignes et repoussait le contenu. Une colonne garde chaque nom sur sa ligne,
          et la section ouverte se repère comme la conversation ouverte. */}
      <div className="settings-body">
        <nav className="settings-nav" aria-label={t('settings.nav')}>
          {sections.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-nav-item${tab.id === section ? ' is-active' : ''}`}
              aria-current={tab.id === section ? 'page' : undefined}
              onClick={() => onSectionChange(tab.id)}
            >
              <span className="settings-nav-label">{tab.label}</span>
              <OngletMarques tab={tab} />
            </button>
          ))}
        </nav>
        <div className="domain-content settings-content" data-section={section}>
          {registre && (
            // `key` : changer de registre remonte la vue, donc filtres et sélection repartent à zéro.
            <CapabilitiesView key={section} active={active} kind={registre} />
          )}
          {/* Section Budget retirée le 2026-10-23 (conv-1119 : « ça sert à rien cette feature »). Ses
              deux autres panneaux n'étaient pas du budget : l'arrêt du mode ∞ règle le comportement
              du chat, le pilote shadow mesure le routage — chacun rejoint la section dont il relève. */}
          {section === 'behaviour' && (
            <>
              <BehaviourView />
              <ModeAutoSeuilsSettings />
            </>
          )}
          {section === 'interface' && <InterfaceView />}
          {section === 'providers' && (
            <section className="settings-providers surface-panel" aria-label="Providers">
              <header>
                <div>
                  <span className="domain-eyebrow">{t('settings.providers.eyebrow')}</span>
                  <h2>Providers</h2>
                </div>
              </header>
              {providersError && (
                <div className="domain-warning">
                  <p role="alert">{providersError}</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setProvidersReload((token) => token + 1)}
                  >
                    {t('settings.providers.reessayer')}
                  </button>
                </div>
              )}
              {providersLoading && (
                <p role="status">
                  <Spinner /> {t('settings.providers.chargement')}
                </p>
              )}
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
                  <p>{t('settings.providers.aucun')}</p>
                ))}
              <p className="domain-hint">
                {t('settings.providers.aide.avant')}{' '}
                <button
                  type="button"
                  className="domain-link"
                  data-testid="settings-open-router"
                  onClick={() => onSectionChange('routing')}
                >
                  {t('settings.section.routing')}
                </button>
                {t('settings.providers.aide.apres')}
              </p>
            </section>
          )}
          {/* Routage vit ici depuis conv-963 (2026-10-15) : il était une section d'Agent Studio. */}
          {section === 'routing' && (
            <>
              <RouterView active={active} />
              <ShadowRoutingPilotSettings />
            </>
          )}
          {section === 'rules' && <RulesView />}
          {section === 'preflight' && <ExecutionWorkspaceSettings />}
          {section === 'preflight' && <BrainSettings />}
          {section === 'preflight' && <BrainPersoSettings />}
          {section === 'preflight' && (
            <section
              className="settings-preflight surface-panel"
              aria-label={t('settings.preflight.aria')}
            >
              <header>
                <div>
                  <span className="domain-eyebrow">{t('settings.preflight.eyebrow')}</span>
                  <h2>{t('settings.preflight.titre')}</h2>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void recheck()}
                  disabled={checking}
                >
                  {checking
                    ? t('settings.preflight.verification')
                    : t('settings.preflight.relancer')}
                </button>
              </header>
              {error && (
                <p className="domain-warning" role="alert">
                  {error}
                </p>
              )}
              {repairDone && (
                <p className="domain-ok" role="status" data-testid="settings-repair-status">
                  {t('settings.preflight.reparee', { id: repairDone })}
                </p>
              )}
              {!preflight ? (
                <p>{t('settings.preflight.intro')}</p>
              ) : (
                <>
                  <p className={preflight.ok ? 'domain-ok' : 'domain-warning'}>
                    {preflight.summary}
                  </p>
                  <ul className="settings-preflight-list">
                    {preflight.checks.map((check) => (
                      <li key={check.id} className={check.ok ? 'is-ok' : 'is-ko'}>
                        <strong>
                          <span className="settings-check-mark">{check.ok ? '✓' : '✗'}</span>{' '}
                          {check.label}
                        </strong>
                        {check.detail && <span>{check.detail}</span>}
                        {/*
                        Un bouton « Reparer » sur un constat qui ne SE repare pas est un piege : il
                        promet un geste qui ne peut pas aboutir. Seuls les controles ayant un plan de
                        reparation le portent. L historique mis de cote est un CONSTAT — le fichier
                        est nomme juste au-dessus, la restauration appartient a l utilisateur.
                      */}
                        {/*
                        UN GESTE, pas seulement un chemin. Lire « votre fichier est en D:\… » sans
                        pouvoir l'ouvrir oblige a recopier un chemin a la main. Le bouton n'existe
                        que si le controle designe un fichier ; le main verifie qu'il est toujours la
                        avant de le reveler.
                      */}
                        {check.revealPath && (
                          <button
                            type="button"
                            className="settings-preflight-repair btn btn-sm"
                            data-testid={`settings-reveal-${check.id}`}
                            onClick={() =>
                              void window.api?.openFolder?.(check.revealPath as string)
                            }
                          >
                            {t('settings.preflight.ouvrirDossier')}
                          </button>
                        )}
                        {!check.ok && REPARABLES.has(check.id) && (
                          <button
                            type="button"
                            className="settings-preflight-repair btn btn-sm"
                            data-testid={`settings-repair-${check.id}`}
                            onClick={() => void repair(check.id)}
                            disabled={repairing !== null || checking}
                          >
                            {repairing === check.id
                              ? t('settings.preflight.reparation')
                              : t('settings.preflight.reparer')}
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
      </div>
    </section>
  )
}
