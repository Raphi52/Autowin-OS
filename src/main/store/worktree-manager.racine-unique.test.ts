import { afterEach, describe, expect, it } from 'vitest'

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { decisionPourLaCopie } from '../conversations/menage-des-copies-de-fil'
import { WorktreeManager } from './worktree-manager'
import { WorktreeRunStateStore, type WorktreeRunRecord } from './worktree-run-state'
import { git, nettoyerRacines, roots, tempRepo } from './worktree-manager.test-helpers'

// fix-ok: le gestionnaire crée la copie d'agent sous la racine unique quand l'option est posée, le store relit un chemin ancien tel quel, et le ménage des fils ignore les copies d'agent.

afterEach(nettoyerRacines)

const JOUR_MS = 24 * 3_600_000

/** Un dossier de données témoin : tout ce qui vit sous `.autowin-data` y est recréé à neuf. */
function dossierTemoin(): string {
  const dossier = mkdtempSync(join(tmpdir(), 'autowin-racine-'))
  roots.push(dossier)
  return dossier
}

function enregistrement(runId: string, worktreePath: string): WorktreeRunRecord {
  return {
    version: 1,
    repoId: 'depot-temoin',
    runId,
    agentName: 'Metier',
    worktreePath,
    baseBranch: 'main',
    baseSha: 'a'.repeat(40),
    verdict: 'running',
    publication: 'not-requested',
    files: [],
    createdAtMs: 1,
    updatedAtMs: 2
  }
}

describe('racine unique des copies d’agent', () => {
  it('une nouvelle copie d’agent ouverte par le store vit sous copies-de-taches/<tâche>', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const wtRoot = join(donnees, 'worktrees', 'depot-temoin')
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      racineCopiesDeTaches: racine
    })

    const chemin = wm.acquire('run-metier-1')

    expect(chemin).toBe(join(racine, 'run-metier-1'))
    expect(existsSync(join(racine, 'run-metier-1', 'a.txt'))).toBe(true)
    expect(existsSync(join(wtRoot, 'agent__run-metier-1'))).toBe(false)
  })

  it('une copie créée avant l’option se reprend sous son ancien nom et se publie toujours', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const wtRoot = join(donnees, 'worktrees', 'depot-temoin')
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      racineCopiesDeTaches: racineDesCopiesDeTaches(donnees)
    })
    // L'état d'avant : la copie est sous l'ancien nom. Git la déplace et met à jour son lien.
    const neuve = wm.acquire('run-metier-2')
    const ancienneCopie = join(wtRoot, 'agent__run-metier-2')
    mkdirSync(wtRoot, { recursive: true })
    git(repo, 'worktree', 'move', neuve, ancienneCopie)
    writeFileSync(join(ancienneCopie, 'a.txt'), 'travail de la copie ancienne\n')

    expect(wm.pathFor('run-metier-2')).toBe(ancienneCopie)
    expect(wm.acquire('run-metier-2')).toBe(ancienneCopie)
    expect(wm.finalize('run-metier-2').outcome).toBe('merged')
    // Git Windows rend les fins de ligne en CRLF : on compare le texte, pas l'octet de fin de ligne.
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'travail de la copie ancienne\n'
    )
  })

  it('la liste des copies d’agent voit celles de la racine unique, sans y prendre une copie de fil', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine
    })
    // fix-ok: la racine unique est partagée : une copie n'est listée que si son lien git désigne ce dépôt, donc la copie d'un autre dépôt n'y apparaît pas.
    wm.acquire('run-metier-3')
    // Une copie de fil posée à la main : elle ne doit jamais être listée comme copie d'agent.
    mkdirSync(join(racine, 'conv-metier-3'), { recursive: true })

    const ids = wm.listAgentIds()

    expect(ids).toContain('run-metier-3')
    expect(ids).not.toContain('conv-metier-3')
  })

  it('le store lit une écriture ancienne, refuse une copie neuve sous l’ancienne racine, accepte la racine unique', () => {
    const donnees = dossierTemoin()
    const wtRoot = join(donnees, 'worktrees', 'depot-temoin')
    mkdirSync(wtRoot, { recursive: true })
    const racine = racineDesCopiesDeTaches(donnees)
    const ancienChemin = join(wtRoot, 'agent__run-metier-4')
    mkdirSync(join(wtRoot, '.runs'), { recursive: true })
    new WorktreeRunStateStore(wtRoot, 'depot-temoin').save(
      enregistrement('run-metier-4', ancienChemin)
    )

    const store = new WorktreeRunStateStore(wtRoot, 'depot-temoin', {
      racineCopiesDeTaches: racine
    })

    expect(store.get('run-metier-4')?.worktreePath).toBe(ancienChemin)
    expect(() => store.save(enregistrement('run-metier-4', ancienChemin))).not.toThrow()
    expect(() =>
      store.save(enregistrement('run-metier-5', join(wtRoot, 'agent__run-metier-5')))
    ).toThrow()
    expect(() =>
      store.save(enregistrement('run-metier-6', join(racine, 'run-metier-6')))
    ).not.toThrow()
  })

  it('le HEAD d’une copie neuve de la racine unique est recensé, comme celui d’une copie d’avant', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racineDesCopiesDeTaches(donnees)
    })
    const copie = wm.acquire('run-metier-9')
    writeFileSync(join(copie, 'a.txt'), 'travail committé dans la copie\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'travail de la copie')
    const tete = git(copie, 'rev-parse', 'HEAD')

    expect(wm.headsDesBureaux().get('run-metier-9')).toBe(tete)
  })

  it('le ménage des fils ne retire pas une copie d’agent vieille et sans fil, rangée dans la racine unique', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const copieAgent = join(racine, 'run-metier-7')
    mkdirSync(copieAgent, { recursive: true })

    const decision = decisionPourLaCopie({
      copie: copieAgent,
      fils: [],
      tourEnCours: () => false,
      maintenant: Date.now(),
      ouverteA: Date.now() - 30 * JOUR_MS
    })

    expect(decision.supprimer).toBe(false)
  })

  it('jumeau accepté : une copie de fil vieille et sans fil reste retirable par le ménage', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const copieDeFil = join(racine, 'conv-metier-8')
    mkdirSync(copieDeFil, { recursive: true })

    const decision = decisionPourLaCopie({
      copie: copieDeFil,
      fils: [],
      tourEnCours: () => false,
      maintenant: Date.now(),
      ouverteA: Date.now() - 30 * JOUR_MS
    })

    expect(decision.supprimer).toBe(true)
  })

  it('le balayage des copies abandonnées retire une copie neuve stérile, et laisse une copie de fil', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine,
      nowFn: () => Date.now() + 2 * JOUR_MS
    })
    const copie = wm.acquire('run-abandon-1')
    mkdirSync(join(racine, 'conv-garde-1'), { recursive: true })

    expect(wm.sweepAbandonedAgentCopies()).toEqual(['run-abandon-1'])
    expect(existsSync(copie)).toBe(false)
    expect(existsSync(join(racine, 'conv-garde-1'))).toBe(true)
  })

  it('la note d’un retrait de copie neuve est écrite, pour qu’un retrait coupé se reprenne', () => {
    const repo = tempRepo()
    const donnees = dossierTemoin()
    const wtRoot = join(donnees, 'worktrees', 'depot-temoin')
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      racineCopiesDeTaches: racineDesCopiesDeTaches(donnees)
    })
    const copie = wm.acquire('run-retrait-1')

    expect(wm.noterSuppressionCommencee(copie)).toBe(true)
    expect(existsSync(join(wtRoot, '.a-supprimer', 'run-retrait-1.json'))).toBe(true)
  })

  it('le balayage des coquilles vides vide la racine unique, sans toucher à une copie de fil', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const wm = new WorktreeManager({
      baseRepo: tempRepo(),
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine
    })
    // La coquille est une vraie copie de ce dépôt, dont on a retiré les fichiers : son lien `.git` la désigne.
    const coquille = wm.acquire('run-coquille-1')
    for (const entree of readdirSync(coquille)) {
      if (entree !== '.git') rmSync(join(coquille, entree), { recursive: true, force: true })
    }
    mkdirSync(join(racine, 'conv-coquille-1'), { recursive: true })

    expect(wm.balayerLesCoquilles()).toEqual(['run-coquille-1'])
    expect(existsSync(join(racine, 'run-coquille-1'))).toBe(false)
    expect(existsSync(join(racine, 'conv-coquille-1'))).toBe(true)
  })

  it('une copie d’avant qui existe encore, sans manifeste, reçoit son premier manifeste sous la racine active', () => {
    const donnees = dossierTemoin()
    const wtRoot = join(donnees, 'worktrees', 'depot-temoin')
    // Création coupée : le dossier est là, le manifeste n'a jamais été écrit.
    const copieAncienne = join(wtRoot, 'agent__run-metier-10')
    mkdirSync(copieAncienne, { recursive: true })
    mkdirSync(join(wtRoot, '.runs'), { recursive: true })
    const store = new WorktreeRunStateStore(wtRoot, 'depot-temoin', {
      racineCopiesDeTaches: racineDesCopiesDeTaches(donnees)
    })

    expect(() => store.save(enregistrement('run-metier-10', copieAncienne))).not.toThrow()
    expect(store.get('run-metier-10')?.worktreePath).toBe(copieAncienne)
  })

  it('refuse à la création un identifiant de plus de 128 caractères, et accepte exactement 128', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    const wm = new WorktreeManager({
      baseRepo: tempRepo(),
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine
    })

    expect(() => wm.acquire('r'.repeat(129))).toThrow(/Identifiant de copie refusé/)
    expect(existsSync(join(racine, 'r'.repeat(129)))).toBe(false)
    expect(wm.acquire('r'.repeat(128))).toBe(join(racine, 'r'.repeat(128)))
  })

  it('refuse de naître sans racine unique : aucune copie d’agent ne part sous agent__', () => {
    const donnees = dossierTemoin()
    expect(
      () =>
        new WorktreeManager({
          baseRepo: tempRepo(),
          worktreeRoot: join(donnees, 'worktrees', 'depot-temoin')
        } as never)
    ).toThrow(/racine unique/)
  })

  it('le balayage des coquilles ne touche pas une coquille d’un AUTRE dépôt posée sous la racine unique', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    mkdirSync(racine, { recursive: true })
    const autre = tempRepo()
    writeFileSync(join(autre, 'b.txt'), 'travail de l’autre dépôt\n')
    git(autre, 'add', '-A')
    git(autre, 'commit', '-q', '-m', 'autre dépôt')
    const coquille = join(racine, 'run-autre-1')
    git(autre, 'worktree', 'add', '--detach', coquille, 'HEAD')
    for (const entree of readdirSync(coquille)) {
      if (entree !== '.git') rmSync(join(coquille, entree), { recursive: true, force: true })
    }
    const wm = new WorktreeManager({
      baseRepo: tempRepo(),
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine
    })

    expect(wm.balayerLesCoquilles()).not.toContain('run-autre-1')
    expect(existsSync(coquille)).toBe(true)
  })

  it('la liste des copies d’un dépôt ne rend pas la copie d’un autre dépôt posée sous la racine unique', () => {
    const donnees = dossierTemoin()
    const racine = racineDesCopiesDeTaches(donnees)
    mkdirSync(racine, { recursive: true })
    const autre = tempRepo()
    git(autre, 'worktree', 'add', '--detach', join(racine, 'run-autre-2'), 'HEAD')
    const wm = new WorktreeManager({
      baseRepo: tempRepo(),
      worktreeRoot: join(donnees, 'worktrees', 'depot-temoin'),
      racineCopiesDeTaches: racine
    })

    expect(wm.listAgentIds()).not.toContain('run-autre-2')
  })
})
