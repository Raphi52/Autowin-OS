/**
 * Filet du chargement de l'interface : redemande le document si la navigation a été PERDUE.
 *
 * CONSTATÉ le 2026-10-19 : `loadURL` demandé à 08:05:09, le service réseau de Chromium plante à
 * 08:05:15 (« Network service crashed, restarting service »). La navigation en cours meurt avec lui
 * sans erreur : la page reste sur l'URL vide, `did-finish-load` ne part jamais, et la fenêtre — cachée
 * jusqu'à `ready-to-show` — n'apparaît jamais. Il a fallu un `Page.navigate` à la main, 9 min plus tard.
 *
 * Seul critère : la page n'a RIEN engagé (URL vide, `about:blank`) ou est restée sur l'écran d'attente.
 * Une interface engagée mais lente (vite compile 70-80 s à froid) n'est jamais relancée : redemander
 * annulerait un chargement qui progresse.
 */

export type PageSurveillee = {
  getURL(): string
  isDestroyed?(): boolean
}

export type OptionsFilet = {
  page: PageSurveillee
  /** Redemande le document — le même `loadURL`/`loadFile` que la première fois. */
  redemander: () => void
  delaiMs: number
  essaisMax: number
  planifier?: (rappel: () => void, ms: number) => unknown
  annuler?: (minuteur: unknown) => void
}

/** Vrai quand la page n'a engagé aucun document de l'application. */
export function navigationPerdue(url: string): boolean {
  return url === '' || url === 'about:blank' || /autowin-boot\.html(?:[?#]|$)/.test(url)
}

/** Arme le filet ; la fonction rendue le désarme (à appeler sur `did-finish-load`). */
export function surveillerNavigation(options: OptionsFilet): () => void {
  const planifier = options.planifier ?? ((rappel, ms) => setTimeout(rappel, ms))
  const annuler = options.annuler ?? ((minuteur) => clearTimeout(minuteur as NodeJS.Timeout))
  let essais = 0
  let arrete = false
  let minuteur: unknown

  const verifier = (): void => {
    if (arrete || options.page.isDestroyed?.()) return
    if (!navigationPerdue(options.page.getURL())) return
    if (essais >= options.essaisMax) return
    essais++
    console.warn(
      `[demarrage] navigation perdue (URL « ${options.page.getURL()} ») — interface redemandée (essai ${essais}/${options.essaisMax})`
    )
    options.redemander()
    minuteur = planifier(verifier, options.delaiMs)
  }

  minuteur = planifier(verifier, options.delaiMs)
  return () => {
    arrete = true
    annuler(minuteur)
  }
}
