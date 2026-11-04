import { describe, expect, it } from 'vitest'
import { catalogueGrok, lireModelesGrok } from './grok-modeles'

// Sortie réelle de `grok models`, Grok Build 1.0.70, 2026-11-04 (conv-1499).
const SORTIE = `You are logged in with grok.com.

Default model: grok-4.7

Available models:
  * grok-4.7 (default)
`

describe('catalogue grok', () => {
  it('lit les modèles annoncés par grok models', () => {
    expect(lireModelesGrok(SORTIE).map((m) => [m.id, m.label])).toEqual([
      ['grok/grok-4.7', 'Grok 4.7']
    ])
  })
  it('programme absent → aucun modèle', async () => {
    expect(await catalogueGrok(() => undefined)).toEqual([])
  })
  it('listage en panne → entrée défaut seule', async () => {
    const r = await catalogueGrok(() => 'grok.exe', async () => { throw new Error('x') })
    expect(r.map((m) => m.model)).toEqual(['default'])
  })
  it('défaut puis modèles réels', async () => {
    const r = await catalogueGrok(() => 'grok.exe', async () => SORTIE)
    expect(r.map((m) => m.model)).toEqual(['default', 'grok-4.7'])
  })
})
