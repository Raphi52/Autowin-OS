import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkoutBranch } from './git-checkout-main'

/**
 * La bascule de branche est la SEULE action git qu'un bouton peut declencher : ces tests fixent sa
 * borne. Depot reel jetable -- un faux `git` prouverait seulement que le mock repond.
 */
describe('checkoutBranch', () => {
  let repo: string
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'ignore' })
  }
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'autowin-checkout-'))
    git('init', '-b', 'main')
    git('config', 'user.email', 't@t.t')
    git('config', 'user.name', 'T')
    writeFileSync(join(repo, 'a.txt'), 'un\n')
    git('add', '.')
    git('commit', '-m', 'init')
    git('branch', 'autre')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('bascule sur une branche locale quand le depot est propre', async () => {
    const r = await checkoutBranch(repo, 'autre')
    expect(r).toEqual({ ok: true, branch: 'autre' })
    const courante = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repo,
      windowsHide: true
    })
      .toString()
      .trim()
    expect(courante).toBe('autre')
  })

  /*
    L'ancien test figeait un refus PLUS STRICT QUE GIT : tout arbre sale etait bloque, meme quand la
    bascule ne risquait rien. Il empechait de changer de branche des qu'un fichier etait modifie.
  */
  it('BASCULE malgre des fichiers modifies quand git ne risque rien', async () => {
    writeFileSync(join(repo, 'a.txt'), 'modifie\n')
    const r = await checkoutBranch(repo, 'autre')
    expect(r).toEqual({ ok: true, branch: 'autre' })
    const courante = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repo,
      windowsHide: true
    })
      .toString()
      .trim()
    expect(courante).toBe('autre')
    // Le travail non enregistre est INTACT apres la bascule : rien n'a ete stashe ni ecrase.
    expect(readFileSync(join(repo, 'a.txt')).toString()).toBe('modifie\n')
  })

  it('laisse GIT refuser quand la bascule ecraserait le travail local', async () => {
    // `autre` fait diverger a.txt : le fichier modifie localement serait ecrase.
    git('checkout', 'autre')
    writeFileSync(join(repo, 'a.txt'), 'version-autre\n')
    git('commit', '-am', 'divergence')
    git('checkout', 'main')
    writeFileSync(join(repo, 'a.txt'), 'travail-en-cours\n')

    const r = await checkoutBranch(repo, 'autre')
    expect(r.ok).toBe(false)
    const courante = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repo,
      windowsHide: true
    })
      .toString()
      .trim()
    expect(courante).toBe('main')
    expect(readFileSync(join(repo, 'a.txt')).toString()).toBe('travail-en-cours\n')
  })

  it('refuse une branche locale inconnue', async () => {
    const r = await checkoutBranch(repo, 'fantome')
    expect(r.ok).toBe(false)
  })
})
