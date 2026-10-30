import { realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NOM_PAGE_INTERACTIVE, NOM_PAGE_SCENE_3D } from '../shared/scene-3d'

export class ApprovedBehaviourWorkspaces {
  private readonly roots = new Set<string>()

  constructor(defaultRoot: string) {
    this.approve(defaultRoot)
  }

  approve(path: string): string {
    const canonical = realpathSync(resolve(path))
    if (!statSync(canonical).isDirectory()) throw new Error('Le workspace doit être un dossier')
    this.roots.add(canonical.toLowerCase())
    return canonical
  }

  require(path: string): string {
    const canonical = realpathSync(resolve(path))
    if (!this.roots.has(canonical.toLowerCase()))
      throw new Error('Workspace Behaviour non approuvé par le sélecteur natif')
    return canonical
  }
}

/**
 * Verdict DÉTAILLÉ sur l'expéditeur d'un appel IPC : autorisé, ou refusé AVEC son motif.
 *
 * Vécu le 2026-08-12 : deux appels ont échoué sur « Origine renderer non autorisée », impossibles
 * à reproduire ensuite (le garde passe en `dev` comme en `--watch`, origine `http://localhost:5173`
 * mesurée dans les deux cas). Ce qui reste établi est dans le code : une frame DÉTACHÉE — ce qui
 * arrive pendant un rechargement — donne une URL vide, et le garde annonçait alors une origine
 * « non autorisée » sans avoir observé la moindre origine. Le message envoyait chercher une faille
 * de sécurité là où il y a un problème de cycle de vie.
 *
 * Aucun relâchement : les deux cas restent REFUSÉS. On cesse seulement de les confondre.
 */
export type VerdictExpediteur =
  | { trusted: true }
  | { trusted: false; cause: 'frame-indisponible' }
  | { trusted: false; cause: 'origine-refusee'; origine?: string }

export function diagnostiquerExpediteurRenderer(
  senderUrl: string | undefined,
  options: { devRendererUrl?: string; rendererHtmlPath?: string }
): VerdictExpediteur {
  if (!senderUrl) return { trusted: false, cause: 'frame-indisponible' }
  if (isTrustedRendererUrl(senderUrl, options)) return { trusted: true }
  try {
    return { trusted: false, cause: 'origine-refusee', origine: new URL(senderUrl).origin }
  } catch {
    return { trusted: false, cause: 'origine-refusee' }
  }
}

export function isTrustedRendererUrl(
  senderUrl: string,
  options: { devRendererUrl?: string; rendererHtmlPath?: string }
): boolean {
  try {
    const sender = new URL(senderUrl)
    if (options.devRendererUrl) return sender.origin === new URL(options.devRendererUrl).origin
    if (!options.rendererHtmlPath || sender.protocol !== 'file:') return false
    const expected = pathToFileURL(resolve(options.rendererHtmlPath))
    return (
      sender.host.toLowerCase() === expected.host.toLowerCase() &&
      decodeURIComponent(sender.pathname).toLowerCase() ===
        decodeURIComponent(expected.pathname).toLowerCase()
    )
  } catch {
    return false
  }
}

/**
 * Les SEULES pages qu'un cadre du fil peut charger en plus d'une URL locale (`data:`/`blob:`) : la
 * page des scenes 3D (`scene-3d.html`, a cote de `index.html`), servie par l'app elle-meme, et
 * depuis conv-1304 (2026-10-30) sa jumelle SANS moteur 3D (`page-interactive.html`) — meme amorce,
 * meme politique —, ou tournent les pages ```html-interactif qui ne font pas de 3D.
 *
 * Elle existe parce qu'un cadre local herite de la politique de l'app, qui interdit tout script
 * (mesure le 2026-10-16) : une scene three.js du fil (Bloc3D.tsx) a besoin d'une page qui porte SA
 * politique. Comparaison stricte sur l'origine et le chemin : une autre page de l'app, ou la meme
 * page servie ailleurs, reste refusee.
 */
const PAGES_DE_CADRE = [NOM_PAGE_SCENE_3D, NOM_PAGE_INTERACTIVE] as const

export function isSceneFrameUrl(
  url: string,
  options: { devRendererUrl?: string; rendererHtmlPath?: string }
): boolean {
  try {
    const cible = new URL(url)
    return PAGES_DE_CADRE.some((nom) => {
      if (options.devRendererUrl) {
        const attendu = new URL(nom, options.devRendererUrl)
        return cible.origin === attendu.origin && cible.pathname === attendu.pathname
      }
      if (!options.rendererHtmlPath || cible.protocol !== 'file:') return false
      const attendu = pathToFileURL(join(dirname(resolve(options.rendererHtmlPath)), nom))
      return (
        cible.host.toLowerCase() === attendu.host.toLowerCase() &&
        decodeURIComponent(cible.pathname).toLowerCase() ===
          decodeURIComponent(attendu.pathname).toLowerCase()
      )
    })
  } catch {
    return false
  }
}
