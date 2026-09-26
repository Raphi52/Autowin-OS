/**
 * Copie du bilan en IMAGE — hors du fichier de composant : un module qui exporte autre chose
 * qu'un composant casse le rechargement à chaud de React (règle `react-refresh`).
 *
 * Le bilan est peint en SVG puis dans un canvas local : aucune requête réseau, aucune dépendance.
 */
import { bilanEnSvg, type RunBilan } from './run-bilan'

const DELAI_MAX_MS = 3000

export async function copierBilanEnImage(bilan: RunBilan): Promise<boolean> {
  try {
    const svg = bilanEnSvg(bilan)
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const image = new Image()
    // BORNE OBLIGATOIRE : un environnement qui ne peint pas (ou une image jamais chargée) ne
    // déclenche NI `onload` NI `onerror`. Sans délai maximum, l'attente ne finit jamais et le
    // bouton reste figé sur « Copier l'image » — l'utilisateur croit son clic perdu.
    await new Promise<void>((resolve, reject) => {
      const minuteur = setTimeout(() => reject(new Error('image non chargée')), DELAI_MAX_MS)
      image.onload = () => {
        clearTimeout(minuteur)
        resolve()
      }
      image.onerror = () => {
        clearTimeout(minuteur)
        reject(new Error('image illisible'))
      }
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    // Presse-papiers refusé ou canvas indisponible : on le DIT dans le bouton, on ne ment pas.
    return false
  }
}
