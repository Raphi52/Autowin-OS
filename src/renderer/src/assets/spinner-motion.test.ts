import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Le spinner est le seul indicateur qui dit « ca travaille ». Fige par
 * prefers-reduced-motion (effets visuels Windows desactives), il ment :
 * l'utilisateur voit un rond immobile pendant un traitement en cours.
 * Il doit donc rester EXEMPT de la coupure d'animation systeme.
 */
const CSS_FILES = [
  join(__dirname, 'theme.css'),
  join(__dirname, '..', 'components', 'ChatView.css')
]

function reducedMotionBlocks(css: string): string[] {
  const blocks: string[] = []
  const re = /@media[^{]*prefers-reduced-motion[^{]*\{/g
  while (re.exec(css) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    blocks.push(css.slice(re.lastIndex, i - 1))
  }
  return blocks
}

describe('spinner et prefers-reduced-motion', () => {
  for (const file of CSS_FILES) {
    it(`${file.split(/[\\/]/).pop()} ne coupe pas l'animation du spinner`, () => {
      const css = readFileSync(file, 'utf8')
      const offenders = reducedMotionBlocks(css).filter((b) => /\.spinner|\.aw-atom/.test(b))
      expect(offenders).toEqual([])
    })
  }
})
