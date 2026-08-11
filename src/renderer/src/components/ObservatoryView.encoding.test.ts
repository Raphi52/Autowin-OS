import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Mojibake = texte UTF-8 relu en Latin-1 puis ré-encodé. La séquence `â€` en est la signature :
 * elle ne peut pas apparaître dans du français correct, mais elle s'affiche telle quelle à
 * l'utilisateur (« Comparaison shadow en coursâ€¦ », mesuré le 2026-08-11).
 */
describe('Observatory source encoding', () => {
  it('ne contient aucune séquence de mojibake dans la vue Observatory', () => {
    const files = [
      './ObservatoryView.tsx',
      './ObservatoryView.css',
      './ObservatoryRagCausalStep.tsx',
      './useObservatorySources.ts'
    ]
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, `${file} contient du mojibake`).not.toMatch(/â€|Ã©|Ã¨|Ã /)
    }
  })
})
