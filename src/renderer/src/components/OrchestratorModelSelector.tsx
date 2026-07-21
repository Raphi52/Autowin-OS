import { useMemo, useRef, useState } from 'react'
import {
  buildOrchestratorModelGroups,
  type OrchestratorModelOption,
  type RuntimeModel
} from './chat-view-model'
import './ChatView.css'

const EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Léger',
  medium: 'Moyen',
  high: 'Élevé',
  xhigh: 'Très élevé',
  max: 'Max',
  ultra: 'Ultra'
}

export function OrchestratorModelSelector({
  busy,
  catalogLoaded,
  models,
  binding,
  pending,
  error,
  onSelect
}: {
  busy: boolean
  catalogLoaded: boolean
  models: RuntimeModel[]
  binding: { provider: string; model?: string; reasoningEffort?: string } | null
  pending: boolean
  error: string | null
  onSelect: (option: OrchestratorModelOption) => void
}): React.JSX.Element {
  const dropdownRef = useRef<HTMLDetailsElement>(null)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
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
  const disabled = busy || pending || models.length === 0
  const currentLabel = !catalogLoaded
    ? 'Chargement des modèles…'
    : models.length === 0
      ? 'Aucun modèle disponible'
      : `OmniRoute · ${grouped.currentMissing?.label ?? currentOption?.label ?? 'Choisir une cible'}`

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
      >
        <summary aria-disabled={disabled}>
          <strong>{currentLabel}</strong>
          {binding?.reasoningEffort && binding.reasoningEffort !== 'none' && (
            <em>{EFFORT_LABELS[binding.reasoningEffort] ?? binding.reasoningEffort}</em>
          )}
          {pending ? (
            <i className="model-select-spinner" />
          ) : (
            <i className="model-select-chevron" />
          )}
        </summary>
        <div className="model-select-menu" role="listbox" aria-label="Modèle orchestrateur">
          {grouped.groups.map((group) => (
            <section key={group.key} className="model-select-group">
              <span>{group.label}</span>
              {group.options.map((option) => {
                const optionKey = `${option.provider}:${option.model}`
                const selectableEfforts = option.reasoningEfforts.filter((effort) => effort !== 'none')
                const active =
                  option.provider === binding?.provider &&
                  option.model === (currentCatalogModel ?? binding?.model)
                return (
                  <div key={optionKey} className="model-select-option">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-expanded={
                        selectableEfforts.length > 0 ? expandedModel === optionKey : undefined
                      }
                      onClick={() => {
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
                        <strong>{option.label}</strong>
                        <small>{option.model}</small>
                      </span>
                      {selectableEfforts.length > 0 && <i className="model-option-chevron">›</i>}
                    </button>
                    {selectableEfforts.length > 0 && expandedModel === optionKey && (
                      <div className="model-effort-menu" aria-label={`Effort pour ${option.label}`}>
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
          ))}
        </div>
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
