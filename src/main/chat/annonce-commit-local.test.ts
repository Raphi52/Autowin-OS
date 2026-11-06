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

  it('commit poussé → bandeau titré par son statut, avec le commit et la ligne git exacte (conv-1558, conv-1573)', () => {
    const issue = { outcome: 'merged', committed: true, publishedSha: 'e4daf1702e098832' }
    const direct = annonceCommitLocal(issue, 'run-1', 't <x>', { branche: 'main', mode: 'direct' })
    expect(direct).toContain('```html-render')
    expect(direct).toContain('<div class="aw-kicker">1 commit et push origin main réussi</div>')
    expect(direct).not.toContain('GIT : 1 commit')
    expect(direct).toContain(
      '<span class="aw-chip awp-sha">e4daf170</span> agent run-1: t &lt;x&gt;'
    )
    expect(direct).toContain('ALLOW_MAIN_PUSH=1 git push origin e4daf1702e098832:refs/heads/main')
    // conv-1600 : le rail compact choisi en conv-1574 (« 1 · Compact rail »), pas l'ancien bloc —
    // la fin d'un run poussé dessinait encore la liste d'avant le /draft.
    expect(direct).toContain('class="awp-rail"')
    expect(direct).toMatch(/<b>Commit<\/b>[\s\S]*<b>Push<\/b>[\s\S]*Annuler la publication/)
    expect(direct).toContain('vers origin/main')
    expect(direct).toContain('Annuler la publication (git revert e4daf170, puis push)')
    expect(direct).not.toContain('<b>Commit et push</b>')
    const repli = annonceCommitLocal(issue, 'run-1', 't', { branche: 'auto/run-1', mode: 'pr' })
    expect(repli).toContain('git push origin e4daf1702e098832:refs/heads/auto/run-1')
    expect(repli).toContain('1 commit et push origin auto/run-1 réussi')
    expect(repli).not.toContain('ALLOW_MAIN_PUSH')
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
