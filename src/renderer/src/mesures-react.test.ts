import { afterEach, describe, expect, it } from 'vitest'
import { installerMesuresReactSansRetenue } from './mesures-react'

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : une mesure de React qui reste dans le tampon du navigateur. Il n'a
 * aucune limite : 139 941 entrées pesaient 1,5 Go de mémoire privée sur l'app ouverte (conv-1413).
 */
const NOM = '​TacheDeLaFrise'
const OPTIONS_DE_REACT = {
  start: 0,
  end: 1,
  detail: { devtools: { color: 'primary', properties: [['Changed Props', '']] } }
}
const mesures = (nom: string): number => performance.getEntriesByName(nom, 'measure').length

let retirer: (() => void) | undefined

afterEach(() => {
  retirer?.()
  retirer = undefined
  performance.clearMeasures()
})

describe('installerMesuresReactSansRetenue', () => {
  it('témoin : sans elle, chaque mesure de React reste dans le tampon', () => {
    for (let i = 0; i < 50; i += 1) performance.measure(NOM, OPTIONS_DE_REACT)
    expect(mesures(NOM)).toBe(50)
  })

  it('aucune mesure de React ne reste, et la mesure est bien écrite pour les pistes DevTools', () => {
    retirer = installerMesuresReactSansRetenue()
    for (let i = 0; i < 50; i += 1) {
      expect(performance.measure(NOM, OPTIONS_DE_REACT).name).toBe(NOM)
    }
    expect(mesures(NOM)).toBe(0)
  })

  it('garde les mesures de l’app, avec ou sans détail', () => {
    retirer = installerMesuresReactSansRetenue()
    performance.measure('decor:apparition', { start: 0, end: 1 })
    performance.measure('decor:detail', { start: 0, end: 1, detail: { etape: 2 } })
    expect(mesures('decor:apparition')).toBe(1)
    expect(mesures('decor:detail')).toBe(1)
  })

  it('accepte la forme à marques (`measure(nom, début, fin)`) sans la confondre', () => {
    retirer = installerMesuresReactSansRetenue()
    performance.mark('a')
    performance.mark('b')
    performance.measure('a-vers-b', 'a', 'b')
    expect(mesures('a-vers-b')).toBe(1)
    performance.clearMarks()
  })
})
