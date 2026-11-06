import { describe, expect, it } from 'vitest'
import { annonceEditionLocaleNonRemise } from './annonce-edition-locale'

describe('annonceEditionLocaleNonRemise (cas du 24/10, conv-1139)', () => {
  it('rien à annoncer : publication sans constat, issue absente ou de forme inconnue', () => {
    expect(annonceEditionLocaleNonRemise({ outcome: 'merged', committed: true })).toBeUndefined()
    expect(annonceEditionLocaleNonRemise(undefined)).toBeUndefined()
    expect(annonceEditionLocaleNonRemise('merged')).toBeUndefined()
    expect(
      annonceEditionLocaleNonRemise({
        outcome: 'merged',
        editionLocaleNonRemise: { fichiers: [], sauvegarde: 'refs/autowin/safety/x', cause: 'c' }
      })
    ).toBeUndefined()
  })

  it('fichiers non remis : les nomme, dit où est sa version et comment la voir', () => {
    const phrase = annonceEditionLocaleNonRemise({
      outcome: 'merged',
      editionLocaleNonRemise: {
        fichiers: ['src/main/providers/claude.ts', 'src/main/store/worktree-manager.ts'],
        sauvegarde: 'refs/autowin/safety/run-58bfc90f8f7b-1',
        remise: '9e0a93be44df101858879779ab7a407f1e0d599f',
        cause: 'src/main/providers/claude.ts : modifié depuis la publication, rien écrasé'
      }
    })
    expect(phrase).toMatch(
      /^⚠️ Ta modification non commitée de `src\/main\/providers\/claude\.ts`, `src\/main\/store\/worktree-manager\.ts` n'a PAS été remise/
    )
    expect(phrase).toContain('la remise de côté `9e0a93be`')
    expect(phrase).toContain('la sauvegarde `refs/autowin/safety/run-58bfc90f8f7b-1`')
    expect(phrase).toContain(
      '`git show refs/autowin/safety/run-58bfc90f8f7b-1:src/main/providers/claude.ts`'
    )
    expect(phrase).toContain('modifié depuis la publication')
  })

  it('fichiers remis mais remise restée dans la pile : le doublon est dit', () => {
    const phrase = annonceEditionLocaleNonRemise({
      outcome: 'merged',
      editionLocaleNonRemise: {
        fichiers: [],
        sauvegarde: 'refs/autowin/safety/x',
        remise: 'abcdef0123456789',
        cause: 'git stash drop : verrou'
      }
    })
    expect(phrase).toMatch(/sont revenus, mais la remise de côté `abcdef01`/)
    expect(phrase).toContain('doublon')
  })
})
