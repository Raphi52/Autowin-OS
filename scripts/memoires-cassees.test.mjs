import { describe, expect, it } from 'vitest'
import { causeDeLaCassure } from './memoires-cassees.mjs'

const init = (extra = {}) => ({ tools: ['Read', 'Bash'], mcp_servers: [], model: 'opus', ...extra })
const prompt = (ref, blocs) => ({ systemRef: ref, systemBlocks: blocs })

describe('cause d’une mémoire de relecture cassée — le premier élément qui diffère', () => {
  it('un outil ajouté ou retiré passe avant tout le reste', () => {
    const r = causeDeLaCassure(
      { init: init({ tools: ['Read', 'Bash', 'Workflow'] }), prompt: prompt('a', []) },
      { init: init(), prompt: prompt('b', []) }
    )
    expect(r).toEqual({ cause: 'liste d’outils', detail: '-Workflow' })
  })

  it('nomme le bloc de consignes qui a changé', () => {
    const blocs = [{ name: 'constitution', chars: 10 }]
    const r = causeDeLaCassure(
      { init: init(), prompt: prompt('a', blocs) },
      { init: init(), prompt: prompt('b', [...blocs, { name: 'visuel', chars: 2856 }]) }
    )
    expect(r.cause).toBe('consignes : bloc visuel')
    expect(r.detail).toBe('visuel 0→2856 car.')
  })

  it('un dossier ajouté ne compte qu’à consignes identiques', () => {
    const r = causeDeLaCassure(
      { init: init({ additional_directories: ['C:/t/a'] }), prompt: prompt('a', []) },
      { init: init({ additional_directories: ['C:/t/b'] }), prompt: prompt('a', []) }
    )
    expect(r.cause).toBe('dossiers ajoutés (--add-dir)')
  })

  it('sans trace des consignes, la cause reste inconnue au lieu d’être devinée', () => {
    expect(causeDeLaCassure({ init: init() }, { init: init() }).cause).toBe(
      'inconnue (consignes non tracées)'
    )
  })
})
