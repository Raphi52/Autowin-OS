import { afterEach, describe, expect, it } from 'vitest'
/**
 * LE DÉFAUT, reproduit le 2026-08-24 : lancer une conversation exigeait un `git fetch` RÉUSSI. Hors
 * ligne, VPN coupé ou origin momentanément injoignable, l'app rendait « Lancement bloqué » — alors
 * qu'`origin/main` était parfaitement connu en local. Trois conversations = trois fetch = trois
 * occasions d'échouer AVANT tout travail. C'est la première moitié de la demande de l'utilisateur,
 * et elle n'était couverte par aucun test.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { racineDe, git, roots, tempRepo } from './worktree-manager.test-helpers'
import { GIT_COMMAND_TIMEOUT_MS, JOURNAL_DES_LANCEMENTS, tryGit } from './worktree-manager-outils'

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* verrou windows */
    }
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
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: repo,
      worktreeRoot: racine
    })

    expect(() => wm.describeForLaunch('conv-1')).not.toThrow()
  })

  it('part bien de la reference canonique connue, pas d’autre chose', () => {
    const repo = tempRepo()
    const attendu = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    git(repo, 'update-ref', 'refs/remotes/origin/main', attendu)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-offline2-'))
    roots.push(racine)
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: repo,
      worktreeRoot: racine
    })

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
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: repo,
      worktreeRoot: racine,
      requireCanonicalRemote: true
    })

    expect(() => wm.describeForLaunch('conv-1')).toThrow(/Lancement bloqué/)
  })

  it('borne le fetch d’origine par un délai à lui, plus court que le délai git général', () => {
    // LE DÉFAUT : le fetch peut se taire jusqu'à son délai. Sans délai propre, il prend le délai git
    // général (180 s) ; le lancement entier a un budget de 182 s. Un origin muet épuise donc presque
    // tout le budget, et les étapes locales qui suivent dépassent les 2 s restantes : la limite coupe
    // un lancement qui aurait réussi en repliant sur origin/main déjà connu.
    const repo = tempRepo()
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    // fix-ok: cause mesurée — le premier rouge tombait sur « Lancement bloqué » (origin/main absent du dépôt de test), pas sur le délai du fetch ; origin/main est posé localement pour que seul le délai soit testé.
    git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'))
    const racine = mkdtempSync(join(tmpdir(), 'autowin-fetch-budget-'))
    roots.push(racine)
    const appels: Array<{ args: string[]; timeoutMs?: number }> = []
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racine,
      tryGitFn: (dossier, args, options) => {
        appels.push({ args, timeoutMs: options?.timeoutMs })
        return tryGit(dossier, args, options)
      }
    })

    wm.describeForLaunch('conv-1')

    const fetch = appels.find((appel) => appel.args[0] === 'fetch')
    expect(fetch, 'le fetch d’origine doit être tenté').toBeDefined()
    expect(fetch?.timeoutMs, 'le fetch doit avoir son propre délai').toBeDefined()
    expect(fetch?.timeoutMs).toBeLessThan(GIT_COMMAND_TIMEOUT_MS)
  })

  // Le repli est silencieux pour le run : sans trace, rien ne dit qu'il est parti d'une base locale.
  // fix-ok: cause mesurée — le repli ne laissait aucune trace (rouge : ENOENT sur .lancements.jsonl) ; une trace impossible à écrire n'était pas non plus rendue (rouge : aucune levée).
  it('un repli sur origin/main local laisse une ligne dans le journal des lancements', () => {
    const repo = tempRepo()
    const attendu = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    git(repo, 'update-ref', 'refs/remotes/origin/main', attendu)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-repli-trace-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    expect(wm.describeForLaunch('conv-repli')).toMatchObject({
      canonicalBaseRef: 'origin/main',
      sourceSha: attendu
    })
    const lignes = readFileSync(join(racine, JOURNAL_DES_LANCEMENTS), 'utf8')
      .trim()
      .split('\n')
      .map((ligne) => JSON.parse(ligne))
    expect(lignes).toEqual([
      expect.objectContaining({
        run: 'conv-repli',
        repli: 'origin/main',
        cause: expect.any(String)
      })
    ])
  })

  // Jumeau accepté : un origin qui répond à temps ne laisse AUCUNE trace de repli.
  it('un origin qui répond à temps ne laisse aucune ligne de repli', () => {
    const repo = tempRepo()
    const racineOrigine = mkdtempSync(join(tmpdir(), 'autowin-repli-origine-'))
    roots.push(racineOrigine)
    const origine = join(racineOrigine, 'origine.git')
    git(racineOrigine, 'init', '--bare', origine)
    git(repo, 'push', origine, 'HEAD:refs/heads/main')
    git(repo, 'remote', 'add', 'origin', origine)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-repli-ok-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    wm.describeForLaunch('conv-repli-ok')
    expect(existsSync(join(racine, JOURNAL_DES_LANCEMENTS))).toBe(false)
  })

  // Même règle que pour un retrait : une trace qui ne s'écrit pas bloque en le disant, sans être avalée.
  it('un journal de repli impossible à écrire bloque le lancement et le dit', () => {
    const repo = tempRepo()
    const attendu = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'add', 'origin', join(tmpdir(), 'depot-qui-nexiste-pas.git'))
    git(repo, 'update-ref', 'refs/remotes/origin/main', attendu)
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-repli-sans-trace-'))
    roots.push(dossier)
    // La racine des copies est un FICHIER : le journal ne peut pas s'y écrire.
    const racine = join(dossier, 'racine-fichier')
    writeFileSync(racine, 'pas un dossier')
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    expect(() => wm.describeForLaunch('conv-sans-trace')).toThrow(/trace du repli non écrite/)
  })

  it('un origin qui répond à temps rafraîchit origin/main : le fetch reste utile', () => {
    // Jumeau accepté du test précédent : le délai court ne doit pas faire perdre une base fraîche.
    const repo = tempRepo()
    const racineOrigine = mkdtempSync(join(tmpdir(), 'autowin-origine-'))
    roots.push(racineOrigine)
    const origine = join(racineOrigine, 'origine.git')
    git(racineOrigine, 'init', '--bare', origine)
    const premier = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'push', origine, 'HEAD:refs/heads/main')
    git(repo, 'commit', '--allow-empty', '-m', 'nouveau commit distant')
    const attendu = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'push', origine, 'HEAD:refs/heads/main')
    // Le dépôt local revient à l'ancien commit : seul le fetch peut amener le nouveau.
    git(repo, 'update-ref', 'HEAD', premier)
    git(repo, 'update-ref', 'refs/remotes/origin/main', premier)
    git(repo, 'remote', 'add', 'origin', origine)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-fetch-ok-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    expect(wm.describeForLaunch('conv-1')).toMatchObject({
      canonicalBaseRef: 'origin/main',
      sourceSha: attendu
    })
  })
})
