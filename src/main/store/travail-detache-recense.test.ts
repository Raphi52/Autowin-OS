import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE DÉFAUT, vécu le 2026-08-26 sur le run `ef845009a251-1`.
 *
 * L'utilisateur demande « fusionne » ; l'agent répond « rien à fusionner ». Son commit `7467f237`
 * existait pourtant, dans son propre worktree. Trois probes ont donné la cause :
 *
 *  - `git worktree list` → `7467f237 (detached HEAD)` : le travail vit sur un HEAD DÉTACHÉ, sans
 *    branche de secours ;
 *  - `git show-ref | grep recovery` → aucun `refs/heads/` local (que des `refs/remotes/origin/`) ;
 *  - `travauxNonPublies()` n'énumère QUE `refs/heads/autowin/recovery/*`.
 *
 * Un travail en detached HEAD est donc structurellement HORS du recensement : aucun `for-each-ref`
 * sur `refs/heads/` ne peut le voir. Pas de bandeau, pas de commande d'agent, pas de fusion — et le
 * seul recours restant est l'œil de quelqu'un qui pense à regarder `git worktree list`.
 *
 * Sur ce dépôt, 1 commit orphelin sur 24 worktrees. La fuite est bornée, mais elle est SILENCIEUSE :
 * c'est ce qui la rend chère. Le recensement doit se tromper du côté qui n'efface rien.
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

const monter = (): { repo: string; racine: string; wm: WorktreeManager } => {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-detache-'))
  roots.push(racine)
  return { repo, racine, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }) }
}

/**
 * Un bureau d'agent tel que l'orchestrateur en laisse un derrière lui : `agent__<id>` sous la racine
 * des worktrees, HEAD DÉTACHÉ, portant un commit que rien d'autre ne référence.
 */
const bureauDetacheAvecTravail = (
  repo: string,
  racine: string,
  agentId: string,
  fichier: string,
  contenu: string
): string => {
  const chemin = join(racine, `agent__${agentId}`)
  git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
  writeFileSync(join(chemin, fichier), contenu)
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `agent ${agentId}`)
  return git(chemin, 'rev-parse', 'HEAD')
}

describe('le recensement voit le travail resté sur un HEAD détaché', () => {
  it('SIGNALE un bureau détaché qui porte un commit inatteignable', () => {
    // Le bord qui compte : taire un travail non publié coûte le travail lui-même.
    const { repo, racine, wm } = monter()
    bureauDetacheAvecTravail(repo, racine, 'run-detache', 'apport.txt', 'du vrai travail\n')

    expect(wm.travauxNonPublies()).toContain('run-detache')
  })

  it('reste MUET sur un bureau détaché qui n’a rien produit', () => {
    // L'autre bord : un bureau ouvert puis abandonné sans commit n'est pas un travail perdu.
    const { repo, racine, wm } = monter()
    const chemin = join(racine, 'agent__run-vide')
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')

    expect(wm.travauxNonPublies()).not.toContain('run-vide')
  })

  it('reste MUET sur un bureau détaché posé sur une BASE ancienne, sans rien produire', () => {
    /*
     * LE FAUX POSITIF, mesuré sur le vrai dépôt juste après le premier correctif : 6 bureaux
     * signalés pour UN seul vrai travail. Un bureau ouvert sur une base plus ancienne que la branche
     * courante « apporte » des commits au sens de `git cherry` — alors qu'il n'a rien produit du
     * tout. Signaler ces cinq-là rouvrirait le défaut du 2026-08-24 : un bandeau qui crie pour
     * toujours n'est plus lu, et le seul vrai travail se noie dedans.
     *
     * Le discriminant est l'ORPHELINAT : un commit fabriqué par l'agent dans son bureau détaché
     * n'est contenu dans AUCUNE ref. Une base, par construction, en a une.
     */
    const { repo, racine, wm } = monter()
    // Une base qui DIVERGE : elle porte un commit que la branche courante n'a pas. C'est la
    // configuration du vrai dépôt — sans divergence, `git cherry` se tait et le test ne prouve rien.
    git(repo, 'checkout', '-q', '-b', 'une-base')
    writeFileSync(join(repo, 'base.txt'), 'la base a sa propre avance' + '\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance propre à la base')
    git(repo, 'checkout', '-q', '-')
    writeFileSync(join(repo, 'courant.txt'), 'la branche courante avance ailleurs' + '\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance propre au courant')
    // Bureau ouvert sur cette base divergente, JAMAIS commité dedans : rien n'a été produit.
    git(
      repo,
      'worktree',
      'add',
      '-q',
      '--detach',
      join(racine, 'agent__run-vieille-base'),
      'une-base'
    )

    expect(wm.travauxNonPublies()).not.toContain('run-vieille-base')
  })

  it('reste MUET sur un bureau posé sur une branche NON NÉE (SHA nul)', () => {
    /*
     * Cas RÉEL sur le dépôt de production : `git worktree list --porcelain` rend
     * `HEAD 0000000000000000000000000000000000000000` pour un bureau attaché à une branche jamais
     * commitée. Ce SHA passait `HEX_SHA` ; le recensement ne restait correct que parce que
     * `for-each-ref --contains 000…` LÈVE (exit 129) et que le court-circuit du `&&` s'arrêtait là.
     * Un refactor inversant l'ordre aurait réintroduit un faux signal. On l'écarte explicitement.
     *
     * RÉSERVE HONNÊTE : l'autre moitié du correctif — le `catch` de `estOrphelin` qui rend
     * désormais `true` au lieu de `false`, pour ne pas EFFACER un travail sur une panne git
     * transitoire — n'est PAS couverte par ce test. Forcer un échec de `for-each-ref` sur un dépôt
     * sain n'est pas reproductible ici. Le choix est argumenté (aligné sur `apporteQuelqueChose` et
     * sur la règle écrite dans le fichier), il n'est pas prouvé par exécution.
     */
    const { repo, racine, wm } = monter()
    git(repo, 'worktree', 'add', '-q', '--detach', join(racine, 'agent__run-non-nee'), 'HEAD')
    git(join(racine, 'agent__run-non-nee'), 'checkout', '-q', '--orphan', 'jamais-nee')

    expect(wm.travauxNonPublies()).not.toContain('run-non-nee')
  })

  it('reste MUET sur un bureau détaché dont le commit est DÉJÀ dans la base', () => {
    // Un travail repris à la main (cherry-pick, apply) ne doit plus être signalé : sinon le bandeau
    // crie pour toujours et personne ne l'écoute plus. C'est le défaut du 2026-08-24, à ne pas rouvrir.
    const { repo, racine, wm } = monter()
    const sha = bureauDetacheAvecTravail(repo, racine, 'run-repris', 'repris.txt', 'déjà intégré\n')
    git(repo, 'merge', '--no-ff', '-q', '-m', 'reprise à la main', sha)

    expect(wm.travauxNonPublies()).not.toContain('run-repris')
  })
})
