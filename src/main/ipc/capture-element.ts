/**
 * LE CANAL DE LA CAPTURE D'UN ÉLÉMENT DE L'INTERFACE (Alt+clic, conv-1338, 2026-10-30).
 *
 * L'interface envoie le rectangle de l'élément ciblé, en pixels de la fenêtre ; la capture en sort
 * pour être jointe au brouillon du fil. Elle ne vise que la fenêtre qui demande (`event.sender`).
 *
 * Le rectangle est contrôlé ICI et pas seulement à l'envoi : un rectangle de largeur 0 rend presque
 * toute la fenêtre au lieu de rien (sonde hors écran : 790×590), donc un clic mal mesuré joindrait
 * l'écran entier à un message. Une capture qui échoue (`UnknownVizError` hors de la fenêtre, image
 * vide) rend `null` : la référence texte part sans image, elle ne casse pas le geste.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'

/** Largeur maximale d'une surface Chromium : au-delà, ce n'est plus une mesure d'écran. */
const COTE_MAX = 32768

export interface RectanglePage {
  x: number
  y: number
  width: number
  height: number
}

/** Le rectangle en pixels entiers, ou une erreur qui nomme ce qui a été reçu. */
export function rectangleDeCapture(valeur: unknown): RectanglePage {
  const { x, y, largeur, hauteur } = (valeur ?? {}) as Record<string, unknown>
  const dansLaFenetre = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= COTE_MAX
  if (
    !dansLaFenetre(x) ||
    !dansLaFenetre(y) ||
    !dansLaFenetre(largeur) ||
    !dansLaFenetre(hauteur) ||
    largeur <= 0 ||
    hauteur <= 0
  )
    throw new Error(`Rectangle de capture invalide : ${JSON.stringify(valeur) ?? 'absent'}`)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(largeur)),
    height: Math.max(1, Math.round(hauteur))
  }
}

/** La page capturable : sous-ensemble de `WebContents`, pour tester sans fenêtre. */
export interface PageCapturable {
  capturePage(rect: RectanglePage): Promise<{ isEmpty(): boolean; toDataURL(): string }>
}

export async function capturerElement(page: PageCapturable, rect: unknown): Promise<string | null> {
  const rectangle = rectangleDeCapture(rect)
  try {
    const image = await page.capturePage(rectangle)
    return image.isEmpty() ? null : image.toDataURL()
  } catch {
    return null
  }
}

export function registerCaptureElementIpc(): void {
  ipcMain.handle('app:capturer-element', (event, rect: unknown) => {
    assertTrustedRendererSender(event, 'Capture d’un élément')
    return capturerElement(event.sender, rect)
  })
}
