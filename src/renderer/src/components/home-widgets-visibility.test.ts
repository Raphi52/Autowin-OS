import { describe, expect, it } from 'vitest'
import { HOME_WIDGET_IDS } from './home-layout'
import {
  CLE_VISIBILITE_WIDGETS,
  basculerWidget,
  ecrireVisibilite,
  estVisible,
  lireVisibilite,
  parseVisibilite,
  visibiliteParDefaut
} from './home-widgets-visibility'

function memoire(initial: Record<string, string> = {}): {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
} {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (cle) => data.get(cle) ?? null,
    setItem: (cle, valeur) => {
      data.set(cle, valeur)
    }
  }
}

describe('visibilite des widgets d accueil', () => {
  it('allume tout par defaut', () => {
    const defaut = visibiliteParDefaut()
    for (const id of HOME_WIDGET_IDS) expect(defaut[id]).toBe(true)
  })

  it('bascule un seul widget, sans toucher aux autres', () => {
    const apres = basculerWidget(visibiliteParDefaut(), 'jarvis')
    expect(apres.jarvis).toBe(false)
    expect(apres.mails).toBe(true)
    expect(basculerWidget(apres, 'jarvis').jarvis).toBe(true)
  })

  it('laisse allume un widget absent du reglage enregistre', () => {
    const lu = parseVisibilite({ jarvis: false })
    expect(lu.jarvis).toBe(false)
    expect(lu.mails).toBe(true)
    expect(estVisible(lu, 'agenda')).toBe(true)
  })

  it('ignore un reglage mal forme', () => {
    for (const brut of [null, 'nope', 42, ['jarvis']]) {
      expect(parseVisibilite(brut)).toEqual(visibiliteParDefaut())
    }
  })

  it('relit ce qui a ete enregistre', () => {
    const storage = memoire()
    ecrireVisibilite(storage, basculerWidget(visibiliteParDefaut(), 'agenda'))
    expect(storage.getItem(CLE_VISIBILITE_WIDGETS)).toContain('"agenda":false')
    expect(lireVisibilite(storage).agenda).toBe(false)
    expect(lireVisibilite(storage).jarvis).toBe(true)
  })

  it('ouvre l accueil entier quand le reglage est illisible', () => {
    const storage = memoire({ [CLE_VISIBILITE_WIDGETS]: '{ pas du json' })
    expect(lireVisibilite(storage)).toEqual(visibiliteParDefaut())
  })
})
