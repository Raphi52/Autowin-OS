import { describe, expect, it } from 'vitest'
import { decouperDiffParFichier } from './workspace-mutation-evidence'

/**
 * Mesure du 2026-09-03 : la preuve de mutation lancait UN `git diff` PAR fichier, a 145 ms l'appel,
 * sur le thread qui dessine la fenetre. Un seul appel suffit — a condition de savoir redecouper.
 */
describe('decouperDiffParFichier', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -0,0 +1 @@',
    '+const a = 1',
    'diff --git a/src/b.ts b/src/b.ts',
    'index 333..444 100644',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -0,0 +1 @@',
    '+const b = 2'
  ].join('\n')

  it('rend une portion par fichier, indexee sur le chemin d apres', () => {
    const portions = decouperDiffParFichier(diff)
    expect([...portions.keys()]).toEqual(['src/a.ts', 'src/b.ts'])
    expect(portions.get('src/a.ts')).toContain('+const a = 1')
    expect(portions.get('src/a.ts')).not.toContain('+const b = 2')
    expect(portions.get('src/b.ts')).toContain('+const b = 2')
  })

  it('ecarte un fichier supprime — il n ajoute aucune ligne', () => {
    const supprime = [
      'diff --git a/src/c.ts b/src/c.ts',
      'deleted file mode 100644',
      '--- a/src/c.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-const c = 3'
    ].join('\n')
    expect([...decouperDiffParFichier(supprime).keys()]).toEqual([])
  })

  it('rend une carte vide sur un diff vide', () => {
    expect(decouperDiffParFichier('').size).toBe(0)
  })
})
