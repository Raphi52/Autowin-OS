import { describe, expect, it, afterEach, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

/**
 * Le passage commun de tout retrait de copie (`cleanupWorktree` et `cleanupWorktreeAsync`) : c'est
 * là que la garde du point de reprise et la trace (run, raison, heure) s'appliquent, quelle que soit
 * la sortie qui retire la copie. Cause mesurée le 2026-11-05 : le balayage horaire retirait la copie
 * propre et inactive d'un run dont le point de reprise vivait encore ; la reprise suivante ne
 * trouvait plus rien et concluait « copie durable absente ».
 */

const roots: string[] = []
const HEURE_MS = 60 * 60 * 1_000

afterEach(() => {
  for (const root of roots.splice(0)) supprimerArbre(root)
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-retrait-'))
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

function managerDecaleDeHeures(repo: string, heures: number): WorktreeManager {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-retrait-racine-'))
  roots.push(worktreeRoot)
  return new WorktreeManager({
    baseRepo: repo,
    worktreeRoot,
    nowFn: () => Date.now() + heures * HEURE_MS
  })
}

/** Le journal des retraits, ou une liste vide tant qu'aucun retrait n'a été tracé. */
function lireLeJournal(racine: string): Array<{ run?: string; raison?: string; quand?: string }> {
  const chemin = join(racine, '.retraits.jsonl')
  if (!existsSync(chemin)) return []
  return readFileSync(chemin, 'utf8')
    .trim()
    .split('\n')
    .map((ligne) => JSON.parse(ligne) as { run?: string; raison?: string; quand?: string })
}

// fix-ok: cleanupWorktree retirait des copies sans consulter leur point de reprise ; ces tests fixent chaque sortie (passage commun, disque, rafraîchissement).
describe('retrait d’une copie : garde du point de reprise au passage commun', () => {
  it('cleanupWorktree refuse de retirer la copie d’un run dont le point de reprise vit encore, et ne touche à rien', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-reprenable')
    wm.copiesProtegees = new Set(['run-reprenable'])

    const resultat = wm.cleanupWorktree(path)

    expect(resultat.ok).toBe(false)
    expect(resultat.detail).toContain('point de reprise')
    expect(existsSync(path)).toBe(true)
    expect(lireLeJournal(wm.worktreeRoot)).toEqual([])
  })

  it('cleanupWorktreeAsync refuse de retirer la copie d’un run dont le point de reprise vit encore, et ne touche à rien', async () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-reprenable')
    wm.copiesProtegees = new Set(['run-reprenable'])

    const resultat = await wm.cleanupWorktreeAsync(path)

    expect(resultat.ok).toBe(false)
    expect(resultat.detail).toContain('point de reprise')
    expect(existsSync(path)).toBe(true)
  })

  it('JUMEAU : cleanupWorktree retire la copie d’un run dont aucun point de reprise ne vit', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-sans-reprise')
    wm.copiesProtegees = new Set(['un-autre-run'])

    expect(wm.cleanupWorktree(path).ok).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('un retrait voulu, qui nomme son motif (passeOutre), retire la copie protégée et écrit sa raison', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-jete')
    wm.copiesProtegees = new Set(['run-jete'])

    const resultat = wm.cleanupWorktree(path, true, {
      raison: 'jeter le travail retenu',
      passeOutre: 'jeté sur demande explicite de l’utilisateur'
    })

    expect(resultat.ok).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(lireLeJournal(wm.worktreeRoot).map((l) => [l.run, l.raison])).toEqual([
      ['run-jete', 'jeter le travail retenu']
    ])
  })

  it('un retrait réussi écrit une ligne run, raison, heure, après la suppression', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-sterile')

    const resultat = wm.cleanupWorktree(path, true, { raison: 'balayage horaire' })

    expect(resultat.ok).toBe(true)
    const lignes = lireLeJournal(wm.worktreeRoot)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].run).toBe('run-sterile')
    expect(lignes[0].raison).toBe('balayage horaire')
    expect(Number.isNaN(Date.parse(lignes[0].quand ?? ''))).toBe(false)
  })

  it('un retrait refusé par la garde n’écrit aucune ligne dans le journal', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-garde')
    wm.copiesProtegees = new Set(['run-garde'])

    wm.cleanupWorktree(path, true, { raison: 'balayage horaire' })

    expect(lireLeJournal(wm.worktreeRoot)).toEqual([])
  })

  it('une trace qui ne s’écrit pas après un retrait réussi le dit, sans rendre la copie', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-trace-muette')
    mkdirSync(join(wm.worktreeRoot, '.retraits.jsonl'))

    const resultat = wm.cleanupWorktree(path, true, { raison: 'balayage horaire' })

    expect(existsSync(path)).toBe(false)
    expect(resultat.ok).toBe(true)
    expect(resultat.detail).toContain('trace')
  })

  // fix-ok: le balayage d'une copie propre dont la trace manque doit compter le blocage une seule fois ; conclureBalayageReussi le renotait (echecs = 2).
  it('le balayage d’une copie propre dont la trace manque compte le blocage une seule fois : la copie part, le blocage reste nommé', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-balayage-trace')
    mkdirSync(join(wm.worktreeRoot, '.retraits.jsonl'))

    expect(wm.balayerLeChemin(path)).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(wm.blocagesDeBalayage()).toEqual([
      expect.objectContaining({
        echecs: 1,
        detail: expect.stringContaining('trace du retrait non écrite')
      })
    ])
  })

  // fix-ok: cleanupWorktree et cleanupWorktreeAsync (worktree-manager-cycle.ts) ne notaient pas la trace manquante ; blocagesDeBalayage() restait vide après un retrait direct.
  it('un retrait réussi dont la trace manque reste un blocage nommé au passage commun, appel direct (forme synchrone), compté une fois', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-trace-nommee')
    mkdirSync(join(wm.worktreeRoot, '.retraits.jsonl'))

    expect(wm.cleanupWorktree(path, true, { raison: 'quarantaine' }).ok).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(wm.blocagesDeBalayage()).toEqual([
      expect.objectContaining({
        echecs: 1,
        detail: expect.stringContaining('trace du retrait non écrite')
      })
    ])
  })

  it('un retrait réussi dont la trace manque reste un blocage nommé au passage commun, appel direct (forme asynchrone), compté une fois', async () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-trace-nommee-async')
    mkdirSync(join(wm.worktreeRoot, '.retraits.jsonl'))

    expect((await wm.cleanupWorktreeAsync(path, true, { raison: 'quarantaine' })).ok).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(wm.blocagesDeBalayage()).toEqual([
      expect.objectContaining({
        echecs: 1,
        detail: expect.stringContaining('trace du retrait non écrite')
      })
    ])
  })

  it('REJEU du refus du 2026-11-05 (run-50caa90a3e22-1) : copie propre, inactive depuis 4 h, point de reprise vivant → le balayage horaire la garde', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 4)
    const path = wm.acquire('run-50caa90a3e22-1')
    wm.copiesProtegees = new Set(['run-50caa90a3e22-1'])

    expect(wm.reconcileResidues().swept ?? []).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('le retrait par le disque (repli du balayage) ne contourne pas la garde : la copie reste, le détail le dit', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-repli-disque')
    wm.copiesProtegees = new Set(['run-repli-disque'])

    expect(wm.tenterRetraitDisque(path)).toContain('point de reprise')
    expect(existsSync(path)).toBe(true)
  })

  it('un retrait voulu (passeOutre) dont git échoue passe au repli disque : la copie protégée part, et la trace est écrite', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-jete-disque')
    wm.copiesProtegees = new Set(['run-jete-disque'])
    // git ne reconnaît plus cette copie : son retrait par git échoue, le repli disque prend le relais.
    rmSync(join(path, '.git'))

    const resultat = wm.cleanupWorktree(path, true, {
      raison: 'jeter le travail retenu',
      passeOutre: 'jeté sur demande explicite de l’utilisateur'
    })

    expect(resultat.ok).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(lireLeJournal(wm.worktreeRoot).map((l) => [l.run, l.raison])).toEqual([
      ['run-jete-disque', 'jeter le travail retenu']
    ])
  })

  it('un retrait voulu (passeOutre) dont git échoue passe au repli disque en forme asynchrone : la copie protégée part, et la trace est écrite', async () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-jete-disque-async')
    wm.copiesProtegees = new Set(['run-jete-disque-async'])
    rmSync(join(path, '.git'))

    const resultat = await wm.cleanupWorktreeAsync(path, true, {
      raison: 'jeter le travail retenu',
      passeOutre: 'jeté sur demande explicite de l’utilisateur'
    })

    expect(resultat.ok).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(lireLeJournal(wm.worktreeRoot).map((l) => [l.run, l.raison])).toEqual([
      ['run-jete-disque-async', 'jeter le travail retenu']
    ])
  })

  it('acquire : une copie créée dont la révision ne correspond pas à la capturée est retirée malgré un point de reprise vivant (passeOutre du site acquire)', () => {
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 0)
    // Un objet d'étiquette annotée n'est pas un commit : git crée la copie sur ce commit, HEAD ne vaut
    // plus la révision capturée (c'est le seul cas où la comparaison de acquire échoue).
    git(repo, 'tag', '-a', 'etiquette-annotee', '-m', 'etiquette')
    const etiquette = git(repo, 'rev-parse', 'etiquette-annotee')
    const path = wm.pathFor('run-non-conforme')
    wm.copiesProtegees = new Set(['run-non-conforme'])
    const contexte = {
      workspacePath: repo,
      worktreePath: path,
      baseBranch: 'main',
      baseSha: git(repo, 'rev-parse', 'HEAD'),
      sourceSha: etiquette
    } as unknown as Parameters<WorktreeManager['acquire']>[1]

    expect(() => wm.acquire('run-non-conforme', contexte)).toThrow('ne correspond pas')
    expect(existsSync(path)).toBe(false)
  })

  it('un rafraîchissement sur base périmée passe outre la garde : la copie propre est recréée sur la base à jour', () => {
    const repo = tempRepo()
    const wm = managerDecaleDeHeures(repo, 0)
    const path = wm.acquire('run-rafraichi')
    wm.copiesProtegees = new Set(['run-rafraichi'])
    writeFileSync(join(repo, 'b.txt'), 'nouveau\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance la base')
    const tete = git(repo, 'rev-parse', 'HEAD')

    // Le run attend désormais la base avancée : la copie propre, ancienne, ne la descend pas.
    const contexte = {
      workspacePath: repo,
      worktreePath: path,
      baseBranch: 'main',
      baseSha: tete,
      sourceSha: tete
    } as unknown as Parameters<WorktreeManager['acquire']>[1]

    expect(wm.acquire('run-rafraichi', contexte)).toBe(path)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(tete)
  })

  // fix-ok: discard (worktree-manager-finalisation.ts, passeOutre) n'était couvert par aucun test ; sans son passeOutre la suite restait verte.
  it('discard (jeter le travail retenu) retire une copie protégée par un point de reprise vivant, et écrit sa trace', () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-jete-protege')
    wm.copiesProtegees = new Set(['run-jete-protege'])

    wm.discard('run-jete-protege')

    expect(existsSync(path)).toBe(false)
    expect(lireLeJournal(wm.worktreeRoot).map((l) => [l.run, l.raison])).toEqual([
      ['run-jete-protege', 'jeter le travail retenu']
    ])
  })

  it('discard d’une copie que git et le disque refusent de retirer lève l’erreur, garde la copie et n’écrit aucune trace', () => {
    const repo = tempRepo()
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-retrait-racine-'))
    roots.push(worktreeRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot,
      nowFn: () => Date.now(),
      removeDirFn: () => {
        throw new Error('dossier verrouillé par un autre processus')
      }
    })
    const path = wm.acquire('run-jete-refuse')
    wm.copiesProtegees = new Set(['run-jete-refuse'])
    // Copie verrouillée : `git worktree remove --force` refuse, et le repli disque refuse aussi.
    git(repo, 'worktree', 'lock', path)

    expect(() => wm.discard('run-jete-refuse')).toThrow('dossier verrouillé par un autre processus')
    expect(existsSync(path)).toBe(true)
    expect(lireLeJournal(wm.worktreeRoot)).toEqual([])
  })

  // fix-ok: la garde du repli disque asynchrone (worktree-manager-copies.ts, tenterRetraitDisqueAsync) n'était couverte par aucun test.
  it('le retrait par le disque en forme asynchrone (repli du balayage) ne contourne pas la garde : la copie reste, le détail le dit', async () => {
    const wm = managerDecaleDeHeures(tempRepo(), 0)
    const path = wm.acquire('run-repli-disque-async')
    wm.copiesProtegees = new Set(['run-repli-disque-async'])

    expect(await wm.tenterRetraitDisqueAsync(path)).toContain('point de reprise')
    expect(existsSync(path)).toBe(true)
  })
})
