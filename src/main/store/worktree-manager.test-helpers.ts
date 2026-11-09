/**
 * Utilitaires partagés des suites `worktree-manager.*.test.ts`.
 *
 * Ces tests jouent contre de VRAIS dépôts git en tmp (init, worktree, merge). MESURÉ sur cette machine :
 * la suite unique d'origine tenait 81 tests dans un seul fichier et mettait 623 s — elle passait, mais
 * personne ne l'exécutait. Vitest parallélise entre FICHIERS et non à l'intérieur d'un fichier, donc le
 * découpage en quatre suites est ce qui rend le temps acceptable, sans toucher une seule assertion.
 *
 * La concurrence DANS un fichier n'était pas une option : `roots` est partagé et le nettoyage supprime
 * toutes ses entrées, donc deux tests simultanés s'effaceraient mutuellement leurs dossiers.
 */
import { expect } from 'vitest'

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { supprimerArbre } from '../fichiers/fs-supprimer'

/** Les dossiers temporaires à supprimer après chaque test. Certains tests en enregistrent eux-mêmes. */
export const roots: string[] = []

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

export function installCompensationIndexOwner(repo: string, serialized: string): string {
  const object = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo,
    encoding: 'utf8',
    input: serialized
  })
  expect(object.status).toBe(0)
  const oid = object.stdout.trim()
  git(repo, 'update-ref', 'refs/autowin/locks/index', oid)
  writeFileSync(join(repo, '.git', 'index.lock'), serialized)
  return oid
}

export type CompensationIndexLockProbe = {
  acquireCompensationIndexLock():
    | {
        path: string
        serialized: string
        ownershipRef: string
        ownershipOid: string
        token: string
      }
    | undefined
  releaseCompensationIndexLock(lock: {
    path: string
    serialized: string
    ownershipRef: string
    ownershipOid: string
    token: string
  }): void
}

export function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-wm-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\nligne2\nligne3\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/**
 * La racine unique d'un gestionnaire de test : un dossier FRÈRE de son dossier d'avant, et non un enfant,
 * pour que ses copies n'apparaissent pas dans la liste de ce dossier. Deux gestionnaires qui partagent un
 * dossier d'avant partagent cette racine, comme en production. Le chemin ne crée rien : git ouvre les
 * dossiers qu'il faut, et seul un chemin sous le dossier temporaire est nettoyé après le test.
 */
export function racineDe(worktreeRoot: string): string {
  const racine = `${worktreeRoot}-copies-de-taches`
  // fix-ok: racineDe ne crée aucun dossier, donc un chemin fictif (`C:/…`) ne touche pas le disque ; le test `worktree-manager.fabrique-worker.test.ts` espionne `mkdirSync` et échoue si ce helper en crée un.
  if (resolve(worktreeRoot).startsWith(resolve(tmpdir())) && !roots.includes(racine)) {
    roots.push(racine)
  }
  return racine
}

export function manager(repo: string): WorktreeManager {
  const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
  roots.push(wtRoot)
  return new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: wtRoot,
    racineCopiesDeTaches: racineDe(wtRoot)
  })
}

export function detachedCommit(
  repo: string,
  startSha: string,
  file: string,
  content: string
): string {
  const holder = mkdtempSync(join(tmpdir(), 'autowin-late-'))
  roots.push(holder)
  const path = join(holder, 'worktree')
  git(repo, 'worktree', 'add', '--detach', path, startSha)
  writeFileSync(join(path, file), content)
  git(path, 'add', file)
  git(path, 'commit', '-q', '-m', `late ${file}`)
  const sha = git(path, 'rev-parse', 'HEAD')
  git(repo, 'worktree', 'remove', '--force', path)
  return sha
}

/** Nettoyage commun : chaque suite l'appelle dans son `afterEach`. */
export function nettoyerRacines(): void {
  for (const d of roots.splice(0)) supprimerArbre(d)
}
