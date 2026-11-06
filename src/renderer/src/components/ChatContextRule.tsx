import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'

type Bords = { gauche: number; droite: number }

/**
 * MEME LARGEUR QUE LA JAUGE DES QUOTAS, EN BAS (2026-10-31 : « la barre de contexte en
 * haut faut la mettre de la meme largeur que celle d'en bas (donc moins large) »). Celle du bas
 * suit la rangee du champ de saisie, dont les marges changent avec le theme et la largeur du chat :
 * on MESURE ses bords au lieu de recopier les marges de chaque theme. Une ancre CSS ne peut pas la
 * viser : elle n'est pas dans l'en-tete, qui sert de repere a cette jauge. Jauge du bas absente :
 * `undefined`, la regle CSS garde la pleine largeur.
 */
function useBordsDeLaJaugeDuBas(
  zoneRef: RefObject<HTMLDivElement | null>,
  visible: boolean
): Bords | undefined {
  const [bords, setBords] = useState<Bords>()
  useLayoutEffect(() => {
    const zone = zoneRef.current
    // Le repere de la jauge : `.chat-head { position: relative }` (ChatView.css).
    const entete = zone?.closest('.chat-head')
    const chat = zone?.closest('.chat')
    if (!visible || !zone || !(entete instanceof HTMLElement) || !chat) return
    const mesurer = (): void => {
      const bas = chat.querySelector('.composer-input-row > .model-quota')
      const b = bas?.getBoundingClientRect()
      if (!b || b.width <= 0) {
        setBords(undefined)
        return
      }
      const e = entete.getBoundingClientRect()
      // Le zoom du mode malvoyant multiplie `left`/`right` : on repasse en px CSS (meme correction
      // que ContextGaugeIndicator).
      const z = (entete as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1
      const suivant = {
        gauche: Math.round((b.left - e.left) / z),
        droite: Math.round((e.right - b.right) / z)
      }
      setBords((avant) =>
        avant?.gauche === suivant.gauche && avant.droite === suivant.droite ? avant : suivant
      )
    }
    mesurer()
    if (typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(entete)
    const rangee = chat.querySelector('.composer-input-row')
    if (rangee) observateur.observe(rangee)
    return () => observateur.disconnect()
  }, [zoneRef, visible])
  return bords
}

/**
 * LA JAUGE DE CONTEXTE, SEPARATEUR ENTRE L'EN-TETE DU CHAT ET LE FIL (2026-10-10 :
 * « la barre de contexte met-la en haut comme separateur entre le header du chat et le chat, et des
 * couleurs un peu plus dorees »).
 *
 * Elle etait peinte sur le filet au-dessus de la zone de saisie (ChatComposer, demande,
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
  const { t } = useTextesChatFil()
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
  const bords = useBordsDeLaJaugeDuBas(zoneRef, ratio != null)

  if (ratio == null) return null
  const remplissage = `${Math.min(100, Math.max(0, ratio * 100))}%`
  return (
    <div
      ref={zoneRef}
      className="chat-context-rule"
      data-testid="chat-context-rule"
      data-context-level={level ?? 'ok'}
      style={
        {
          '--context-fill': remplissage,
          ...(bords ? { left: bords.gauche, right: bords.droite } : {})
        } as CSSProperties
      }
      title={panelNode ? undefined : title}
      onPointerEnter={() => setSurvole(true)}
      onPointerLeave={() => setSurvole(false)}
      onClick={() => setFige((f) => !f)}
    >
      {/* LE MOT « contexte » AU BOUT DU REMPLISSAGE (2026-10-10 : « qu'il y ait ecrit
          contexte au bout de la jauge, pas tout a droite mais a droite de la jauge qui progresse ») :
          il suit la pointe, le rail gris reprend apres lui (ChatView.css). */}
      <span className="chat-context-rule-libelle" aria-hidden="true">
        {t('contexte.libelle')}
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
