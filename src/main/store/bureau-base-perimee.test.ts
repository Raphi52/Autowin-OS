import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import type { WorktreeManager } from './worktree-manager'

/** `pathFor` est prive : le test doit nommer le meme dossier que la production, sans le dupliquer. */
const cheminDe = (wm: WorktreeManager, id: string): string =>
  (wm as unknown as { pathFor(agentId: string): string }).pathFor(id)

afterEach(nettoyerRacines)

/**
 * DEFAUT MESURE (conv-1516, 2026-08-29) : `edit_file` derive une cle de bureau STABLE par tache
 * (`cleDeBureau`). A la deuxieme tentative, `acquire` retrouve le DOSSIER de la tentative
 * precedente et le rend TEL QUEL : `if (existsSync(path)) return path`. Aucune comparaison avec la
 * revision de depart demandee. Le bureau reste donc accroche a la base d'il y a trois jours pendant
 * que `read_file` lit `main` — d'ou `ChatView.css` qui montre `16px` ligne 355 dans le depot et
 * `13px` ligne 161 dans le bureau, meme apres un commit propre de la base.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CETTE CORRECTION SI ELLE EST FAUSSE : le troisieme test. Un bureau
 * dont la tete est un commit POSE PAR L'AGENT au-dessus de la revision demandee n'est pas perime —
 * une correction qui recreerait le bureau des que `HEAD !== startRevision` detruirait ce travail.
 */
describe('acquire — un bureau retrouve ne doit pas rester sur une base perimee', () => {
  it('rafraichit un bureau propre reste sur une base plus ancienne que la revision demandee', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const ancien = git(repo, 'rev-parse', 'HEAD')
    const chemin = wm.acquire('command-edit-stable', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-edit-stable'),
      baseBranch: 'main',
      baseSha: ancien
    })
    expect(readFileSync(join(chemin, 'a.txt'), 'utf8')).toContain('ligne1')

    // La base avance — exactement le `git commit` qui a precede la deuxieme tentative d'edit_file.
    writeFileSync(join(repo, 'a.txt'), 'font-size: 16px\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base avancee')
    const frais = git(repo, 'rev-parse', 'HEAD')

    const reacquis = wm.acquire('command-edit-stable', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-edit-stable'),
      baseBranch: 'main',
      baseSha: frais
    })
    expect(git(reacquis, 'rev-parse', 'HEAD')).toBe(frais)
    expect(readFileSync(join(reacquis, 'a.txt'), 'utf8')).toContain('16px')
  })

  it('refuse — sans rien detruire — un bureau perime qui porte du travail non publie', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const ancien = git(repo, 'rev-parse', 'HEAD')
    const chemin = wm.acquire('command-edit-sale', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-edit-sale'),
      baseBranch: 'main',
      baseSha: ancien
    })
    writeFileSync(join(chemin, 'brouillon.txt'), 'travail non publie\n')

    writeFileSync(join(repo, 'a.txt'), 'font-size: 16px\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base avancee')
    const frais = git(repo, 'rev-parse', 'HEAD')

    expect(() =>
      wm.acquire('command-edit-sale', {
        workspacePath: repo,
        worktreePath: cheminDe(wm, 'command-edit-sale'),
        baseBranch: 'main',
        baseSha: frais
      })
    ).toThrow(/base p[ée]rim[ée]e/i)
    expect(existsSync(join(chemin, 'brouillon.txt'))).toBe(true)
  })

  /*
   * DEFAUT MESURE (bulletin de maintenance du 2026-10-24, conv-1048) : `verify` recopie dans sa
   * copie `command-verify-<conv>` les fichiers non commites du depot, pour verifier l'etat courant
   * (`synchroniserBureauDeVerification`). Ces fichiers sont un MIROIR, jamais du travail. Des que la
   * base avancait, le refus ci-dessus les prenait pour du travail non publie : la copie restait
   * bloquee pour toujours et chaque `verify` retombait sur le dossier partage — 17 verdicts sur 37
   * le 23/10, 2 sur 2 le 24/10.
   */
  it('rafraichit une copie de verification perimee : ses fichiers recopies ne sont pas du travail', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const ancien = git(repo, 'rev-parse', 'HEAD')
    const chemin = wm.acquire('command-verify-conv-9', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-verify-conv-9'),
      baseBranch: 'main',
      baseSha: ancien
    })
    writeFileSync(join(chemin, 'a.txt'), 'copie du fichier non commite du depot\n')

    writeFileSync(join(repo, 'a.txt'), 'font-size: 16px\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base avancee')
    const frais = git(repo, 'rev-parse', 'HEAD')

    const reacquis = wm.acquire('command-verify-conv-9', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-verify-conv-9'),
      baseBranch: 'main',
      baseSha: frais
    })
    expect(git(reacquis, 'rev-parse', 'HEAD')).toBe(frais)
    expect(readFileSync(join(reacquis, 'a.txt'), 'utf8')).toContain('16px')
  })

  it('laisse INTACT un bureau dont la tete est un commit pose au-dessus de la revision demandee', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const base = git(repo, 'rev-parse', 'HEAD')
    const chemin = wm.acquire('command-edit-avance', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-edit-avance'),
      baseBranch: 'main',
      baseSha: base
    })
    writeFileSync(join(chemin, 'a.txt'), 'travail agent\n')
    git(chemin, 'add', '-A')
    git(chemin, 'commit', '-q', '-m', 'agent')
    const tete = git(chemin, 'rev-parse', 'HEAD')

    const reacquis = wm.acquire('command-edit-avance', {
      workspacePath: repo,
      worktreePath: cheminDe(wm, 'command-edit-avance'),
      baseBranch: 'main',
      baseSha: base
    })
    expect(git(reacquis, 'rev-parse', 'HEAD')).toBe(tete)
    expect(readFileSync(join(reacquis, 'a.txt'), 'utf8')).toContain('travail agent')
  })
})
