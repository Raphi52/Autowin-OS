import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * L'ANNEAU TOURNE — et son arc d'ETAT ne s'allume QUE micro ouvert.
 *
 * Une capture fixe ne peut prouver ni l'un ni l'autre. Ce test verrouille les deux liens CSS :
 * les couronnes de decor portent une rotation inconditionnelle (le poste est sous tension), tandis
 * que `.jarvis__anneau-etat` ne recoit son animation que sous `[data-ecoute='true']`.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : deplacer l'animation de l'arc d'etat sur la regle neutre
 * `.jarvis__anneau-etat` (un micro coupe se lirait « a l'ecoute »), ou retirer les rotations du
 * decor (l'anneau serait fige et `ui-capture --motion` ne pourrait plus rien prouver).
 */
describe('HomeView.css — l’anneau Jarvis tourne, son arc d’état ne s’allume qu’à l’écoute', () => {
  const css = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

  it('déclare les rotations de l’anneau', () => {
    expect(css).toMatch(/@keyframes\s+jarvis-anneau-horaire\s*\{/)
    expect(css).toMatch(/@keyframes\s+jarvis-anneau-antihoraire\s*\{/)
  })

  it('fait tourner les couronnes de décor en permanence', () => {
    for (const classe of ['graduations', 'arcs', 'ambre']) {
      const regle = css.match(new RegExp('\\.jarvis__anneau-' + classe + '\\s*\\{([^}]*)\\}'))
      expect(regle, `la règle .jarvis__anneau-${classe} doit exister`).not.toBeNull()
      expect(regle?.[1]).toMatch(/animation\s*:\s*jarvis-anneau-(anti)?horaire/)
    }
  })

  it('n’anime l’arc d’état QUE sous l’état d’écoute', () => {
    const regleActive = css.match(
      /\.jarvis\[data-ecoute='true'\]\s+\.jarvis__anneau-etat\s*\{([^}]*)\}/
    )
    expect(regleActive, 'la règle liée à l’état d’écoute doit exister').not.toBeNull()
    expect(regleActive?.[1]).toMatch(/animation\s*:/)

    const regleNeutre = css.match(/(?<!\])\s\.jarvis__anneau-etat\s*\{([^}]*)\}/)
    expect(regleNeutre?.[1] ?? '').not.toMatch(/animation/)
  })
})
