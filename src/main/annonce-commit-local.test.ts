import { describe, expect, it } from 'vitest'
import { annonceCommitLocal, pushDuCompteRendu } from './annonce-commit-local'

describe('pushDuCompteRendu', () => {
  it('« pushed » avec une branche → la branche et le mode ; tout le reste → rien poussé', () => {
    expect(
      pushDuCompteRendu({ status: 'pushed', branch: 'main', files: 4, mode: 'direct' })
    ).toEqual({
      branche: 'main',
      mode: 'direct'
    })
    expect(pushDuCompteRendu({ status: 'pushed', branch: 'auto/x', files: 1 })).toEqual({
      branche: 'auto/x'
    })
    for (const rendu of [
      undefined,
      null,
      'pushed',
      { status: 'committed', files: 2 },
      { status: 'skipped', reason: 'no-remote' },
      { status: 'pushed', branch: '  ' }
    ]) {
      expect(pushDuCompteRendu(rendu)).toBeUndefined()
    }
  })
})

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

  it('commit poussé par la clôture → « poussé sur origin/<branche> », plus jamais « non poussé »', () => {
    const issue = { outcome: 'merged', committed: true, publishedSha: 'e4daf1702e098832' }
    const direct = annonceCommitLocal(issue, 'run-1', 't', { branche: 'main', mode: 'direct' })
    expect(direct).toContain('Commit créé : « agent run-1: t »')
    expect(direct).toContain('puis poussé sur `origin/main` par la clôture automatique')
    expect(direct).not.toContain('non poussé')
    const repli = annonceCommitLocal(issue, 'run-1', 't', { branche: 'auto/run-1', mode: 'pr' })
    expect(repli).toContain('poussé sur la branche dédiée `origin/auto/run-1`')
  })

  it("n'annonce rien quand aucun commit n'a été créé", () => {
    expect(
      annonceCommitLocal({ outcome: 'merged', committed: false }, 'run-1', 't')
    ).toBeUndefined()
  })

  it("n'annonce rien quand le travail n'a pas été fusionné", () => {
    expect(
      annonceCommitLocal({ outcome: 'refused', committed: true }, 'run-1', 't')
    ).toBeUndefined()
    expect(annonceCommitLocal(null, 'run-1', 't')).toBeUndefined()
  })

  it('garde le message générique sans tâche et omet la tête sans SHA', () => {
    const ligne = annonceCommitLocal({ outcome: 'merged', committed: true }, 'run-2', '  ')
    expect(ligne).toContain('« agent run-2 »')
    expect(ligne).not.toContain('tête de branche')
  })
})
