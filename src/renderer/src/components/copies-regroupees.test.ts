import { describe, expect, it } from 'vitest'
import { estFini, texteDe } from './carnet-du-fil'
import { heure } from './lots-mesures'
import { lisse } from '../quartier/quartier-vie'
import { formaterDate } from '../langue'
import type { AsstMsg } from './chat-view-types'

/*
 * Des fonctions de l'interface copiées à l'identique dans deux fichiers n'en font plus qu'une
 * (`scripts/fonctions-en-double.mjs`). Chaque test fixe la réponse que les deux copies donnaient.
 */
const message = (champs: Partial<AsstMsg>): AsstMsg => ({ role: 'assistant', ...champs }) as AsstMsg

describe('messages du fil', () => {
  it('texteDe : seuls les morceaux de texte, un par ligne', () => {
    const m = message({
      parts: [
        { kind: 'text', text: 'un' },
        { kind: 'action', name: 'verify' },
        { kind: 'text', text: 'deux' }
      ] as AsstMsg['parts']
    })
    expect(texteDe(m)).toBe('un\ndeux')
    expect(texteDe(message({}))).toBe('')
  })

  it('estFini : ni en cours d’écriture, ni marqué inachevé', () => {
    expect(estFini(message({ status: 'completed' } as Partial<AsstMsg>))).toBe(true)
    expect(estFini(message({ status: 'streaming' } as Partial<AsstMsg>))).toBe(false)
    expect(estFini(message({ status: 'completed', done: false } as Partial<AsstMsg>))).toBe(false)
  })
})

describe('petites aides', () => {
  it('heure : heures et minutes dans la langue de l’interface', () => {
    const ms = Date.UTC(2026, 10, 8, 9, 5)
    expect(heure(ms)).toBe(formaterDate(ms, { hour: '2-digit', minute: '2-digit' }))
  })

  it('lisse : 0 et 1 aux bords, symétrique autour du milieu', () => {
    expect(lisse(0)).toBe(0)
    expect(lisse(1)).toBe(1)
    expect(lisse(0.5)).toBe(0.5)
    expect(lisse(0.25) + lisse(0.75)).toBeCloseTo(1)
  })
})
