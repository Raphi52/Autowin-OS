import { describe, expect, it, vi } from 'vitest'
import {
  CLASSE_TRANSITION_DE_THEME,
  CLASSE_TRANSITION_DE_VUE,
  basculerTheme,
  basculerVue,
  rayonDuCercle
} from './transition-de-vue'

/**
 * LE PASSAGE ANIME D'UNE VUE A L'AUTRE (conv-981, 2026-10-15) : fondu court de la page, et le
 * surlignage du menu qui GLISSE vers l'onglet choisi (`document.startViewTransition`).
 *
 * Bornes du cadrage : l'API absente (happy-dom, tests) = bascule directe ; l'onglet deja actif = aucune
 * transition ; des clics rapides = l'etat final est celui du dernier clic. Le nom de transition n'est
 * pose que PENDANT la transition (classe sur <html>) : `view-transition-name` fait en permanence de
 * l'element un contexte d'empilement et une racine de flou d'arriere-plan (spec css-view-transitions-1,
 * « Rendering Consolidation ») — le verre des themes ne flouterait plus le fond.
 */
type Fin = { resoudre: () => void }
function fauxDocument(): {
  doc: Parameters<typeof basculerVue>[0]
  classes: Set<string>
  fins: Fin[]
  rappels: Array<() => void>
} {
  const classes = new Set<string>()
  const fins: Fin[] = []
  const rappels: Array<() => void> = []
  const doc = {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c)
      }
    },
    startViewTransition: (rappel: () => void) => {
      rappels.push(rappel)
      let resoudre!: () => void
      const finished = new Promise<void>((ok) => (resoudre = ok))
      fins.push({ resoudre })
      return { finished }
    }
  }
  return { doc, classes, fins, rappels }
}

describe('basculerVue', () => {
  it('passe par startViewTransition et pose la classe pendant la transition seulement', async () => {
    const { doc, classes, fins, rappels } = fauxDocument()
    const appliquer = vi.fn()
    basculerVue(doc, false, appliquer)
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(true)
    expect(appliquer).not.toHaveBeenCalled()
    rappels[0]()
    expect(appliquer).toHaveBeenCalledOnce()
    fins[0].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(false)
  })

  it('sans l API (happy-dom), bascule directement (jumeau)', () => {
    const appliquer = vi.fn()
    const classes = new Set<string>()
    basculerVue(
      {
        documentElement: { classList: { add: (c: string) => classes.add(c), remove: () => true } }
      },
      false,
      appliquer
    )
    expect(appliquer).toHaveBeenCalledOnce()
    expect(classes.size).toBe(0)
  })

  it('l onglet deja actif : aucune transition', () => {
    const { doc, classes, rappels } = fauxDocument()
    const appliquer = vi.fn()
    basculerVue(doc, true, appliquer)
    expect(appliquer).toHaveBeenCalledOnce()
    expect(rappels).toHaveLength(0)
    expect(classes.size).toBe(0)
  })

  it('clics rapides : la classe tient jusqu a la fin de la DERNIERE transition', async () => {
    const { doc, classes, fins, rappels } = fauxDocument()
    const ordre: string[] = []
    basculerVue(doc, false, () => ordre.push('A'))
    basculerVue(doc, false, () => ordre.push('B'))
    rappels.forEach((r) => r())
    expect(ordre).toEqual(['A', 'B'])
    fins[0].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(true)
    fins[1].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(false)
  })

  it('une transition qui echoue ne laisse pas la classe posee', async () => {
    const classes = new Set<string>()
    const appliquer = vi.fn()
    basculerVue(
      {
        documentElement: {
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c)
          }
        },
        startViewTransition: (rappel: () => void) => {
          rappel()
          return { finished: Promise.reject(new Error('skipped')) }
        }
      },
      false,
      appliquer
    )
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(appliquer).toHaveBeenCalledOnce()
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(false)
  })
})

/**
 * LE CHANGEMENT DE THEME EN CERCLE (conv-981, 2026-10-16). Bornes du cadrage : le meme theme et
 * l'API absente = application directe ; deux choix rapides = le dernier gagne, la classe tient
 * jusqu'a la fin de la DERNIERE transition ; la classe du theme ne pose JAMAIS celle des vues (le
 * cercle jouerait sur chaque changement d'onglet), et inversement.
 */
describe('basculerTheme', () => {
  const fenetre = { largeur: 800, hauteur: 600 }
  function avecStyle(): ReturnType<typeof fauxDocument> & { variables: Map<string, string> } {
    const base = fauxDocument()
    const variables = new Map<string, string>()
    const doc = {
      ...base.doc,
      documentElement: {
        ...base.doc.documentElement,
        style: { setProperty: (nom: string, valeur: string) => variables.set(nom, valeur) }
      }
    }
    return { ...base, doc, variables }
  }

  it('pose la classe du THEME (jamais celle des vues) et l origine du cercle, le temps de la transition', async () => {
    const { doc, classes, fins, rappels, variables } = avecStyle()
    const appliquer = vi.fn()
    basculerTheme(doc, false, { x: 700, y: 100 }, fenetre, appliquer)
    expect(classes.has(CLASSE_TRANSITION_DE_THEME)).toBe(true)
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(false)
    expect(variables.get('--theme-cercle-x')).toBe('700px')
    expect(variables.get('--theme-cercle-y')).toBe('100px')
    // Coin le plus eloigne de (700, 100) dans 800 x 600 : (0, 600) -> hypot(700, 500) = 860,2.
    expect(variables.get('--theme-cercle-r')).toBe('861px')
    expect(appliquer).not.toHaveBeenCalled()
    rappels[0]()
    expect(appliquer).toHaveBeenCalledOnce()
    fins[0].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_THEME)).toBe(false)
  })

  it('le meme theme : applique directement, sans cercle (jumeau)', () => {
    const { doc, classes, rappels } = avecStyle()
    const appliquer = vi.fn()
    basculerTheme(doc, true, { x: 10, y: 10 }, fenetre, appliquer)
    expect(appliquer).toHaveBeenCalledOnce()
    expect(rappels).toHaveLength(0)
    expect(classes.size).toBe(0)
  })

  it('sans l API (happy-dom) : applique directement, aucune classe ni variable', () => {
    const appliquer = vi.fn()
    const classes = new Set<string>()
    const variables = new Map<string, string>()
    basculerTheme(
      {
        documentElement: {
          classList: { add: (c: string) => classes.add(c), remove: () => true },
          style: { setProperty: (n: string, v: string) => variables.set(n, v) }
        }
      },
      false,
      { x: 10, y: 10 },
      fenetre,
      appliquer
    )
    expect(appliquer).toHaveBeenCalledOnce()
    expect(classes.size).toBe(0)
    expect(variables.size).toBe(0)
  })

  it('deux choix rapides : le dernier gagne, la classe tient jusqu a la fin du DERNIER cercle', async () => {
    const { doc, classes, fins, rappels } = avecStyle()
    const ordre: string[] = []
    basculerTheme(doc, false, { x: 1, y: 1 }, fenetre, () => ordre.push('clair'))
    basculerTheme(doc, false, { x: 1, y: 1 }, fenetre, () => ordre.push('sombre'))
    rappels.forEach((r) => r())
    expect(ordre).toEqual(['clair', 'sombre'])
    fins[0].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_THEME)).toBe(true)
    fins[1].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_THEME)).toBe(false)
  })

  it('un passage de vue en cours ne retient pas la classe du theme, et inversement', async () => {
    const { doc, classes, fins } = avecStyle()
    basculerVue(doc, false, () => undefined)
    basculerTheme(doc, false, { x: 1, y: 1 }, fenetre, () => undefined)
    fins[1].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has(CLASSE_TRANSITION_DE_THEME)).toBe(false)
    expect(classes.has(CLASSE_TRANSITION_DE_VUE)).toBe(true)
    fins[0].resoudre()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.size).toBe(0)
  })
})

describe('rayonDuCercle', () => {
  it('couvre le coin le plus eloigne, depuis le centre comme depuis un coin', () => {
    expect(rayonDuCercle({ x: 400, y: 300 }, 800, 600)).toBe(500)
    expect(rayonDuCercle({ x: 0, y: 0 }, 800, 600)).toBe(1000)
    expect(rayonDuCercle({ x: 800, y: 600 }, 800, 600)).toBe(1000)
  })

  it('une origine hors de la fenetre couvre quand meme toute la fenetre', () => {
    expect(rayonDuCercle({ x: -200, y: 300 }, 800, 600)).toBe(Math.ceil(Math.hypot(1000, 300)))
  })
})
