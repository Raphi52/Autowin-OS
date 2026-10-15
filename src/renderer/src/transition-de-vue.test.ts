import { describe, expect, it, vi } from 'vitest'
import { CLASSE_TRANSITION_DE_VUE, basculerVue } from './transition-de-vue'

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
