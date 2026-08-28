import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lireLatenceTours } from './perf-lag-main'

const ligne = (snapshot: number): string =>
  JSON.stringify({ ts: new Date().toISOString(), totalMs: snapshot + 10, marks: { snapshot } })

describe('lireLatenceTours', () => {
  it('lit les N DERNIERS tours, pas les premiers (une lenteur ancienne n’est pas l’etat courant)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perflag-'))
    // Entree qui casserait un `slice(0, n)` : les 100 premiers tours sont rapides, les 3 derniers
    // sont lents. Une lecture par la tete rendrait « aucun suspect » sur un produit qui lag.
    const lignes = [...Array(100).keys()]
      .map(() => ligne(10))
      .concat([ligne(9000), ligne(9000), ligne(9000)])
    writeFileSync(join(dir, 'turn-timing.jsonl'), lignes.join('\n') + '\n', 'utf8')
    const r = lireLatenceTours(dir, 3)
    expect(r.tours).toBe(3)
    expect(r.suspects.map((s) => s.nom)).toContain('snapshot')
  })

  it('fichier absent : rapport vide et source dite, jamais une erreur jetee', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perflag-vide-'))
    const r = lireLatenceTours(dir, 10)
    expect(r.tours).toBe(0)
    expect(r.disponible).toBe(false)
  })
})
