import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)
/*
 * Suites git REELLES : `vi.setConfig` comme les autres suites `worktree-manager.*` (convention
 * maison, cf. `worktree-manager.publication.test.ts:31`). Un depot temporaire, un worktree, un
 * merge : 15 a 30 s seuls, davantage quand quatre workers tournent en parallele. Le plafond global
 * de 20 s les faisait echouer en LOT alors qu'elles passent seules — un faux rouge de charge, qui
 * ferait douter de tests parfaitement valides.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/**
 * L'ANCIEN DRAPEAU, transmis a l'execution. Un appelant pas encore mis a jour, ou un message du
 * worker reste sur l'ancienne forme, peut encore l'envoyer : il ne doit rien ouvrir.
 */
const ancienDrapeau = { preserverEditionLocale: true } as unknown as Parameters<
  ReturnType<typeof manager>['finalize']
>[1]

/**
 * La copie ne publie jamais en ecrivant dans l'arbre partage. Un fichier que l'utilisateur a modifie
 * sans l'avoir committe reste a lui, octet pour octet : la publication est refusee, la copie reste,
 * et son travail reste atteignable par l'adresse d'attente. Aucune remise de cote (stash), aucune
 * fusion a trois branches ecrite chez lui.
 *
 * Ces tests tournent sur de VRAIS depots git temporaires : c'est un environnement ISOLE, ou aucune
 * autre session n'ecrit.
 */
describe("WorktreeManager — l'arbre partage n'est jamais ecrit par la copie", () => {
  /**
   * Base : `a.txt` vaut « ligne1/ligne2/ligne3 » au commit initial (voir `tempRepo`).
   * L'utilisateur edite une extremite, la copie l'autre : une fusion automatique tiendrait les deux,
   * ce qui est justement ce qu'on ne doit pas faire chez lui.
   */
  const collisionSansChevauchement = (): {
    repo: string
    wm: ReturnType<typeof manager>
    path: string
  } => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(repo, 'a.txt'), 'ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n')
    writeFileSync(join(path, 'a.txt'), 'ENTETE COPIE\nligne1\nligne2\nligne3\n')
    return { repo, wm, path }
  }

  it('sans drapeau, RIEN ne change : on reste sur l attente', () => {
    const { repo, wm } = collisionSansChevauchement()

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe(
      'ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n'
    )
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/integration/builder')).toBeTruthy()
  })

  it("l'ancien drapeau n'ecrit pas dans l'arbre : le fichier modifie reste identique, la copie reste", () => {
    const { repo, wm, path } = collisionSansChevauchement()
    const avant = readFileSync(join(repo, 'a.txt'))
    const teteAvant = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder', ancienDrapeau)

    // Ni fusion, ni ligne ajoutee : le fichier de l'utilisateur n'a pas bouge d'un octet.
    expect(readFileSync(join(repo, 'a.txt')).equals(avant)).toBe(true)
    // Rien n'est publie : la branche ne bouge pas, et la copie reste sur le disque.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(teteAvant)
    expect(existsSync(path)).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
  })

  it("l'ancien drapeau ne cree ni remise de cote (stash) ni sauvegarde de l'arbre", () => {
    const { repo, wm } = collisionSansChevauchement()

    wm.finalize('builder', ancienDrapeau)

    expect(git(repo, 'stash', 'list')).toBe('')
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/safety/builder')).toThrow()
  })

  it('fusion REELLEMENT conflictuelle : son fichier reste a l identique, aucun marqueur de conflit', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    // Les deux editent LA MEME ligne : aucune fusion automatique honnete n'est possible.
    writeFileSync(join(repo, 'a.txt'), 'ligne1\nVERSION UTILISATEUR\nligne3\n')
    writeFileSync(join(path, 'a.txt'), 'ligne1\nVERSION COPIE\nligne3\n')

    const res = wm.finalize('builder', ancienDrapeau)

    // On ne publie pas, et surtout on ne laisse aucun marqueur de conflit dans son arbre.
    expect(res.outcome).toBe('blocked')
    const contenu = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(contenu).toBe('ligne1\nVERSION UTILISATEUR\nligne3\n')
    expect(contenu).not.toContain('<<<<<<<')
    expect(contenu).not.toContain('VERSION COPIE')
    // Le travail de la copie reste atteignable : on retombe sur l'attente, pas sur la perte.
    expect((res as { stagedRef?: string }).stagedRef).toBe('refs/autowin/integration/builder')
    expect(git(repo, 'stash', 'list')).toBe('')
  })

  it('base PROPRE : le chemin normal publie, l ancien drapeau n y change rien', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l agent\n')

    const res = wm.finalize('builder', ancienDrapeau)

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'livrable.txt'), 'utf8')).toContain('travail de l agent')
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/safety/builder')).toThrow()
  })
})
