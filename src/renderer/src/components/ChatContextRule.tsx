import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * LA JAUGE DE CONTEXTE, SEPARATEUR ENTRE L'EN-TETE DU CHAT ET LE FIL (conv-179, 2026-10-10 :
 * « la barre de contexte met-la en haut comme separateur entre le header du chat et le chat, et des
 * couleurs un peu plus dorees »).
 *
 * Elle etait peinte sur le filet au-dessus de la zone de saisie (ChatComposer, demande conv-240,
 * reference claude.exe). Elle se pose desormais SUR le filet du bas de l'en-tete, qui lui sert de
 * rail : rien n'est ajoute a la hauteur de l'ecran. La part occupee de la fenetre du modele se lit
 * de gauche a droite.
 *
 * Memes gestes qu'avant (demandes du 2026-09-04 et du 2026-09-08) : le survol ouvre le panneau de
 * detail fabrique par le parent, le clic le FIGE pour qu'on puisse viser Compacter, un clic
 * ailleurs ou Echap le referme. Sans panneau, une bulle de texte, et le `title` natif en repli.
 *
 * Occupation INCONNUE (`ratio` absent) : rien n'est rendu, le filet de l'en-tete reste gris. 0 %
 * affirmerait a tort que le fil est vide.
 */
export function ChatContextRule({
  ratio,
  level,
  title,
  panelNode
}: {
  /** Part occupee de la fenetre du modele, entre 0 et 1 ; absente = on ne SAIT pas. */
  ratio?: number
  /** Palier deja decide par `contextGauge()` : la vue peint, elle ne juge pas. */
  level?: 'ok' | 'tendu' | 'critique'
  /** Libelle de survol, ecrit par le parent qui detient les nombres. */
  title?: string
  /** Panneau de detail (avec l'action Compacter), fabrique par le parent. */
  panelNode?: ReactNode
}): React.JSX.Element | null {
  const [survole, setSurvole] = useState(false)
  const [fige, setFige] = useState(false)
  const zoneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!fige) return
    const fermer = (event: PointerEvent): void => {
      if (!zoneRef.current?.contains(event.target as Node)) setFige(false)
    }
    const echap = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFige(false)
    }
    document.addEventListener('pointerdown', fermer)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('pointerdown', fermer)
      document.removeEventListener('keydown', echap)
    }
  }, [fige])

  if (ratio == null) return null
  const remplissage = `${Math.min(100, Math.max(0, ratio * 100))}%`
  return (
    <div
      ref={zoneRef}
      className="chat-context-rule"
      data-testid="chat-context-rule"
      data-context-level={level ?? 'ok'}
      style={{ '--context-fill': remplissage } as CSSProperties}
      title={panelNode ? undefined : title}
      onPointerEnter={() => setSurvole(true)}
      onPointerLeave={() => setSurvole(false)}
      onClick={() => setFige((f) => !f)}
    >
      {/* LE MOT « contexte » AU BOUT DU REMPLISSAGE (conv-189, 2026-10-10 : « qu'il y ait ecrit
          contexte au bout de la jauge, pas tout a droite mais a droite de la jauge qui progresse ») :
          il suit la pointe, le rail gris reprend apres lui (ChatView.css). */}
      <span className="chat-context-rule-libelle" aria-hidden="true">
        contexte
      </span>
      {panelNode ? (
        survole || fige ? panelNode : null
      ) : title ? (
        <span className="chat-context-rule-bulle" role="tooltip">
          {title}
        </span>
      ) : null}
    </div>
  )
}
