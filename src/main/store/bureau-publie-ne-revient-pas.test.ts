import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

/**
 * UN BUREAU PUBLIE NE DOIT PLUS REDEVENIR UN BUREAU EN ATTENTE.
 *
 * DEFAUT MESURE le 2026-08-25 sur cinq bureaux d'Autowin OS. La chaine, maillon par maillon :
 *
 * 1. La publication reussit et RANGE le bureau : il bascule sur une branche de recuperation, part en
 *    quarantaine, est nettoye, puis sa branche est SUPPRIMEE. La disparition de la ref EST le signal
 *    que la publication a abouti.
 * 2. Le dossier de quarantaine SURVIT quand le nettoyage echoue (sous Windows un verrou de fichier
 *    suffit : les workers vitest de la verification tiennent encore des poignees).
 * 3. `reconcileResidues` le RESSUSCITE : il renomme le dossier vers sa place d'actif sans verifier
 *    ni que la branche existe encore, ni que le travail est publie.
 * 4. Un HEAD pendant fait lire le DEPOT ENTIER comme modifie (`git status --untracked-files=all`
 *    sans HEAD resoluble rend tout en nouveau) : de 1564 a 1572 fichiers dans les cinq manifestes.
 * 5. Le manifeste repasse en `publication: blocked` + `attentionReason: merge-failed`.
 * 6. Le repechage automatique accepte exactement ce couple : trois tentatives par bureau, une copie
 *    RESTAUREE a chaque passage. Meme famille que les « 682 Mo de copies recreees » du 2026-08-24.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE, et c'est le coeur du sujet :
 * ce code est le dernier filet contre la PERTE du travail d'un agent. « Ne pas restaurer » et
 * « supprimer » sont a un caractere d'ecart. Un bureau dont le travail n'est PAS dans la base doit
 * donc survivre, quoi qu'il arrive — c'est le troisieme test, et il vaut les deux autres.
 */

const racines: string[] = []
afterEach(() => {
  for (const chemin of racines.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relache ses verrous en differe : le menage est un confort, pas le verdict */
    }
  }
})

const SAUT = String.fromCharCode(10)

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function depot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-publie-'))
  racines.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'base' + SAUT)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function gestionnaire(repo: string): { manager: WorktreeManager; racine: string } {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-publieroot-'))
  racines.push(racine)
  return { manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }), racine }
}

/**
 * Reproduit l'etat REEL observe : un dossier en quarantaine dont la branche de recuperation a
 * disparu. `dansLaBase` decide si le travail du bureau est deja publie ou irremplacable.
 */
function quarantaineSansRef(
  repo: string,
  racine: string,
  agentId: string,
  options: { dansLaBase: boolean }
): string {
  const actif = join(racine, 'agent__' + agentId)
  const branche = 'autowin/recovery/' + agentId
  git(repo, 'worktree', 'add', '-q', '-b', branche, actif)
  if (!options.dansLaBase) {
    // Du travail que la base NE CONTIENT PAS : le bureau devient irremplacable.
    writeFileSync(join(actif, 'trouvaille.txt'), 'travail jamais publie' + SAUT)
    git(actif, 'add', '-A')
    git(actif, 'commit', '-q', '-m', 'travail non publie')
  }
  // La quarantaine, telle que la publication la pose.
  const quarantaine = join(racine, '.quarantine')
  mkdirSync(quarantaine, { recursive: true })
  const range = join(quarantaine, agentId + '__0000')
  renameSync(actif, range)
  git(repo, 'worktree', 'repair', range)
  // LE SIGNAL DE PUBLICATION : la ref disparait. C'est ce qui laisse un HEAD pendant.
  git(repo, 'update-ref', '-d', 'refs/heads/' + branche)
  return range
}

describe('un bureau PUBLIE ne redevient pas un bureau en attente', () => {
  it('n est PLUS restaure en actif quand sa branche a disparu', () => {
    const repo = depot()
    const { manager, racine } = gestionnaire(repo)
    quarantaineSansRef(repo, racine, 'command-edit-publie', { dansLaBase: true })

    const bilan = manager.reconcileResidues({ balayer: false })

    expect(bilan.recovered).not.toContain('command-edit-publie')
    expect(existsSync(join(racine, 'agent__command-edit-publie'))).toBe(false)
  })

  it('NOMME ce qu il a laisse de cote, au lieu de l ignorer en silence', () => {
    const repo = depot()
    const { manager, racine } = gestionnaire(repo)
    quarantaineSansRef(repo, racine, 'command-edit-nomme', { dansLaBase: true })

    const bilan = manager.reconcileResidues({ balayer: false })

    // Range (supprime sur preuve) OU conserve avec son motif : jamais passe sous silence.
    expect(bilan.cleaned > 0 || bilan.blocked.length > 0).toBe(true)
  })

  /*
   * LE TEST QUI VAUT LES DEUX AUTRES. Une branche disparue ne PROUVE PAS que le travail est publie :
   * une ref peut se perdre autrement. Si le commit du bureau n'est pas dans la base, le bureau est
   * IRREMPLACABLE et doit survivre — sinon le correctif detruit ce que le mecanisme entier existe
   * pour proteger.
   */
  it('CONSERVE le bureau dont le travail n est PAS dans la base', () => {
    const repo = depot()
    const { manager, racine } = gestionnaire(repo)
    const range = quarantaineSansRef(repo, racine, 'command-edit-irremplacable', {
      dansLaBase: false
    })

    manager.reconcileResidues({ balayer: false })

    const survit = existsSync(range) || existsSync(join(racine, 'agent__command-edit-irremplacable'))
    expect(survit).toBe(true)
  })
})

describe('un HEAD illisible ne se lit pas comme « tout le depot a change »', () => {
  it('ne rend PAS chaque fichier du depot comme modifie', () => {
    const repo = depot()
    const { manager, racine } = gestionnaire(repo)
    const agentId = 'command-edit-head-casse'
    const actif = join(racine, 'agent__' + agentId)
    git(repo, 'worktree', 'add', '-q', '-b', 'autowin/recovery/' + agentId, actif)
    git(repo, 'update-ref', '-d', 'refs/heads/autowin/recovery/' + agentId)

    // Sans HEAD resoluble, `git status --untracked-files=all` rend TOUT en nouveau : c'est ainsi que
    // cinq bureaux se sont retrouves porteurs de 1564 a 1572 fichiers fantomes.
    expect(manager.changedFiles(agentId)).toEqual([])
  })
})
