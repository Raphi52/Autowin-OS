import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('REFUSE si des modifications ne sont pas enregistrees, et ne bascule pas', async () => {
    writeFileSync(join(repo, 'a.txt'), 'modifie\n')
    const r = await checkoutBranch(repo, 'autre')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/non enregistr/i)
    const courante = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repo,
      windowsHide: true
    })
      .toString()
      .trim()
    expect(courante).toBe('main')
  })

  it('refuse une branche locale inconnue', async () => {
    const r = await checkoutBranch(repo, 'fantome')
    expect(r.ok).toBe(false)
  })
})
