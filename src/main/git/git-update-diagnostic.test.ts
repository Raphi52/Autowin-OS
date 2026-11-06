import { describe, expect, it } from 'vitest'
import { diagnostiquerEchecMaj } from './git-update'

/**
 * LE MESSAGE D'ÉCHEC DE MISE À JOUR MENTAIT — et ce mensonge a coûté une conversation entière.
 *
 * Vécu par l'utilisateur le 2026-08-14, conversation « Réparer la mise à jour ». L'app annonçait :
 * « La mise à jour n'a pas pu s'appliquer par-dessus ton travail non committé — il reste INTACT.
 * Committe-le ou mets-le de côté toi-même (git stash), puis relance. » Or git, dans le même message,
 * disait tout autre chose : « Diverging branches can't be fast-forwarded ».
 *
 * Son arbre était posé sur `autowin/recovery/run-e9bba61b1111-1`, une branche de récupération portant
 * un commit propre, 1 devant `origin/main`. Committer ou stasher ne pouvait donc RIEN réparer : la
 * consigne était fausse, et le tour a tourné en rond jusqu'à rester figé.
 *
 * FAUTE DE FOND : le message était choisi sur `dirty` — un arbre sale AU MOMENT d'un échec n'en est
 * pas la cause. Une corrélation était présentée comme un diagnostic. La règle posée ici : on lit la
 * raison rendue par git, et l'arbre sale n'est accusé QUE si git le nomme lui-même.
 */
const DIVERGENCE =
  "Command failed: git pull --ff-only\nhint: Diverging branches can't be fast-forwarded, you need to either:\nhint: \tgit merge --no-ff"

describe('diagnostic d’un échec de mise à jour', () => {
  it('sur une DIVERGENCE, nomme la branche et n’accuse PAS le travail non committé', () => {
    // Le cas exactement vécu : arbre sale ET divergence. L'ancien code n'aurait vu que l'arbre sale.
    const message = diagnostiquerEchecMaj(
      new Error(DIVERGENCE),
      true,
      'autowin/recovery/run-e9bba61b1111-1'
    )
    expect(message).toContain('autowin/recovery/run-e9bba61b1111-1')
    expect(message).toContain('divergé')
    expect(message).not.toContain('git stash')
    expect(message).not.toContain("n'a pas pu s'appliquer par-dessus ton travail non committé")
  })

  it('sur une divergence de « main » lui-même, propose de pousser ou fusionner', () => {
    const message = diagnostiquerEchecMaj(new Error(DIVERGENCE), false, 'main')
    expect(message).toContain('main')
    expect(message).toMatch(/pousse|fusionne|rebase/i)
  })

  it('accuse le travail non committé SEULEMENT quand git le nomme', () => {
    const gitLeDit = new Error(
      'error: Your local changes to the following files would be overwritten by merge: src/a.ts'
    )
    expect(diagnostiquerEchecMaj(gitLeDit, true, 'main')).toContain('travail non committé')
  })

  it('un arbre sale par COÏNCIDENCE n’est pas accusé', () => {
    /*
      Le cœur de la correction. Une panne réseau pendant qu'un fichier traîne modifié n'a rien à voir
      avec ce fichier ; envoyer l'utilisateur committer pour rien est ce qui l'a fait tourner en rond.
    */
    const sansRapport = new Error('fatal: unable to access origin: Could not resolve host')
    const message = diagnostiquerEchecMaj(sansRapport, true, 'main')
    expect(message).not.toContain('git stash')
    expect(message).toContain('Could not resolve host')
  })

  it('rapporte TOUJOURS la raison brute de git, quel que soit le cas', () => {
    // Sans elle, l'utilisateur ne peut ni vérifier ni chercher : c'est la seule donnée non interprétée.
    for (const cas of [
      diagnostiquerEchecMaj(new Error(DIVERGENCE), true, 'main'),
      diagnostiquerEchecMaj(new Error('boom inattendu'), false, 'main')
    ]) {
      expect(cas.length).toBeGreaterThan(20)
    }
    expect(diagnostiquerEchecMaj(new Error('boom inattendu'), false, 'main')).toContain(
      'boom inattendu'
    )
  })
})
