import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * BARRE DE FILTRE DE LOGS (conv-180, 2026-10-10 : « dans Logs les elements au sommet sont pas bien
 * responsive »). Le panneau de droite descend a 280 px (barre de 248 px) ; sur une seule ligne, la
 * barre demandait 399 px : la recherche tombait a 22 px, « Toutes sources » etait coupe, Pistes,
 * Exporter et le compte sortaient du cadre. Elle passe donc a la ligne, et rien n'y est plafonne
 * en pourcentage. La preuve de mise en page est une mesure dans l'app (jsdom ne calcule pas de
 * boites) ; ce test garde les trois declarations qui la produisent.
 */
const declarations = (selecteur: string): Record<string, string> => {
  const css = readFileSync(new URL('./ModelActivityLogPane.css', import.meta.url), 'utf8')
  const valeurs: Record<string, string> = {}
  postcss.parse(css).walkRules((regle) => {
    if (regle.parent?.type !== 'root') return
    if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
    regle.walkDecls((d) => {
      valeurs[d.prop] = d.value
    })
  })
  return valeurs
}

describe('barre de filtre de Logs : elle passe a la ligne au lieu d ecraser', () => {
  it('passe a la ligne quand la place manque', () => {
    expect(declarations('.model-log-filter')['flex-wrap']).toBe('wrap')
  })

  it('donne a la recherche une base de 180 px, pour qu elle prenne une ligne plutot que de s ecraser', () => {
    expect(declarations('.model-log-filter input').flex).toBe('1 1 180px')
  })

  it('ne coupe plus les selecteurs a 30 % de la barre', () => {
    const select = declarations('.model-log-filter select')
    expect(select['max-width']).toBe('100%')
    expect(select.flex).toBe('none')
  })

  /**
   * UNE hauteur (conv-180, 2026-10-10 : « aligne la hauteur du champ de recherche, des deux listes
   * et des boutons »). Sans elle, chacun tirait la sienne de son remplissage : 36, 22 et 18 px.
   */
  it('donne a la recherche, aux listes et aux boutons la meme hauteur de 26 px', () => {
    const commun = declarations('.model-log-filter :is(input, select, .model-log-toggle)')
    expect(commun.height).toBe('26px')
    expect(commun['box-sizing']).toBe('border-box')
    expect(commun['padding-top']).toBe('0')
    expect(commun['padding-bottom']).toBe('0')
  })
})
