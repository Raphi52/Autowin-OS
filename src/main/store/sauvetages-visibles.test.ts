import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE TROU, mesuré le 2026-08-26 sur le dépôt réel.
 *
 * Quand la publication d'un bureau échoue, `WorktreeManager` fait ce qu'il faut : il pose le travail
 * sur `refs/autowin/rescue/<agentId>` pour qu'il reste ATTEIGNABLE même après disparition du bureau.
 * Mais le recensement, lui, ne regarde que `refs/heads/autowin/recovery/*` et les dossiers de bureaux
 * encore présents. Un travail sauvé mais dont le bureau a été supprimé n'est donc recensé NULLE PART :
 * ni bandeau, ni panneau Worktrees, ni aperçu. Il n'existe que dans un message de chat émis à
 * l'instant de l'échec, qui disparaît dans le défilement.
 *
 * Constat qui rend le trou tangible : douze `refs/autowin/rescue/*` accumulées depuis le 16/08 sur ce
 * dépôt, dont trois du jour même — jamais consultées. Une adresse que personne ne sait lire n'est pas
 * une sauvegarde, c'est un oubli bien rangé.
 *
 * LES DEUX BORDS COMPTENT, comme pour le bandeau : ne jamais taire un travail réellement perdu, et ne
 * jamais crier sur un travail déjà repris — un bandeau qu'on n'écoute plus ne protège personne.
 */
afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Un verrou Windows sur un dossier de test ne doit pas faire échouer la suite.
    }
  }
})

const monter = (): { repo: string; wm: WorktreeManager } => {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-sauvetage-'))
  roots.push(racine)
  return { repo, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }) }
}

/**
 * Un travail sauvé dont le BUREAU N'EXISTE PLUS — le cas réel : la copie est supprimée, et seule la
 * ref de sauvetage rattache encore le commit au dépôt.
 */
const sauvetage = (repo: string, agentId: string, fichier: string, contenu: string): string => {
  const chemin = join(mkdtempSync(join(tmpdir(), 'autowin-sv-')), 'copie')
  roots.push(chemin)
  git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
  writeFileSync(join(chemin, fichier), contenu)
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `travail de ${agentId}`)
  const sha = git(chemin, 'rev-parse', 'HEAD')
  git(repo, 'update-ref', `refs/autowin/rescue/${agentId}`, sha)
  execFileSync('git', ['worktree', 'remove', '--force', chemin], { cwd: repo })
  return sha
}

describe('un travail SAUVÉ reste recensé, même quand son bureau a disparu', () => {
  it('SIGNALE un sauvetage qui apporte du travail que la base n’a pas', () => {
    const { repo, wm } = monter()
    sauvetage(repo, 'run-sauve', 'apport.txt', 'du vrai travail\n')

    expect(wm.travauxNonPublies()).toContain('run-sauve')
  })

  it('SE TAIT quand le contenu du sauvetage a déjà été repris dans la base', () => {
    // Le bord symétrique : sur ce dépôt, l’un des trois sauvetages du jour était DÉJÀ dans `main`.
    // Le signaler quand même, c’est fabriquer le bandeau qu’on finit par ignorer.
    const { repo, wm } = monter()
    const sha = sauvetage(repo, 'run-repris', 'apport.txt', 'du vrai travail\n')
    git(repo, 'cherry-pick', sha)

    expect(wm.travauxNonPublies()).not.toContain('run-repris')
  })

  it('nomme les FICHIERS du sauvetage, pas son identifiant', () => {
    // Un humain reconnaît « apport.txt » ; « run-sauve », non. Même parti pris que l’aperçu existant.
    const { repo, wm } = monter()
    sauvetage(repo, 'run-lisible', 'apport.txt', 'du vrai travail\n')

    const apercu = wm.apercuTravauxNonPublies()
    const trouve = apercu.find((t) => t.agentId === 'run-lisible')
    expect(trouve).toBeDefined()
    expect(trouve!.fichiers).toContain('apport.txt')
  })

  it('recense ENSEMBLE un sauvetage et une branche de secours', () => {
    // Les deux mécanismes coexistent sur le dépôt réel : en voir un seul, c’est en perdre l’autre.
    const { repo, wm } = monter()
    sauvetage(repo, 'run-sauve', 'a.txt', 'travail A\n')
    const depart = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', 'autowin/recovery/run-branche', depart)
    const wt = join(mkdtempSync(join(tmpdir(), 'autowin-br-')), 'copie')
    roots.push(wt)
    git(repo, 'worktree', 'add', '-q', wt, 'autowin/recovery/run-branche')
    writeFileSync(join(wt, 'b.txt'), 'travail B\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-q', '-m', 'travail de run-branche')
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo })

    const signales = wm.travauxNonPublies()

    expect(signales).toContain('run-sauve')
    expect(signales).toContain('run-branche')
  })
})

/**
 * LE TROISIÈME CAS, reproduit EN DIRECT le 2026-08-26 sur une demande réelle.
 *
 * Une demande « améliore les widgets de l'accueil » a produit un vrai livrable — `HomeView.css`
 * modifié (+7/−3) et un test neuf — puis l'orchestration s'est arrêtée au contrôle final. L'agent a
 * répondu « le livrable est en place et vert », avec preuves et contre-épreuve. Le travail n'a
 * JAMAIS été committé : il dormait, modifié, dans son bureau.
 *
 * Or tout le recensement juge sur des COMMITS — branche de secours, commit orphelin, ref de
 * sauvetage. Un bureau dont l'arbre est simplement SALE ne porte aucun commit, donc il n'apparaît
 * nulle part : ni bandeau, ni panneau. Vérifié sur le dépôt réel, ce bureau-là rendait
 * `travauxNonPublies() → false` alors qu'il portait le travail que l'utilisateur croyait publié.
 *
 * C'est le cas le plus coûteux des trois, parce que l'agent vient d'annoncer que c'était fait.
 */
describe('un bureau au travail NON COMMITTÉ est du travail non publié, lui aussi', () => {
  /** Un bureau vivant dont l'arbre porte des modifications jamais committées. */
  const bureauSale = (repo: string, racine: string, agentId: string, fichier: string): void => {
    const chemin = join(racine, `agent__${agentId}`)
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    writeFileSync(join(chemin, fichier), 'du travail jamais committe\n')
  }

  it('SIGNALE un bureau dont l’arbre est sale, sans exiger de commit', () => {
    const { repo, wm } = monter()
    const racine = (wm as unknown as { worktreeRoot: string }).worktreeRoot
    bureauSale(repo, racine, 'run-non-committe', 'apport.txt')

    expect(wm.travauxNonPublies()).toContain('run-non-committe')
  })

  it('nomme les FICHIERS d’un bureau non committé — sinon le bandeau dit « perdu » sans dire quoi', () => {
    // Constaté le 2026-08-26 : trois bureaux recensés, trois fois `fichiers: []`. Un avertissement
    // qui ne nomme rien oblige à ouvrir chaque copie à la main — le tri que ce bandeau supprime.
    const { repo, wm } = monter()
    const racine = (wm as unknown as { worktreeRoot: string }).worktreeRoot
    bureauSale(repo, racine, 'run-nomme', 'apport.txt')

    const trouve = wm.apercuTravauxNonPublies('HEAD', 8).find((t) => t.agentId === 'run-nomme')

    expect(trouve).toBeDefined()
    expect(trouve!.fichiers).toContain('apport.txt')
    // Des fichiers RÉELLEMENT lus : ce n'est plus une lecture ratée déguisée en liste vide.
    expect(trouve!.lectureEchouee).toBeFalsy()
  })

  it('SE TAIT sur un bureau propre — sinon chaque bureau ouvert crierait', () => {
    // Le bord symétrique : un bureau simplement ouvert n'a rien produit. Le signaler, c'est
    // fabriquer le bandeau qu'on n'écoute plus — le défaut du 2026-08-24, déjà payé une fois.
    const { repo, wm } = monter()
    const racine = (wm as unknown as { worktreeRoot: string }).worktreeRoot
    git(repo, 'worktree', 'add', '-q', '--detach', join(racine, 'agent__run-propre'), 'HEAD')

    expect(wm.travauxNonPublies()).not.toContain('run-propre')
  })
})
