import { describe, expect, it } from 'vitest'
import { adresseDeSecours } from './worktree-path-rewrite'

/**
 * LE GESTE DE RECUPERATION NE DOIT PAS DETRUIRE CE QUE LA GARDE PROTEGE.
 *
 * Mesure du 2026-08-22. L'adresse de secours proposait `git checkout <ref> -- .`. Sur un refus
 * `base-dirty` — dont la RAISON D'ETRE est de proteger des fichiers non commites — ce geste
 * ecraserait exactement ces fichiers. Donner l'adresse, c'est donner le geste : tant qu'il est
 * destructeur, poser une adresse sur `base-dirty` est dangereux, et c'est pourquoi l'exclusion
 * tenait.
 *
 * CE QUI NE CHANGE PAS, et c'est deliberé : le chantier du 2026-08-18 avait choisi un geste qui
 * RECUPERE plutot qu'un qui INSPECTE (« `git show` ne rapatrie rien »). Cette intention est
 * conservee — `git worktree add` rapatrie les fichiers pour de vrai. Seule sa propriete
 * destructrice disparait : il les depose AILLEURS.
 */
describe('adresse de secours — récupérer sans écraser', () => {
  const REF = 'refs/autowin/rescue/run-9'

  it('ne propose plus un geste qui écrit dans l’arbre de travail', () => {
    expect(adresseDeSecours(REF)).not.toMatch(/git checkout/)
  })

  it('propose toujours un geste qui RÉCUPÈRE les fichiers, pas seulement qui les lit', () => {
    // L'intention du 18/08 tient : on rapatrie, on ne se contente pas d'afficher un diff.
    expect(adresseDeSecours(REF)).toMatch(/git worktree add/)
  })

  it('garde la lecture comme second geste', () => {
    expect(adresseDeSecours(REF)).toMatch(/git diff/)
  })

  it('DIT que le travail local n’est pas touché — sinon l’utilisateur n’ose pas', () => {
    expect(adresseDeSecours(REF)).toMatch(/sans rien écraser|n['’]écrase rien|rien n['’]est écrasé/i)
  })

  it('sans adresse, aucune promesse — non régressé', () => {
    expect(adresseDeSecours(undefined)).toBe('')
  })
})
