/**
 * LE PONT ENTRE L'ACCUEIL ET LA SCÈNE (conv-1421).
 *
 * La scène vit dans `.decor-de-fond`, derrière toute l'application, et ne reçoit aucun clic (`z-index`
 * négatif, `pointer-events: none`, voir `theme.css`). Elle y reste : c'est ce qui lui fait prendre toute
 * la fenêtre et ce qui la met en veille comme les autres fonds. C'est donc l'Accueil, au-dessus d'elle,
 * qui reçoit les gestes et les lui passe ici. Le fond ne dépend ainsi ni de React ni de la navigation.
 */
import type { HomeWidgetId } from '../components/home-layout'

export interface RectQuartier {
  x: number
  y: number
  w: number
  h: number
}

export type CibleQuartier =
  | { type: 'vue'; cle: string; destination: string; rect: RectQuartier }
  | { type: 'tour'; cle: string; widget: HomeWidgetId; rect: RectQuartier }
  | { type: 'agent'; id: string; titre: string; rect: RectQuartier }

export interface PiloteQuartier {
  /** Ce qui se trouve sous le pointeur, en coordonnées de la fenêtre. */
  cibleSous(clientX: number, clientY: number): CibleQuartier | null
  /** Allume le contour de ce que survole le pointeur. */
  survoler(cible: CibleQuartier | null): void
  /** Zoome sur la cible ; la promesse se résout quand la vue peut s'ouvrir. */
  zoomerSur(cible: CibleQuartier): Promise<void>
  /** Le maillet frappe le grand gong. */
  frapperGong(avecSon: boolean): void
  /** Où est la tour de ce widget à l'écran : le widget en sort, et y rentre. */
  rectDeLaTour(widget: HomeWidgetId): RectQuartier | null
  /** Le bord gauche de l'Accueil : à sa gauche, le menu cache la scène. */
  poserCadre(gauche: number): void
}

let pilote: PiloteQuartier | null = null

export function brancherQuartier(p: PiloteQuartier): void {
  pilote = p
}

export function debrancherQuartier(p: PiloteQuartier): void {
  if (pilote === p) pilote = null
}

export function piloteQuartier(): PiloteQuartier | null {
  return pilote
}
