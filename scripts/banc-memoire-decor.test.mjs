import { describe, expect, it } from 'vitest'
import { resumerReleves } from './banc-memoire-decor.mjs'

/**
 * Le résumé du banc mémoire du décor. Ce qui doit faire échouer ce fichier : un pic qui compterait
 * le relevé de départ, un « reste » calculé sur le pic au lieu du dernier relevé, ou un compte
 * de contextes rendus qui inclurait les relevés sans fermeture.
 */
describe('resumerReleves', () => {
  it('lit départ, pic après fermeture, fin et contextes rendus, en Mo', () => {
    const ko = (mo) => mo * 1024
    const resume = resumerReleves([
      { cycle: 0, prive: ko(900) },
      { cycle: 1, prive: ko(300), contextePerdu: true },
      { cycle: 2, prive: ko(500), contextePerdu: false },
      { cycle: 'fin', prive: ko(250) }
    ])
    expect(resume).toEqual({
      departMo: 900,
      picMo: 500,
      finMo: 250,
      monteeMo: -650,
      contextesPerdus: 1,
      cycles: 2
    })
  })
})
