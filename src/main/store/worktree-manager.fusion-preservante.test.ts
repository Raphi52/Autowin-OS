import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
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
 * BARREAU 2 DE L'ECHELLE — publier SANS ecraser l'edition non committee de l'utilisateur.
 *
 * Barreau 1 met le travail en attente ; il n'atterrit toujours pas. Ce barreau-ci le fait atterrir
 * TOUT DE SUITE, en fusionnant a trois branches le fichier en collision : base commune, version de
 * l'utilisateur, version de la copie. L'utilisateur l'a autorise explicitement (QCM du 2026-08-27,
 * option « l'echelle complete »), et c'est la seule raison pour laquelle ecrire dans son arbre est
 * permis ici : par defaut, ca ne l'est pas.
 *
 * La contrepartie n'est pas negociable et c'est elle que cette suite verifie : son travail non
 * committe SURVIT, octet pour octet quand il n'y a pas de chevauchement de lignes, et quand la fusion
 * est REELLEMENT conflictuelle on ne laisse RIEN d'abime — on restaure son etat exact et on retombe
 * sur l'attente. Un arbre a moitie fusionne, avec des marqueurs de conflit dans un fichier qu'il
 * n'a pas demande a arbitrer, serait pire que le refus d'origine.
 *
 * Ces tests tournent sur de VRAIS depots git temporaires : c'est un environnement ISOLE, ou aucune
 * autre session n'ecrit — la condition que l'arbre partage ne permettait pas (mesure du 2026-08-27,
 * un acteur concurrent a rendu une mesure e2e ininterpretable).
 */
describe('WorktreeManager — fusion preservante (barreau 2)', () => {
  /**
   * Base : `a.txt` vaut « ligne1/ligne2/ligne3 » au commit initial (voir `tempRepo`).
   * L'utilisateur edite une extremite, la copie l'autre : la fusion a 3 branches doit tenir les deux.
   */
  const collisionSansChevauchement = (): {
    repo: string
    wm: ReturnType<typeof manager>
  } => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(repo, 'a.txt'), 'ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n')
    writeFileSync(join(path, 'a.txt'), 'ENTETE COPIE\nligne1\nligne2\nligne3\n')
    return { repo, wm }
  }

  it('sans autorisation, RIEN ne change : on reste sur l attente du barreau 1', () => {
    const { repo, wm } = collisionSansChevauchement()

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n')
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/integration/builder')).toBeTruthy()
  })

  it('autorisee : le travail ATTERRIT et l edition de l utilisateur survit', () => {
    const { repo, wm } = collisionSansChevauchement()
    const teteAvant = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder', { preserverEditionLocale: true })

    // Le travail est publie : la branche a avance.
    expect(res.outcome).toBe('merged')
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(teteAvant)
    const contenu = readFileSync(join(repo, 'a.txt'), 'utf8')
    // LES DEUX apports sont la — c'est tout l'objet du barreau.
    expect(contenu).toContain('ENTETE COPIE')
    expect(contenu).toContain('AJOUT UTILISATEUR')
    // Et son apport reste NON COMMITTE : on publie le travail de la copie, on ne s'approprie pas le sien.
    expect(git(repo, 'status', '--porcelain=v1')).toContain('a.txt')
    expect(git(repo, 'show', 'HEAD:a.txt')).not.toContain('AJOUT UTILISATEUR')
  })

  it('une sauvegarde de son travail existe AVANT toute ecriture', () => {
    const { repo, wm } = collisionSansChevauchement()

    wm.finalize('builder', { preserverEditionLocale: true })

    // L'adresse de secours doit rendre exactement son etat d'origine : c'est le filet qui autorise
    // le reste. Sans elle, une fusion ratee laisserait son travail sans recours.
    const sauvegarde = git(repo, 'rev-parse', '--verify', 'refs/autowin/safety/builder')
    expect(sauvegarde).toBeTruthy()
    expect(git(repo, 'show', `${sauvegarde}:a.txt`)).toContain('AJOUT UTILISATEUR')
  })

  it('fusion REELLEMENT conflictuelle : son fichier est restaure a l identique, rien n est abime', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    // Les deux editent LA MEME ligne : aucune fusion automatique honnete n'est possible.
    writeFileSync(join(repo, 'a.txt'), 'ligne1\nVERSION UTILISATEUR\nligne3\n')
    writeFileSync(join(path, 'a.txt'), 'ligne1\nVERSION COPIE\nligne3\n')

    const res = wm.finalize('builder', { preserverEditionLocale: true })

    // On ne publie pas, et surtout on ne laisse aucun marqueur de conflit dans son arbre.
    expect(res.outcome).toBe('blocked')
    const contenu = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(contenu).toBe('ligne1\nVERSION UTILISATEUR\nligne3\n')
    expect(contenu).not.toContain('<<<<<<<')
    expect(contenu).not.toContain('VERSION COPIE')
    // Et le travail de la copie reste atteignable : on retombe sur l'attente, pas sur la perte.
    expect((res as { stagedRef?: string }).stagedRef).toBe('refs/autowin/integration/builder')
    // Aucun stash orphelin laisse derriere : son travail est dans son arbre, pas ranger ailleurs.
    expect(git(repo, 'stash', 'list')).toBe('')
  })

  it('base PROPRE : l autorisation ne change rien au chemin normal', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l agent\n')

    const res = wm.finalize('builder', { preserverEditionLocale: true })

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'livrable.txt'), 'utf8')).toContain('travail de l agent')
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/safety/builder')).toThrow()
  })
})
