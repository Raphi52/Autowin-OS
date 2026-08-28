import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Verrou de CHEMIN (le constructeur d'`AutowinOS` est trop lourd pour être instancié en test) :
 * `runsWithGate()` est sur le chemin chaud du snapshot de tour, il doit passer par la variante
 * BORNÉE. L'entrée qui doit faire rougir ce test : un retour à `this.listRuns()` dans ce corps.
 */
describe('runsWithGate ne paie pas le scan complet des runs', () => {
  const source = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')
  const corps = /async runsWithGate\(\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(source)?.[1] ?? ''

  it('appelle la variante bornée', () => {
    expect(corps).toContain('scanRunsPourSnapshot()')
  })

  it('n’appelle PAS la variante sans borne', () => {
    expect(corps).not.toContain('this.listRuns()')
  })
})
