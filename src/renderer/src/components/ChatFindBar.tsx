import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  effacerPeinture,
  indexSuivant,
  occurrencesDansLeDom,
  peindreOccurrences,
  revelerOccurrence
} from './chat-find'

/**
 * Barre « Ctrl+F » du fil (conv-21).
 *
 * COMPOSANT SÉPARÉ À DESSEIN : le terme cherché vit ici, pas dans `ChatView`. Frapper un
 * caractère ne re-rend donc que cette barre — les N messages du fil, mémoïsés, ne bougent pas
 * (le gel mesuré à la frappe, `ChatView.frappe-cout.test.tsx`, reste fermé).
 *
 * La recherche lit le DOM DÉJÀ RENDU (`occurrencesDansLeDom`), donc elle voit exactement ce que
 * l'utilisateur voit, y compris le texte produit par le rendu Markdown.
 */

/** Le fil ne se relit qu'après une pause de frappe : chercher à chaque touche balaie tout le DOM. */
const AMORTISSEMENT_MS = 160

export function ChatFindBar({
  racine,
  onFermer
}: {
  /** Le conteneur défilant du fil, lu au moment de la recherche (il peut changer de contenu). */
  racine: () => HTMLElement | null
  onFermer: () => void
}): React.JSX.Element {
  const [terme, setTerme] = useState('')
  const [rang, setRang] = useState(-1)
  const [total, setTotal] = useState(0)
  const plagesRef = useRef<Range[]>([])
  const champRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    champRef.current?.focus()
    champRef.current?.select()
  }, [])

  // Toute peinture disparaît avec la barre : un surlignage survivant à la fermeture serait un
  // décor qu'aucun geste ne pourrait plus retirer.
  useEffect(() => () => effacerPeinture(), [])

  /**
   * Relit le fil et se place sur une occurrence. `pas = 0` = nouvelle recherche (on repart de la
   * première), sinon on avance ou recule EN BOUCLE. Toujours une relecture du DOM : le fil peut
   * avoir grandi (tour en cours) depuis la frappe précédente.
   */
  const parcourir = useCallback(
    (recherche: string, pas: number, rangCourant: number) => {
      const plages = occurrencesDansLeDom(racine(), recherche)
      plagesRef.current = plages
      setTotal(plages.length)
      if (plages.length === 0) {
        setRang(-1)
        peindreOccurrences([], null)
        return
      }
      const suivant = pas === 0 ? 0 : indexSuivant(rangCourant, plages.length, pas)
      setRang(suivant)
      peindreOccurrences(plages, plages[suivant] ?? null)
      revelerOccurrence(plages[suivant])
    },
    [racine]
  )

  useEffect(() => {
    const attente = window.setTimeout(() => parcourir(terme, 0, -1), AMORTISSEMENT_MS)
    return () => window.clearTimeout(attente)
  }, [terme, parcourir])

  const etiquette = total > 0 ? `${rang + 1}/${total}` : terme.trim() ? 'Aucun résultat' : ' '

  return (
    <div className="chat-find" data-testid="chat-find" role="search">
      <span className="chat-find-icone" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={champRef}
        className="chat-find-input"
        data-testid="chat-find-input"
        type="text"
        value={terme}
        placeholder="Chercher dans la conversation"
        aria-label="Chercher dans la conversation"
        onChange={(event) => setTerme(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onFermer()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            parcourir(terme, event.shiftKey ? -1 : 1, rang)
          }
        }}
      />
      <span className="chat-find-count" data-testid="chat-find-count" aria-live="polite">
        {etiquette}
      </span>
      <button
        type="button"
        className="chat-find-nav"
        aria-label="Résultat précédent"
        title="Résultat précédent (Maj+Entrée)"
        disabled={total === 0}
        onClick={() => parcourir(terme, -1, rang)}
      >
        ↑
      </button>
      <button
        type="button"
        className="chat-find-nav"
        aria-label="Résultat suivant"
        title="Résultat suivant (Entrée)"
        disabled={total === 0}
        onClick={() => parcourir(terme, 1, rang)}
      >
        ↓
      </button>
      <button
        type="button"
        className="chat-find-close"
        data-testid="chat-find-close"
        aria-label="Fermer la recherche"
        title="Fermer (Échap)"
        onClick={onFermer}
      >
        ✕
      </button>
    </div>
  )
}
