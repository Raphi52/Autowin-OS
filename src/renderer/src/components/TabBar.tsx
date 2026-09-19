/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
import { useRef, useState } from 'react'
import { APP_DESTINATIONS, type Tab } from '../tabs'

const LIBELLES = new Map(APP_DESTINATIONS.map(({ id, label, icon }) => [id, { label, icon }]))

export interface TabBarProps {
  tabs: readonly Tab[]
  active: Tab | null
  onActivate: (tab: Tab) => void
  onClose: (tab: Tab) => void
  /** Réordonner dans la MÊME fenêtre : l'onglet vient se poser à l'indice donné. */
  onReorder: (tab: Tab, index: number) => void
  /** Glissé HORS de la fenêtre : l'onglet part dans sa propre fenêtre, à cette place d'écran. */
  onDetach: (tab: Tab, position: { x: number; y: number }) => void
}

/**
 * LA BARRE D'ONGLETS, comme celle d'un navigateur.
 *
 * Le glissé s'arrête ici au relâchement (`dragend`) : le navigateur ne dit PAS « tu es sorti de la
 * fenêtre », il dit seulement où était le curseur à l'écran (`screenX/screenY`) et si la cible a
 * accepté le dépôt. On détache donc quand le dépôt n'a été accepté par PERSONNE — c'est exactement
 * le cas « lâché sur le bureau ou sur le 2e écran ».
 */
export function TabBar({
  tabs,
  active,
  onActivate,
  onClose,
  onReorder,
  onDetach
}: TabBarProps): React.JSX.Element {
  const [survol, setSurvol] = useState<number | null>(null)
  const depose = useRef(false)

  return (
    <div className="tab-bar" role="tablist" data-testid="tab-bar">
      {tabs.map((id, index) => {
        const meta = LIBELLES.get(id)
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active === id}
            data-testid={`tab-${id}`}
            data-active={active === id ? 'true' : 'false'}
            className={`tab-item${active === id ? ' is-active' : ''}${survol === index ? ' is-drop-target' : ''}`}
            draggable
            onClick={() => onActivate(id)}
            onDragStart={(e) => {
              depose.current = false
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/autowin-tab', id)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setSurvol(index)
            }}
            onDragLeave={() => setSurvol((v) => (v === index ? null : v))}
            onDrop={(e) => {
              e.preventDefault()
              depose.current = true
              setSurvol(null)
              const deplace = e.dataTransfer.getData('text/autowin-tab') as Tab
              if (deplace && deplace !== id) onReorder(deplace, index)
            }}
            onDragEnd={(e) => {
              setSurvol(null)
              // Déposé dans la barre → déjà traité par `onDrop`. Déposé nulle part → l'utilisateur
              // a lâché l'onglet hors de l'application : il sort dans sa propre fenêtre.
              if (depose.current) return
              onDetach(id, { x: e.screenX, y: e.screenY })
            }}
          >
            <span className="tab-item__icon" aria-hidden="true">
              {meta?.icon ?? '•'}
            </span>
            <span className="tab-item__label">{meta?.label ?? id}</span>
            <button
              type="button"
              className="tab-item__close"
              data-testid={`tab-close-${id}`}
              aria-label={`Fermer ${meta?.label ?? id}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
