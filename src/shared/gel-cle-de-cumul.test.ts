import { describe, expect, it } from 'vitest'
import { cleDeCumul } from './gel-detector'

/**
 * Mesure du 2026-09-03 : 348 s de fenetre morte imputees a « execFileSync », sans jamais dire
 * QUELLE commande. La cle doit nommer le programme et sa sous-commande, et rien de plus.
 */
describe('cleDeCumul', () => {
  it('nomme le programme et sa sous-commande, sans chemins ni SHA', () => {
    expect(cleDeCumul('execFileSync', ['git', ['diff', '--no-color', 'a...b', '--', 'x.ts']])).toBe(
      'execFileSync git diff'
    )
    expect(cleDeCumul('execFileSync', ['git', ['-C', '/repo', 'cherry', 'HEAD']])).toBe(
      'execFileSync git cherry'
    )
  })

  it('condense un chemin de programme en son seul nom', () => {
    expect(cleDeCumul('spawnSync', [String.raw`C:\\Program Files\\Git\\git.exe`, ['status']])).toBe(
      'spawnSync git.exe status'
    )
  })

  it('laisse les appels fichier inchanges — leur nom d API suffit a les agreger', () => {
    expect(cleDeCumul('readFileSync', ['/tmp/a.json', 'utf8'])).toBe('readFileSync')
    expect(cleDeCumul('openSync', ['/tmp/a.json'])).toBe('openSync')
  })

  it('sans sous-commande lisible, garde au moins le programme', () => {
    expect(cleDeCumul('execFileSync', ['ps', ['-p', '12']])).toBe('execFileSync ps')
    expect(cleDeCumul('execFileSync', [undefined])).toBe('execFileSync')
  })
})
