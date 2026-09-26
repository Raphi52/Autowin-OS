import { describe, expect, it } from 'vitest'
import { annonceCommitLocal } from './annonce-commit-local'

describe('annonceCommitLocal', () => {
  it('annonce le commit local fusionné, son message, sa tête et « non poussé »', () => {
    const ligne = annonceCommitLocal(
      { outcome: 'merged', committed: true, publishedSha: 'abcdef1234567890' },
      'run-1',
      'Rends les commits lisibles\nsuite ignorée'
    )
    expect(ligne).toContain('« agent run-1: Rends les commits lisibles »')
    expect(ligne).toContain('`abcdef12`')
    expect(ligne).toContain('non poussé')
  })

  it("n'annonce rien quand aucun commit n'a été créé", () => {
    expect(annonceCommitLocal({ outcome: 'merged', committed: false }, 'run-1', 't')).toBeUndefined()
  })

  it("n'annonce rien quand le travail n'a pas été fusionné", () => {
    expect(annonceCommitLocal({ outcome: 'refused', committed: true }, 'run-1', 't')).toBeUndefined()
    expect(annonceCommitLocal(null, 'run-1', 't')).toBeUndefined()
  })

  it('garde le message générique sans tâche et omet la tête sans SHA', () => {
    const ligne = annonceCommitLocal({ outcome: 'merged', committed: true }, 'run-2', '  ')
    expect(ligne).toContain('« agent run-2 »')
    expect(ligne).not.toContain('tête de branche')
  })
})
