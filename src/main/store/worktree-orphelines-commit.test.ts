import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * LE DERNIER CAS CONSERVÉ : un commit atteignable par AUCUNE référence.
 *
 * MESURÉ le 2026-08-14 sur l'installation de l'utilisateur, APRÈS que la préservation du travail non
 * committé ait rendu 971 Mo (49 copies → 18) : les 18 copies restantes se répartissent en 10 protégées
 * par l'âge minimal (runs de moins de 24 h) et 8 qui sont TOUTES ce cas-ci — `refs=0`, `sales=0`,
 * âgées de 185 à 213 h, pour 216 Mo. Aucune n'est un hasard.
 *
 * Leur travail est COMMITTÉ ; il est seulement orphelin. Le refus d'y toucher était juste — supprimer
 * la copie perdrait le commit, qu'aucune référence ne retient — mais il était sans issue : rien ne
 * viendrait jamais rattacher le commit d'un run mort, donc la conservation était définitive.
 *
 * On attache donc `autowin/recovery/<agentId>` au commit EXISTANT, puis on libère. Le commit devient
 * une référence du dépôt, restaurable par `git worktree add`, et satisfait ensuite naturellement le
 * critère de sûreté du balayage. Aucun commit n'est créé : on ne fait que le rendre atteignable.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Une copie dont le commit n'est retenu par AUCUNE référence — le cas mesuré. */
function copieOrpheline(): { base: string; worktreeRoot: string; agentId: string; copie: string } {
  const racine = mkdtempSync(join(tmpdir(), 'wt-orph-commit-'))
  racines.push(racine)
  const base = join(racine, 'base')
  mkdirSync(base, { recursive: true })
  git(base, 'init', '-q', '-b', 'main')
  git(base, 'config', 'user.email', 't@t')
  git(base, 'config', 'user.name', 'T')
  git(base, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(base, 'a.txt'), 'base\n')
  git(base, 'add', '-A')
  git(base, 'commit', '-q', '-m', 'base')

  const worktreeRoot = join(racine, 'copies')
  mkdirSync(worktreeRoot, { recursive: true })
  const agentId = 'run-orphelin-1'
  const copie = join(worktreeRoot, `agent__${agentId}`)
  git(base, 'worktree', 'add', '-q', '--detach', copie, 'HEAD')
  // Le commit est fait dans la copie en HEAD détaché : aucune branche ne le retient.
  writeFileSync(join(copie, 'travail.txt'), 'committé mais orphelin\n')
  git(copie, 'add', 'travail.txt')
  git(copie, 'commit', '-q', '-m', 'travail agent')
  return { base, worktreeRoot, agentId, copie }
}

const manager = (base: string, worktreeRoot: string): WorktreeManager =>
  new WorktreeManager({
    baseRepo: base,
    worktreeRoot,
    nowFn: () => Date.now() + 3 * 24 * 60 * 60 * 1_000
  } as never)

describe('copie dont le commit n’est retenu par aucune référence', () => {
  it('RATTACHE le commit à une référence, puis libère la copie', () => {
    const { base, worktreeRoot, agentId, copie } = copieOrpheline()
    const sha = git(copie, 'rev-parse', 'HEAD')
    // La prémisse du cas : avant l'action, RIEN ne retient ce commit.
    expect(git(base, 'for-each-ref', '--contains', sha, '--format=%(refname)')).toBe('')

    expect(manager(base, worktreeRoot).reconcileResidues().swept).toEqual([agentId])
    expect(existsSync(copie)).toBe(false)
    // LA garantie : le commit exact survit, et son contenu est relisible depuis le dépôt de base.
    expect(git(base, 'rev-parse', `autowin/recovery/${agentId}`)).toBe(sha)
    expect(git(base, 'show', `autowin/recovery/${agentId}:travail.txt`)).toBe(
      'committé mais orphelin'
    )
  })

  it('rend la copie restaurable par une simple commande git', () => {
    // Une préservation qu'on ne sait pas rejouer ne vaut rien : on la rejoue pour de vrai.
    const { base, worktreeRoot, agentId } = copieOrpheline()
    manager(base, worktreeRoot).reconcileResidues()

    const restaure = join(worktreeRoot, 'restauration')
    git(base, 'worktree', 'add', '-q', restaure, `autowin/recovery/${agentId}`)
    expect(git(restaure, 'show', 'HEAD:travail.txt')).toBe('committé mais orphelin')
  })

  it('n’efface RIEN quand la référence ne peut PAS être créée', () => {
    // Perdre un commit que rien d'autre ne retient serait le pire échange possible. On rend la
    // création impossible en occupant le nom par un répertoire de refs conflictuel.
    const { base, worktreeRoot, agentId, copie } = copieOrpheline()
    git(base, 'update-ref', `refs/heads/autowin/recovery/${agentId}/bloque`, 'HEAD')

    manager(base, worktreeRoot).reconcileResidues()
    expect(existsSync(copie)).toBe(true)
  })
})

/**
 * LA MEME QUESTION POUR TOUT UN LOT — et elle doit rendre EXACTEMENT la meme reponse.
 *
 * `commitsDejaReferences` remplace N `for-each-ref --contains` (83 ms piece, mesure du 2026-09-03)
 * par un seul `rev-list --no-walk`. Le test le confronte a un vrai depot : un commit retenu par une
 * branche, un commit orphelin, et une entree illisible.
 */
describe('commitsDejaReferences — une commande, la meme verite', () => {
  it('distingue le commit retenu par une reference du commit orphelin', () => {
    const { base, worktreeRoot, copie } = copieOrpheline()
    const orphelin = git(copie, 'rev-parse', 'HEAD')
    const retenu = git(base, 'rev-parse', 'HEAD')
    const reponse = manager(base, worktreeRoot).commitsDejaReferences([retenu, orphelin, 'pas-un-sha'])
    expect(reponse.get(retenu)).toBe(true)
    expect(reponse.get(orphelin)).toBe(false)
    expect(reponse.get('pas-un-sha')).toBeUndefined()
  })
  it('rend la MEME reponse que la voie unitaire qu’elle remplace', () => {
    const { base, worktreeRoot, copie } = copieOrpheline()
    const orphelin = git(copie, 'rev-parse', 'HEAD')
    const retenu = git(base, 'rev-parse', 'HEAD')
    const gestionnaire = manager(base, worktreeRoot)
    const lot = gestionnaire.commitsDejaReferences([retenu, orphelin])
    expect(lot.get(retenu)).toBe(gestionnaire.commitDejaReference(retenu))
    expect(lot.get(orphelin)).toBe(gestionnaire.commitDejaReference(orphelin))
  })
})
