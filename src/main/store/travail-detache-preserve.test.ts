import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * L'AUTRE MOITIÉ DU DÉFAUT `ef845009a251-1` : ne pas le VOIR est une chose, le DÉTRUIRE en est une
 * autre.
 *
 * `travail-detache-recense.test.ts` couvre le recensement — un bureau en HEAD détaché doit être
 * SIGNALÉ. Ce fichier-ci couvre la sortie : aucune porte de sortie ne doit supprimer le dossier d'un
 * bureau tant que son commit n'est atteignable par AUCUNE référence. Sans ref, le commit n'est plus
 * qu'un objet flottant : invisible à tout `for-each-ref`, donc au recensement que l'autre fichier
 * vient de réparer, et candidat au prochain `git gc`.
 *
 * MESURÉ le 2026-08-26, en rangeant les bureaux de cette installation : trois bureaux porteurs d'un
 * commit non publié ont disparu de `git worktree list` PENDANT l'opération, retirés par l'app en
 * marche. Leurs commits — dont `7467f237`, le travail lunes/nuage avec son test de contrat, vert —
 * n'étaient plus référencés par rien. Ils n'ont survécu que parce qu'un `git branch` a été posé à la
 * main, à temps. Deux fois en une heure.
 *
 * Les trois bureaux avaient la même signature : arbre PROPRE, travail déjà COMMITTÉ sur le HEAD
 * détaché. C'est exactement l'angle mort — `preserverEtLiberer` ne crée sa branche de secours que si
 * `unpublishedFiles()` est non vide, c'est-à-dire pour du travail NON committé. Le travail committé,
 * lui, se lit comme « rien à préserver ».
 *
 * L'invariant testé ici est donc volontairement formulé sur l'ÉTAT, pas sur la sortie d'une fonction :
 * après l'appel, le commit est-il encore joignable ? Une fonction peut rendre `libere` de bonne foi
 * et avoir néanmoins rendu un commit inatteignable.
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
  const racine = mkdtempSync(join(tmpdir(), 'autowin-preserve-'))
  roots.push(racine)
  return { repo, racine, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }) }
}

/**
 * La signature exacte des trois bureaux perdus : HEAD détaché, travail COMMITTÉ, arbre PROPRE.
 * `unpublishedFiles()` rend donc zéro — et c'est là que le piège se referme.
 */
const bureauCommitteEtPropre = (
  repo: string,
  racine: string,
  agentId: string
): { chemin: string; sha: string } => {
  const chemin = join(racine, `agent__${agentId}`)
  git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
  writeFileSync(join(chemin, 'travail-precieux.txt'), 'le contrat des lunes et du nuage')
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `agent ${agentId}`)
  return { chemin, sha: git(chemin, 'rev-parse', 'HEAD') }
}

/** Le commit est-il atteignable depuis au moins une référence du dépôt de base ? */
const joignableParUneRef = (repo: string, sha: string): boolean =>
  git(repo, 'for-each-ref', '--contains', sha, '--format=%(refname)').trim().length > 0

describe('un bureau ne disparaît jamais en emportant son commit', () => {
  it('preserverEtLiberer garde le commit joignable, même sur un arbre PROPRE', () => {
    const { repo, racine, wm } = monter()
    const { chemin, sha } = bureauCommitteEtPropre(repo, racine, 'run-committe-propre-1')

    const issue = wm.preserverEtLiberer('run-committe-propre-1')

    // Le dossier peut partir — c'est le but du rangement. Le COMMIT, non.
    expect(issue.outcome).not.toBe('refuse')
    expect(existsSync(chemin)).toBe(false)
    expect(joignableParUneRef(repo, sha)).toBe(true)
  })

  it('discard garde le commit joignable', () => {
    // `discard` se documente comme « appelé seulement après confirmation UI ». Ce n'est plus vrai :
    // `identiteDeBureau` l'appelle pour RECYCLER un bureau, sans qu'aucun humain ne voie rien.
    const { repo, racine, wm } = monter()
    const { chemin, sha } = bureauCommitteEtPropre(repo, racine, 'run-committe-propre-2')

    wm.discard('run-committe-propre-2')

    expect(existsSync(chemin)).toBe(false)
    expect(joignableParUneRef(repo, sha)).toBe(true)
  })

  it('remove garde le commit joignable — le comportement de référence', () => {
    // Cette porte-ci passe déjà par `cleanupAgentWorktree`, qui attache HEAD à la branche de secours.
    // Le test la fixe pour que la garantie ne régresse pas, et sert de témoin aux deux au-dessus.
    const { repo, racine, wm } = monter()
    const { chemin, sha } = bureauCommitteEtPropre(repo, racine, 'run-committe-propre-3')

    wm.remove('run-committe-propre-3')

    expect(existsSync(chemin)).toBe(false)
    expect(joignableParUneRef(repo, sha)).toBe(true)
  })

  it('un bureau qui n’apporte RIEN ne laisse pas d’adresse derrière lui', () => {
    /*
     * LE CAS QUI DOIT ÉCHOUER si on se contentait d'« ancrer toujours ».
     *
     * Sans cette assertion, les trois tests au-dessus passeraient aussi avec un `git branch` inconditionnel
     * — et on reconstruirait le défaut de 2026-08-24 : des refs et des dossiers gardés pour zéro travail.
     * L'intention d'origine (« on ne range QUE le vide ») doit survivre au correctif.
     */
    const { repo, racine, wm } = monter()
    const agentId = 'run-vide-1'
    const chemin = join(racine, `agent__${agentId}`)
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')

    wm.discard(agentId)

    expect(existsSync(chemin)).toBe(false)
    expect(git(repo, 'branch', '--list', `autowin/recovery/${agentId}`).trim()).toBe('')
  })
})

/**
 * DEUX TENTATIVES, UN SEUL agentId — le trou que le premier correctif laissait.
 *
 * Signale par un juge contrarian, puis VERIFIE ici plutot que cru sur parole. `cleDeBureau` donne au
 * bureau une identite STABLE par tache (c'est tout le levier anti-residus du 2026-08-25) : deux
 * tentatives sur la meme cible retombent donc sur le MEME `agentId`, donc sur la MEME branche de
 * secours `autowin/recovery/<agentId>`. Un `branch -f` y ecrit sans regarder ce qu'elle portait.
 *
 * Consequence : le travail de la tentative 1, correctement ancre, est DESANCRE par l'ancrage de la
 * tentative 2 — orphelin, invisible, candidat au `gc`. Exactement la perte que ce fichier existe pour
 * interdire, deplacee d'un cran : on ne perd plus au premier balayage, on perd au second.
 */
describe('deux tentatives sur le meme bureau ne s’écrasent pas', () => {
  it('garde les DEUX travaux joignables quand un agentId est recyclé', () => {
    const { repo, racine, wm } = monter()
    const agentId = 'run-recycle-1'

    // Tentative 1 : un travail précieux, ancré puis le bureau balayé.
    const premier = bureauCommitteEtPropre(repo, racine, agentId)
    wm.discard(agentId)
    expect(joignableParUneRef(repo, premier.sha)).toBe(true)

    // Tentative 2 : MÊME agentId, bureau recréé depuis la base, travail DIFFÉRENT.
    const chemin = join(racine, `agent__${agentId}`)
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    writeFileSync(join(chemin, 'autre-travail.txt'), 'la seconde tentative, tout aussi précieuse')
    git(chemin, 'add', '-A')
    git(chemin, 'commit', '-q', '-m', `agent ${agentId} bis`)
    const second = git(chemin, 'rev-parse', 'HEAD')
    wm.discard(agentId)

    // Le second est ancré — et le PREMIER ne doit pas avoir été désancré au passage.
    expect(joignableParUneRef(repo, second)).toBe(true)
    expect(joignableParUneRef(repo, premier.sha)).toBe(true)
  })

  it('preserverEtLiberer ne déplace pas une adresse portant un AUTRE travail', () => {
    // `switch -C` déplace la branche exactement comme `branch -f` : même écrasement, même perte.
    // Ici l'adresse porte déjà le travail d'une tentative précédente, et le bureau à préserver
    // porte du NON committé — donc le chemin `aDuTravail`, l'autre porte que le test ci-dessus.
    const { repo, racine, wm } = monter()
    const agentId = 'run-recycle-2'

    const premier = bureauCommitteEtPropre(repo, racine, agentId)
    wm.discard(agentId)
    expect(joignableParUneRef(repo, premier.sha)).toBe(true)

    const chemin = join(racine, `agent__${agentId}`)
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    writeFileSync(join(chemin, 'non-committe.txt'), 'du travail jamais committé')

    wm.preserverEtLiberer(agentId)

    expect(joignableParUneRef(repo, premier.sha)).toBe(true)
  })
})
