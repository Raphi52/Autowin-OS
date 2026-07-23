import React from 'react'
import type { SuggestionGroup } from './scout-suggestions'
import './SuggestionGrid.css'

/**
 * Rend un retour scout comme un VRAI array de chips cliquables (groupées par catégorie), au lieu de
 * `code`-spans inertes. Un clic sur une chip envoie son label comme prompt (`onPick`).
 */
export function SuggestionGrid({
  groups,
  onPick
}: {
  groups: SuggestionGroup[]
  onPick: (prompt: string) => void
}): React.JSX.Element {
  return (
    <div className="suggestion-grid" data-testid="suggestion-grid">
      {groups.map((group) => (
        <section className="sg-group" key={group.key} data-testid="sg-group">
          <header className="sg-group-head">
            <span className="sg-key">{group.key}</span>
            <span className="sg-title">{group.title}</span>
            {group.subtitle && <span className="sg-subtitle">{group.subtitle}</span>}
          </header>
          <div className="sg-chips">
            {group.items.map((item) => (
              <button
                type="button"
                className="sg-chip"
                key={item.label}
                data-testid="sg-chip"
                onClick={() => onPick(item.label)}
                title={item.label}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
