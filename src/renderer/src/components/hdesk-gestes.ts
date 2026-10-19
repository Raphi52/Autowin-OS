// GESTES DANS L'IMAGE D'UN BUREAU CACHÉ, partagés par la petite TV du chat (HdeskTv) et l'aperçu
// agrandi de la vue « Bureaux cachés » (conv-344, scout n°2). Hors des fichiers de composant : un
// fichier de composant ne doit exporter que des composants (react-refresh/only-export-components).
import type { GesteTv, ImageTv, ResultatGeste } from '../../../main/hdesk-tv'

/** L'élément image visé : sa boîte à l'écran et, pour une capture unie, sa taille réelle. */
interface ImageCiblee {
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
  naturalWidth: number
  naturalHeight: number
}

/**
 * Point de l'écran -> pixel de la CAPTURE (x * largeur / largeur affichée). Une capture unie (page web)
 * ne porte pas sa taille : on prend celle de l'image reçue. `null` = pas d'image cliquable.
 */
export function pointDansImage(
  e: { clientX: number; clientY: number; currentTarget: ImageCiblee },
  image: ImageTv | null | undefined
): { x: number; y: number } | null {
  if (image?.statut !== 'ok' && image?.statut !== 'uni') return null
  const largeur = image.statut === 'ok' ? image.width : e.currentTarget.naturalWidth
  const hauteur = image.statut === 'ok' ? image.height : e.currentTarget.naturalHeight
  const rect = e.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height || !largeur || !hauteur) return null
  const x = Math.round(((e.clientX - rect.left) * largeur) / rect.width)
  const y = Math.round(((e.clientY - rect.top) * hauteur) / rect.height)
  // Position illisible (événement sans clientX) : aucun geste plutôt qu'un clic en NaN.
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** Molette : 1 cran par tranche de 100 px de deltaY (bas = négatif, comme Windows), ±20 au plus. */
export function cransMolette(deltaY: number): number {
  if (!deltaY || !Number.isFinite(deltaY)) return 0
  const crans = -Math.sign(deltaY) * Math.max(1, Math.round(Math.abs(deltaY) / 100))
  return Math.max(-20, Math.min(20, crans))
}

/**
 * File des gestes : un geste attend la fin du précédent, sinon deux hdesk-act se chevauchent dans le
 * même bureau (clic du second pendant la frappe du premier).
 */
export function enfilerGeste(
  file: { current: Promise<void> },
  agir: ((g: GesteTv) => Promise<ResultatGeste>) | undefined,
  geste: GesteTv,
  apres: (r: ResultatGeste) => void
): Promise<void> {
  if (!agir) return Promise.resolve()
  file.current = file.current.then(async () => {
    const r = await agir(geste).catch((e: unknown): ResultatGeste => ({
      ok: false,
      message: String(e)
    }))
    apres(r)
  })
  return file.current
}
