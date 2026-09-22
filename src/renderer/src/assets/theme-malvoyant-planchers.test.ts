import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { genererPlanchers } from '../../../../scripts/gen-malvoyant-planchers.mjs'

describe('planchers de taille des themes malvoyants', () => {
  it('le fichier genere est a jour avec les feuilles de style', () => {
    const actuel = readFileSync('src/renderer/src/assets/theme-malvoyant-planchers.css', 'utf8')
    expect(actuel).toBe(genererPlanchers())
  })
  it('ne touche que les themes malvoyants', () => {
    const actuel: string = genererPlanchers()
    const selecteurs = actuel.split('\n').filter((l) => l.startsWith(':root') || l.startsWith('.'))
    expect(selecteurs.length).toBeGreaterThan(100)
    for (const s of selecteurs) expect(s.startsWith(":root[data-theme^='malvoyant-']")).toBe(true)
  })
})
