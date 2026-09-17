/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
/**
 * L'AGENCEMENT DES ONGLETS — l'état que le processus principal tenait sur un seul scalaire.
 *
 * Avant : une seule vue courante (`this.tab` dans src/main/commands.ts), diffusée à TOUTES les
 * fenêtres. Deux fenêtres ouvertes s'écrasaient donc mutuellement à chaque navigation. C'est la
 * cause racine qui empêche des onglets détachables : on remplace la vue unique par une liste de
 * fenêtres, chacune avec SES onglets et SON onglet actif.
 *
 * Ce module est PUR (aucun Electron, aucun DOM) pour être testable des deux côtés.
 */
import { normalizeDestination, type AppDestination } from './navigation'

export const FENETRE_PRINCIPALE = 'main'

export interface TabWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TabWindowLayout {
  id: string
  tabs: AppDestination[]
  /** Onglet au premier plan de CETTE fenêtre. `null` seulement si la fenêtre est vide. */
  active: AppDestination | null
  /** Position à l'écran — connue du seul processus principal, absente côté page. */
  bounds?: TabWindowBounds
}

export interface TabLayout {
  windows: TabWindowLayout[]
}

export function layoutParDefaut(tab: AppDestination = 'accueil'): TabLayout {
  return { windows: [{ id: FENETRE_PRINCIPALE, tabs: [tab], active: tab }] }
}

function clone(layout: TabLayout): TabLayout {
  return { windows: layout.windows.map((w) => ({ ...w, tabs: [...w.tabs] })) }
}

export function fenetreDeLOnglet(layout: TabLayout, tab: AppDestination): string | null {
  return layout.windows.find((w) => w.tabs.includes(tab))?.id ?? null
}

/** Retire les fenêtres détachées vides. La principale reste TOUJOURS, même sans onglet. */
export function nettoyerFenetresVides(layout: TabLayout): TabLayout {
  return {
    windows: layout.windows.filter((w) => w.id === FENETRE_PRINCIPALE || w.tabs.length > 0)
  }
}

function retirerPartout(layout: TabLayout, tab: AppDestination): TabLayout {
  for (const w of layout.windows) {
    const i = w.tabs.indexOf(tab)
    if (i === -1) continue
    w.tabs.splice(i, 1)
    if (w.active === tab) w.active = w.tabs[Math.min(i, w.tabs.length - 1)] ?? null
  }
  return layout
}

/**
 * Ouvre (ou révèle) un onglet dans une fenêtre. Une destination n'existe qu'UNE fois dans tout
 * l'agencement : les vues sont des singletons (un seul fil de chat, un seul Observatory), deux
 * copies partageraient le même état et se contrediraient à l'écran.
 */
export function ouvrirOnglet(
  layout: TabLayout,
  tab: AppDestination,
  windowId: string = FENETRE_PRINCIPALE,
  index?: number
): TabLayout {
  const next = retirerPartout(clone(layout), tab)
  let cible = next.windows.find((w) => w.id === windowId)
  if (!cible) {
    cible = { id: windowId, tabs: [], active: null }
    next.windows.push(cible)
  }
  const position =
    index === undefined ? cible.tabs.length : Math.max(0, Math.min(index, cible.tabs.length))
  cible.tabs.splice(position, 0, tab)
  cible.active = tab
  return nettoyerFenetresVides(next)
}

export function fermerOnglet(layout: TabLayout, tab: AppDestination): TabLayout {
  return nettoyerFenetresVides(retirerPartout(clone(layout), tab))
}

/** Met un onglet au premier plan SANS toucher aux autres fenêtres (c'était le défaut). */
export function activerOnglet(layout: TabLayout, tab: AppDestination): TabLayout {
  const next = clone(layout)
  const cible = next.windows.find((w) => w.tabs.includes(tab))
  if (cible) cible.active = tab
  return next
}

/** Déplace un onglet vers une fenêtre existante (glissé entre fenêtres, ou réordonnancement). */
export function deplacerOnglet(
  layout: TabLayout,
  tab: AppDestination,
  windowId: string,
  index?: number
): TabLayout {
  return ouvrirOnglet(layout, tab, windowId, index)
}

/** Sort un onglet dans une NOUVELLE fenêtre (glissé hors de l'application, 2e écran). */
export function detacherOnglet(
  layout: TabLayout,
  tab: AppDestination,
  windowId: string,
  bounds?: TabWindowBounds
): TabLayout {
  if (layout.windows.some((w) => w.id === windowId)) {
    throw new Error(`Fenêtre déjà présente dans l'agencement : ${windowId}`)
  }
  const next = ouvrirOnglet(layout, tab, windowId)
  const creee = next.windows.find((w) => w.id === windowId)
  if (creee && bounds) creee.bounds = bounds
  return next
}

/** Rattache tous les onglets d'une fenêtre à la principale (fermeture d'une fenêtre détachée). */
export function rattacherFenetre(layout: TabLayout, windowId: string): TabLayout {
  if (windowId === FENETRE_PRINCIPALE) return clone(layout)
  const source = layout.windows.find((w) => w.id === windowId)
  if (!source) return clone(layout)
  let next = clone(layout)
  for (const tab of source.tabs) next = ouvrirOnglet(next, tab, FENETRE_PRINCIPALE)
  return nettoyerFenetresVides({
    windows: next.windows.filter((w) => w.id !== windowId)
  })
}

export function ongletActif(
  layout: TabLayout,
  windowId = FENETRE_PRINCIPALE
): AppDestination | null {
  return layout.windows.find((w) => w.id === windowId)?.active ?? null
}

/**
 * Relit un agencement mémorisé. Une mémoire ABÎMÉE ne casse pas le démarrage : on rend `null`,
 * l'appelant retombe sur l'agencement par défaut plutôt que d'ouvrir une fenêtre vide.
 */
export function lireAgencement(brut: unknown): TabLayout | null {
  const source = typeof brut === 'string' ? safeParse(brut) : brut
  if (!source || typeof source !== 'object') return null
  const windows = (source as { windows?: unknown }).windows
  if (!Array.isArray(windows)) return null
  const propres: TabWindowLayout[] = []
  const vus = new Set<AppDestination>()
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue
    const id = typeof (w as { id?: unknown }).id === 'string' ? (w as { id: string }).id : null
    const tabsBruts = (w as { tabs?: unknown }).tabs
    if (!id || !Array.isArray(tabsBruts)) continue
    const tabs: AppDestination[] = []
    for (const t of tabsBruts) {
      if (typeof t !== 'string') continue
      const destination = normalizeDestination(t)
      if (vus.has(destination)) continue
      vus.add(destination)
      tabs.push(destination)
    }
    if (tabs.length === 0 && id !== FENETRE_PRINCIPALE) continue
    const actifBrut = (w as { active?: unknown }).active
    const actif =
      typeof actifBrut === 'string' && tabs.includes(normalizeDestination(actifBrut))
        ? normalizeDestination(actifBrut)
        : (tabs[0] ?? null)
    const bounds = lireBounds((w as { bounds?: unknown }).bounds)
    propres.push({ id, tabs, active: actif, ...(bounds ? { bounds } : {}) })
  }
  if (propres.length === 0) return null
  if (!propres.some((w) => w.id === FENETRE_PRINCIPALE)) {
    propres.unshift({ id: FENETRE_PRINCIPALE, tabs: [], active: null })
  }
  return { windows: propres }
}

function lireBounds(brut: unknown): TabWindowBounds | null {
  if (!brut || typeof brut !== 'object') return null
  const b = brut as Record<string, unknown>
  const nombres = ['x', 'y', 'width', 'height'].map((k) => b[k])
  if (!nombres.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [x, y, width, height] = nombres as number[]
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function safeParse(texte: string): unknown {
  try {
    return JSON.parse(texte)
  } catch {
    return null
  }
}
