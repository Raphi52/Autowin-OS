import { describe, expect, it } from 'vitest'
import { destinationDuPush, titreDuBandeau } from './titre-bandeau-git'

// Le titre du bloc git est un statut, « 1 commit et push origin main réussi ».
describe('titreDuBandeau', () => {
  it('commit et push vers main : la phrase demandée', () => {
    const ligne =
      'cd /d/X; ALLOW_MAIN_PUSH=1 git push origin HEAD:main 2>&1 | tail -8; echo "push exit ${PIPESTATUS[0]}"'
    expect(titreDuBandeau(1, ['git commit -q -F - <<EOF', ligne])).toBe(
      '1 commit et push origin main réussi'
    )
  })

  it('accorde le pluriel des commits', () => {
    expect(titreDuBandeau(3, ['git push -q origin HEAD:main'])).toBe(
      '3 commits et push origin main réussi'
    )
  })

  it('sans destination lisible, dit « push réussi » sans en inventer une', () => {
    expect(titreDuBandeau(1, ['git push 2>&1'])).toBe('1 commit et push réussi')
    expect(titreDuBandeau(1, ['git push origin 2>&1 | tail -2'])).toBe('1 commit et push réussi')
  })

  it('sans ligne de push, ne dit pas « réussi » : les commits sont seulement en ligne', () => {
    expect(titreDuBandeau(2, [])).toBe('2 commits en ligne')
    expect(titreDuBandeau(1, ['git commit -m x'])).toBe('1 commit en ligne')
  })
})

describe('destinationDuPush', () => {
  it('lit le distant et la branche, refs/heads et + retirés', () => {
    expect(destinationDuPush(['git push origin e4daf170:refs/heads/main'])).toBe('origin main')
    expect(destinationDuPush(['git push --no-verify origin +HEAD:auto/run-1'])).toBe(
      'origin auto/run-1'
    )
    expect(destinationDuPush(['git push -u origin ma-branche'])).toBe('origin ma-branche')
  })

  it('garde la DERNIÈRE ligne de push du tour', () => {
    expect(
      destinationDuPush(['git push --dry-run origin HEAD:essai', 'git push origin HEAD:main'])
    ).toBe('origin main')
  })

  it('rend undefined sans destination', () => {
    expect(destinationDuPush(['git push'])).toBeUndefined()
    expect(destinationDuPush(['git push origin --no-verify'])).toBeUndefined()
  })
})
