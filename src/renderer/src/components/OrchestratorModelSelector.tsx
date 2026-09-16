import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildOrchestratorModelGroups,
  type OrchestratorModelOption,
  type RuntimeModel
} from './chat-view-model'
import { ModelEffortMatrix, type ModelEffortRow } from './ModelEffortMatrix'
import { EFFORT_LABELS } from './model-effort-labels'
import { shortModelLabel } from './model-display-label'
import './ChatView.css'
// Les puces de compte (.router-account-chip, .is-active = compte retenu encadré) sont stylées ici.
import './RouterView.css'
import { Spinner } from './Spinner'
import { useClampDansFenetre } from './useClampDansFenetre'

/**
 * L'état d'authentification d'un provider, tel que Routage le charge déjà (`providerStatus()`).
 *
 * Il manquait ici : choisir un modèle par défaut sur un provider expiré, absent ou en standby
 * produisait un échec au PREMIER prompt, sans aucun signal au moment du choix.
 */
export interface OrchestratorProviderStatus {
  provider: string
  status: string
}

/**
 * Le choix de COMPTE Claude, a l'echelle de la conversation ouverte.
 *
 * Meme matiere que le bloc « Comptes » de Routage (memes classes, memes puces), mais le clic ne
 * pilote plus seulement le compte de l'application : il est MEMORISE sur la conversation, qui
 * repartira dessus a chaque tour. Bloc OPTIONNEL : sans cette prop, la pop-up est celle d'avant —
 * c'est ce qui laisse Routage inchange.
 */
export interface OrchestratorAccounts {
  accounts: Array<{ id: string; displayName: string; tier?: string; email?: string }>
  /** Le compte retenu POUR CETTE CONVERSATION, ou undefined = celui de l'application. */
  selectedId?: string
  /** Le compte actif de l'application — sert de repli visuel quand la conversation n'en fixe aucun. */
  activeId?: string
  busy: boolean
  error: string | null
  onSelect: (accountId: string) => void
}

const STATUT_LABEL: Record<string, string> = {
  authenticated: 'Authentifié',
  expired: 'Expiré · à reconnecter',
  'installed-untested': 'Installé · validité non testée',
  absent: 'Non connecté',
  unknown: 'Indéterminé',
  standby: 'En standby'
}

/** Les états sous lesquels un prompt ne partirait pas : le choix est refusé, pas juste décoré. */
const STATUTS_BLOQUANTS = new Set(['expired', 'absent', 'standby'])

export function OrchestratorModelSelector({
  busy,
  catalogLoaded,
  models,
  statuses,
  binding,
  pending,
  error,
  onSelect,
  comptes
}: {
  busy: boolean
  catalogLoaded: boolean
  models: RuntimeModel[]
  /** Absent = aucun statut connu : aucune option n'est alors bloquée (comportement d'avant). */
  statuses?: OrchestratorProviderStatus[]
  binding: { provider: string; model?: string; reasoningEffort?: string } | null
  pending: boolean
  error: string | null
  onSelect: (option: OrchestratorModelOption) => void
  /** Absent = aucun bloc « Compte » (cas de Routage : rien ne change pour lui). */
  comptes?: OrchestratorAccounts
}): React.JSX.Element {
  const statutDe = (provider: string): string | undefined =>
    statuses?.find((s) => s.provider === provider)?.status
  const dropdownRef = useRef<HTMLDetailsElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /*
   * LE MENU EST PEINT AU-DESSUS DE TOUTE L'APP, PAS DANS LE COMPOSER.
   *
   * Defaut vecu le 2026-09-12 : rendu dans `.chat` (qui est `position: relative` SANS z-index,
   * donc ne cree aucun contexte d'empilement propre), la matrice de 600px se faisait rogner et
   * recouvrir par le panneau des runs des que la fenetre etait etroite — la colonne HIGH et le
   * bloc « compte » devenaient invisibles. Un `z-index` local n'y pouvait rien : il faut sortir
   * du conteneur. On le rend donc dans `document.body`, en `position: fixed`, ancre sur le
   * bouton — plus aucun parent ne peut le couper.
   */
  const [ancre, setAncre] = useState<{ left: number; bottom: number } | null>(null)
  useClampDansFenetre(menuRef, ancre !== null)
  const mesurerAncre = useCallback((): void => {
    const resume = dropdownRef.current?.querySelector('summary')
    if (!resume) return
    const rect = resume.getBoundingClientRect()
    setAncre({ left: rect.left, bottom: window.innerHeight - rect.top + 7 })
  }, [])
  useEffect(() => {
    if (!ancre) return
    window.addEventListener('resize', mesurerAncre)
    return () => window.removeEventListener('resize', mesurerAncre)
  }, [ancre, mesurerAncre])
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const dropdown = dropdownRef.current
      if (
        dropdown?.open &&
        event.target instanceof Node &&
        !dropdown.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        dropdown.removeAttribute('open')
        setAncre(null)
        setExpandedModel(null)
      }
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [])
  const grouped = useMemo(
    () => buildOrchestratorModelGroups(models, binding ?? undefined),
    [models, binding]
  )
  const currentCatalogModel = binding?.model
    ? models.find(
        (item) =>
          item.provider === binding.provider &&
          (item.model === binding.model || item.id === binding.model)
      )?.model
    : undefined
  const currentOption = grouped.groups
    .flatMap((group) => group.options)
    .find(
      (option) =>
        option.provider === binding?.provider &&
        option.model === (currentCatalogModel ?? binding?.model)
    )
  /**
   * Lignes de la matrice MODEL × EFFORT : mêmes options que le menu, mêmes efforts issus du
   * catalogue, même refus des providers injoignables. Aucune liste d'efforts en dur.
   */
  const matrixRows: ModelEffortRow[] = grouped.groups.flatMap((group) =>
    group.options
      .map((option) => {
        const statut = statutDe(option.provider)
        const injoignable = statut !== undefined && STATUTS_BLOQUANTS.has(statut)
        return {
          key: `${option.provider}:${option.model}`,
          label: option.label,
          model: option.model,
          option,
          efforts: option.reasoningEfforts.filter((effort) => effort !== 'none'),
          blocked: injoignable,
          blockedReason: injoignable
            ? `${option.provider} : ${STATUT_LABEL[statut as string] ?? statut} — reconnecte ce provider dans Routage`
            : undefined
        }
      })
      .filter((row) => row.efforts.length > 0)
  )
  const activeMatrixKey =
    binding?.provider && (currentCatalogModel ?? binding?.model)
      ? `${binding.provider}:${currentCatalogModel ?? binding.model}`
      : null

  const disabled = busy || pending || models.length === 0
  const currentLabel = !catalogLoaded ? (
    <>
      <Spinner /> Chargement des modèles…
    </>
  ) : models.length === 0 ? (
    'Aucun modèle disponible'
  ) : (
    shortModelLabel(
      grouped.currentMissing?.label ?? currentOption?.label ?? 'Choisir une cible',
      grouped.currentMissing?.provider ?? currentOption?.provider
    )
  )

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const dropdown = dropdownRef.current
      if (
        !dropdown?.open ||
        !(event.target instanceof Node) ||
        dropdown.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return
      }
      dropdown.open = false
      setAncre(null)
      setExpandedModel(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  return (
    <div className="model-select-shell">
      <span className="model-select-label">Orchestrateur</span>
      <details
        ref={dropdownRef}
        id="chat-orchestrator-model"
        data-testid="chat-orchestrator-model"
        className="model-select"
        aria-describedby="chat-orchestrator-model-help chat-orchestrator-model-status"
        data-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault()
        }}
        onToggle={(event) => {
          if ((event.currentTarget as HTMLDetailsElement).open) mesurerAncre()
          else setAncre(null)
        }}
      >
        <summary aria-disabled={disabled}>
          <strong>{currentLabel}</strong>
          {binding?.reasoningEffort && binding.reasoningEffort !== 'none' && (
            <em>{EFFORT_LABELS[binding.reasoningEffort] ?? binding.reasoningEffort}</em>
          )}
          {pending ? <Spinner /> : <i className="model-select-chevron" />}
        </summary>
        {ancre &&
          createPortal(
            <div
              ref={menuRef}
              className="model-select-menu is-flottant"
              role="listbox"
              aria-label="Modèle orchestrateur"
              style={{ left: ancre.left, bottom: ancre.bottom }}
            >
            {matrixRows.length > 0 && (
              <ModelEffortMatrix
                variant="inline"
                title="MODEL × EFFORT"
                rows={matrixRows}
                activeKey={activeMatrixKey}
                activeEffort={
                  binding?.reasoningEffort && binding.reasoningEffort !== 'none'
                    ? binding.reasoningEffort
                    : undefined
                }
                onSelect={onSelect}
                onClose={() => dropdownRef.current?.removeAttribute('open')}
              />
            )}
            {grouped.groups.map((group) => {
              // Les modèles À EFFORTS vivent dans la matrice ci-dessus : ne rester ici que ceux
              // qui n'exposent aucun cran (sinon le même choix existerait deux fois).
              const sansEffort = group.options.filter(
                (option) => option.reasoningEfforts.filter((effort) => effort !== 'none').length === 0
              )
              if (sansEffort.length === 0) return null
              return (
                <section key={group.key} className="model-select-group">
                  <span>{group.label}</span>
                  {sansEffort.map((option) => {
                    const optionKey = `${option.provider}:${option.model}`
                    const selectableEfforts = option.reasoningEfforts.filter(
                      (effort) => effort !== 'none'
                    )
                    const active =
                      option.provider === binding?.provider &&
                      option.model === (currentCatalogModel ?? binding?.model)
                    const statut = statutDe(option.provider)
                    const injoignable = statut !== undefined && STATUTS_BLOQUANTS.has(statut)
                    return (
                      <div key={optionKey} className="model-select-option">
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-provider-status={statut}
                          aria-disabled={injoignable || undefined}
                          title={
                            injoignable
                              ? `${option.provider} : ${STATUT_LABEL[statut] ?? statut} — reconnecte ce provider dans Routage avant de l’imposer par défaut`
                              : undefined
                          }
                          aria-expanded={
                            selectableEfforts.length > 0 ? expandedModel === optionKey : undefined
                          }
                          onClick={() => {
                            // Un provider expiré, absent ou en standby échouerait au premier prompt :
                            // le choix est REFUSÉ au moment où il se fait, pas découvert à l'envoi.
                            if (injoignable) return
                            if (selectableEfforts.length === 0) {
                              dropdownRef.current?.removeAttribute('open')
                              setExpandedModel(null)
                              onSelect({ ...option, reasoningEffort: 'none' })
                              return
                            }
                            setExpandedModel((current) => (current === optionKey ? null : optionKey))
                          }}
                        >
                          <span>
                            <strong>{shortModelLabel(option.label, option.provider)}</strong>
                            <small>{option.model}</small>
                            {statut && statut !== 'authenticated' && (
                              <small className={`model-option-status is-${statut}`}>
                                {STATUT_LABEL[statut] ?? statut}
                              </small>
                            )}
                          </span>
                          {selectableEfforts.length > 0 && <i className="model-option-chevron">›</i>}
                        </button>
                        {selectableEfforts.length > 0 && expandedModel === optionKey && (
                          <div
                            className="model-effort-menu"
                            aria-label={`Effort pour ${option.label}`}
                          >
                            {selectableEfforts.map((effort) => {
                              const effortActive = active && effort === binding?.reasoningEffort
                              return (
                                <button
                                  key={effort}
                                  type="button"
                                  className={effortActive ? 'is-active' : ''}
                                  onClick={() => {
                                    dropdownRef.current?.removeAttribute('open')
                                    setExpandedModel(null)
                                    onSelect({ ...option, reasoningEffort: effort })
                                  }}
                                >
                                  <span>{effort}</span>
                                  {effortActive && <i>✓</i>}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </section>
              )
            })}
            {comptes && comptes.accounts.length > 0 && (
              <div className="router-accounts" data-testid="conv-claude-accounts">
                <span className="router-accounts-title">Compte de cette conversation</span>
                <div className="router-accounts-list">
                  {comptes.accounts.map((account) => {
                    const choisi =
                      comptes.selectedId === undefined
                        ? account.id === comptes.activeId
                        : comptes.selectedId === account.id
                    return (
                      <button
                        key={account.id}
                        type="button"
                        className={`router-account-chip${choisi ? ' is-active' : ''}`}
                        data-testid={`conv-claude-account-${account.id}`}
                        aria-pressed={choisi}
                        disabled={comptes.busy}
                        title={account.email ?? account.displayName}
                        onClick={() => comptes.onSelect(account.id)}
                      >
                        {account.displayName}
                        {account.tier && <em className="router-account-tier">{account.tier}</em>}
                      </button>
                    )
                  })}
                </div>
                {comptes.error && (
                  <p
                    className="router-account-error"
                    role="alert"
                    data-testid="conv-claude-account-error"
                  >
                    Action impossible : {comptes.error}
                  </p>
                )}
                <p className="router-hint">
                  Ce compte est retenu pour cette conversation : chacun de ses tours repart dessus.
                </p>
              </div>
            )}
            </div>,
            document.body
          )}
      </details>
      <span id="chat-orchestrator-model-help" className="model-select-help">
        {busy
          ? 'Sélecteur verrouillé pendant le tour en cours de cette conversation.'
          : 'Le changement s’appliquera au prochain tour. La conversation Autowin et son historique sont conservés.'}
      </span>
      <span
        id="chat-orchestrator-model-status"
        className="model-select-status"
        role="status"
        aria-live="polite"
      >
        {pending
          ? 'Enregistrement…'
          : (error ??
            (catalogLoaded && models.length === 0
              ? 'Catalogue de modèles vide.'
              : (grouped.currentMissing?.label ?? '')))}
      </span>
    </div>
  )
}
