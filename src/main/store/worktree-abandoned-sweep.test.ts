import { describe, expect, it, afterEach, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

/**
 * Cause racine mesurée le 2026-08-05 : la finalisation ne supprime la copie agent que sur le chemin
 * `merged`. Tout run terminé sans publication (échec, abandon, crash) laissait donc un worktree
 * définitif — 811 accumulés sur le dépôt Autowin OS, `git worktree list` passé de 65 ms à un timeout
 * de 2 min. Ces tests fixent la frontière : la copie STÉRILE part, la copie qui porte quoi que ce
 * soit de récupérable reste.
 */

const roots: string[] = []
const DAY_MS = 24 * 60 * 60 * 1_000

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-sweep-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** `aged` décale l'horloge du manager : la copie devient plus vieille que la fenêtre de spawn. */
function manager(repo: string, aged: boolean): WorktreeManager {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-sweeproot-'))
  roots.push(worktreeRoot)
  return new WorktreeManager({
    baseRepo: repo,
    worktreeRoot,
    nowFn: () => Date.now() + (aged ? 2 * DAY_MS : 0)
  })
}

/** Horloge decalee de N heures : permet de viser la fenetre 3 h - 24 h, invisible avec `aged`. */
function managerDecaleDeHeures(repo: string, heures: number): WorktreeManager {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-sweeproot-'))
  roots.push(worktreeRoot)
  return new WorktreeManager({
    baseRepo: repo,
    worktreeRoot,
    nowFn: () => Date.now() + heures * 60 * 60 * 1_000
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('balayage des copies agent abandonnées', () => {
  it('supprime une copie abandonnée qui ne porte aucun travail récupérable', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-sterile')

    expect(wm.reconcileResidues().swept).toEqual(['run-sterile'])
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree', 'list')).not.toContain('run-sterile')
  })

  it('PRÉSERVE les fichiers non publiés dans une référence, puis libère la copie', () => {
    /*
      Prolongement de la frontière posée ici le 2026-08-05, pas son abandon.

      Le correctif d'alors — « la copie stérile part, celle qui porte du travail reste » — a supprimé
      l'accumulation des copies VIDES. Il laissait ouvert le cas des copies PORTEUSES : personne ne
      viendrait jamais publier le travail d'un run mort, donc leur conservation était définitive.
      Mesuré le 2026-08-14 sur l'installation de l'utilisateur : 1 453 Mo de copies pour 665 Ko de
      travail unique — deux mégaoctets par kilooctet utile.

      Le travail est désormais committé sur `autowin/recovery/<id>` AVANT la libération : il n'est
      plus seulement conservé, il est SAUVEGARDÉ dans le dépôt, restaurable par `git worktree add`,
      et il cesse d'occuper un checkout complet. La garantie « on ne perd jamais un travail qui
      n'existe nulle part ailleurs » est tenue plus fort qu'avant — avant, ce travail n'existait que
      dans un dossier que rien ne sauvegardait.
    */
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-dirty')
    writeFileSync(join(path, 'travail.txt'), 'non publié\n')

    expect(wm.reconcileResidues().swept).toEqual(['run-dirty'])
    expect(existsSync(path)).toBe(false)
    // La preuve qui compte : le contenu est relisible depuis le dépôt de base.
    expect(git(repo, 'show', 'autowin/recovery/run-dirty:travail.txt')).toBe('non publié')
  })

  it('RATTACHE un commit qu’aucune référence ne retient, puis libère la copie', () => {
    /*
      Dernier prolongement de la frontière posée ici le 2026-08-05, décidé par l'utilisateur le
      2026-08-14 sur chiffres. Après que la préservation du travail non committé ait rendu 971 Mo
      (49 copies → 18), les 18 restantes étaient 10 copies protégées par l'âge et 8 qui étaient
      TOUTES ce cas — `refs=0`, `sales=0`, 185 à 213 h d'âge, pour 216 Mo.

      Le refus d'y toucher était juste — supprimer la copie perdrait un commit que rien ne retient —
      mais sans issue : rien ne viendrait jamais rattacher le commit d'un run mort. On attache donc
      une référence au commit EXISTANT (aucun commit n'est créé), et il devient récupérable par
      `git worktree add` au lieu d'occuper un checkout complet.
    */
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-commit')
    writeFileSync(join(path, 'travail.txt'), 'commité mais jamais publié\n')
    git(path, 'add', 'travail.txt')
    git(path, 'commit', '-q', '-m', 'travail agent')
    const sha = git(path, 'rev-parse', 'HEAD')

    expect(wm.reconcileResidues().swept).toEqual(['run-commit'])
    expect(existsSync(path)).toBe(false)
    // Le commit EXACT survit — pas une copie de son contenu, le même objet.
    expect(git(repo, 'rev-parse', 'autowin/recovery/run-commit')).toBe(sha)
    expect(git(repo, 'show', 'autowin/recovery/run-commit:travail.txt')).toBe(
      'commité mais jamais publié'
    )
  })

  it('conserve une copie récente : un run vivant sans lease encore posé', () => {
    const repo = tempRepo()
    const wm = manager(repo, false)
    const path = wm.acquire('run-jeune')

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })

  it('conserve une copie abandonnée mais encore tenue par un processus vivant', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-tenu')
    wm.markProcess('run-tenu', process.pid, true)

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })
})

describe("l'usine a copies abandonnees : une copie SANS ENJEU n'attend plus 24 h", () => {
  /*
    Mesure du 20/08 sur l'installation de l'utilisateur : 25 copies pour 670 Mo, dont 14 propres et
    entierement contenues dans `main` — donc sans le moindre enjeu. AUCUNE n'etait ramassable : creees
    entre 07:57 et 19:01, toutes avaient moins de 24 h. Une journee de travail produit une copie par
    `edit_file` (~33 Mo), et le seul mecanisme capable de les rendre refusait de les regarder avant le
    lendemain. L'utilisateur l'a nomme : « une usine a worktrees abandonnes ».
  */
  it('une copie sterile de 4 h part, la ou elle attendait le lendemain', () => {
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 4)
    const path = wm.acquire('run-sterile-4h')

    expect(wm.reconcileResidues().swept).toEqual(['run-sterile-4h'])
    expect(existsSync(path)).toBe(false)
  })

  it('en dessous du plancher de 3 h, elle reste — la fenetre de spawn est protegee', () => {
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 2)
    const path = wm.acquire('run-jeune')

    expect(wm.reconcileResidues().swept ?? []).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('une copie qui RETIENT du travail garde la marge de 24 h, inchangee', () => {
    // La garantie qui compte : accelerer le residu ne doit rien accelerer d'autre.
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 4)
    const path = wm.acquire('run-porteur')
    writeFileSync(join(path, 'travail-unique.txt'), 'ce que personne ne sauvegarde', 'utf8')

    expect(wm.reconcileResidues().swept ?? []).toEqual([])
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(join(path, 'travail-unique.txt'), 'utf8')).toContain('personne')
  })

  it('passe 24 h, la copie porteuse est preservee puis liberee — comportement d origine', () => {
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 30)
    const path = wm.acquire('run-porteur-vieux')
    writeFileSync(join(path, 'travail-unique.txt'), 'a sauvegarder', 'utf8')

    expect(wm.reconcileResidues().swept).toEqual(['run-porteur-vieux'])
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'branch', '--list', 'autowin/recovery/run-porteur-vieux')).toContain(
      'recovery'
    )
  })
})
