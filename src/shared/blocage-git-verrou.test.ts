import { describe, expect, it } from 'vitest'
import { estVerrouGitTenu, motifDeBlocagePublication } from './blocage-git-verrou'

/*
 * LES MESSAGES SONT CEUX QUE GIT A REELLEMENT ECRITS, releves le 2026-09-06 sur trois publications
 * concurrentes. Les inventer aurait fait un test qui prouve ma paraphrase, pas le comportement.
 */
const VERROU_INDEX =
  "La finalisation Git a échoué de façon inattendue : Command failed: git write-tree\n" +
  "fatal: Unable to create 'D:/depot/.git/index.lock': File exists.\n\n" +
  'Another git process seems to be running in this repository, or the lock file may be stale'
const VERROU_REF =
  "fatal: update_ref failed for ref 'ORIG_HEAD': cannot lock ref 'ORIG_HEAD': " +
  "Unable to create 'D:/depot/.git/ORIG_HEAD.lock': File exists."

describe('un verrou git tenu n’est pas une fusion refusée', () => {
  it('reconnaît le verrou d’index d’une publication concurrente', () => {
    expect(estVerrouGitTenu(VERROU_INDEX)).toBe(true)
    expect(motifDeBlocagePublication(VERROU_INDEX)).toBe('base-in-progress')
  })

  it('reconnaît le verrou d’une référence', () => {
    expect(estVerrouGitTenu(VERROU_REF)).toBe(true)
    expect(motifDeBlocagePublication(VERROU_REF)).toBe('base-in-progress')
  })

  /*
   * TROISIEME VISAGE, releve au troisieme passage : git refuse la mise a jour d'une reference
   * pendant qu'une autre transaction est ouverte. Meme cause, meme conseil.
   */
  it('reconnaît le refus du crochet de transaction de références', () => {
    const message = "fatal: in 'prepared' phase, update aborted by the reference-transaction hook"
    expect(estVerrouGitTenu(message)).toBe(true)
    expect(motifDeBlocagePublication(message)).toBe('base-in-progress')
  })

  /*
   * UN VRAI CONFLIT RESTE UN VRAI CONFLIT. Requalifier trop large serait remplacer un motif faux
   * par un autre — et celui-ci enverrait attendre une opération qui n'existe pas.
   */
  it('laisse un conflit de contenu en merge-failed', () => {
    const conflit =
      'CONFLICT (content): Merge conflict in src/app.ts\nAutomatic merge failed; fix conflicts.'
    expect(estVerrouGitTenu(conflit)).toBe(false)
    expect(motifDeBlocagePublication(conflit)).toBe('merge-failed')
  })

  it('ne requalifie rien sans message', () => {
    expect(estVerrouGitTenu(undefined)).toBe(false)
    expect(motifDeBlocagePublication(undefined)).toBe('merge-failed')
    expect(motifDeBlocagePublication('')).toBe('merge-failed')
  })
})
