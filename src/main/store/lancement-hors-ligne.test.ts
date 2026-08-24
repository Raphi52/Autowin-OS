import { afterEach, describe, expect, it } from 'vitest'
/**
 * LE DÉFAUT, reproduit le 2026-08-24 : lancer une conversation exigeait un `git fetch` RÉUSSI. Hors
 * ligne, VPN coupé ou origin momentanément injoignable, l'app rendait « Lancement bloqué » — alors
 * qu'`origin/main` était parfaitement connu en local. Trois conversations = trois fetch = trois
 * occasions d'échouer AVANT tout travail. C'est la première moitié de la demande de l'utilisateur,
 * et elle n'était couverte par aucun test.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

afterEach(() => {
  for (const d of roots.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* verrou windows */ }
  }
})

describe('lancer une conversation quand origin ne repond pas', () => {
  it('ne bloque pas si origin/main est deja connu localement', () => {
    const repo = tempRepo()
    // Un origin qui existe, dont on connait main, mais injoignable maintenant.
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'))
    const racine = mkdtempSync(join(tmpdir(), 'autowin-offline-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    expect(() => wm.describeForLaunch('conv-1')).not.toThrow()
  })

  it('part bien de la reference canonique connue, pas d’autre chose', () => {
    const repo = tempRepo()
    const attendu = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    git(repo, 'update-ref', 'refs/remotes/origin/main', attendu)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-offline2-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    expect(wm.describeForLaunch('conv-1')).toMatchObject({
      canonicalBaseRef: 'origin/main',
      sourceSha: attendu
    })
  })

  it('REFUSE encore quand origin est injoignable ET qu’aucune reference locale ne le supplee', () => {
    // L'entrée qui doit faire échouer une garde devenue trop permissive : rien à quoi se raccrocher.
    const repo = tempRepo()
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    const racine = mkdtempSync(join(tmpdir(), 'autowin-offline3-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine, requireCanonicalRemote: true })

    expect(() => wm.describeForLaunch('conv-1')).toThrow(/Lancement bloqué/)
  })
})
