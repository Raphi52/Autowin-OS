import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * COPIES ORPHELINES — des dossiers que git ne connaît plus, et que rien ne pouvait supprimer.
 *
 * Mesuré le 2026-08-14 sur l'installation de l'utilisateur : 57 dossiers de copies pour 3,6 Go, dont
 * 22 (1,3 Go) dont git répondait « is not a working tree ». Le balayage d'Autowin passant uniquement
 * par `git worktree remove`, ces copies étaient invisibles aux DEUX mécanismes — ni git ni l'app ne
 * pouvaient les enlever — et s'accumulaient à chaque usage. Le commentaire du coordinateur avait déjà
 * constaté le symptôme (« balayait 0 copie ») sans en trouver la cause.
 *
 * Ces tests écrivent de VRAIS dépôts git jetables : le comportement en cause est celui de git, pas
 * celui d'une imitation.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Un dépôt de base avec un commit, et une racine de copies à côté. */
function depotAvecCopie(): { base: string; worktreeRoot: string; copie: string; agentId: string } {
  const racine = mkdtempSync(join(tmpdir(), 'wt-orphelin-'))
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
  const agentId = 'run-abandonne-1'
  const copie = join(worktreeRoot, `agent__${agentId}`)
  git(base, 'worktree', 'add', '-q', '--detach', copie, 'HEAD')
  return { base, worktreeRoot, copie, agentId }
}

/**
 * Le manager, avec une horloge avancée : la copie doit paraître abandonnée depuis plus d'un jour.
 *
 * Les tests passent par `reconcileResidues()`, la porte PUBLIQUE — c'est elle que l'app emprunte au
 * démarrage. Une première version appelait le balayage privé : `tsc` la refusait, et surtout elle
 * aurait pu rester verte alors que le chemin réel ne l'atteint plus.
 */
function manager(base: string, worktreeRoot: string): WorktreeManager {
  return new WorktreeManager({
    baseRepo: base,
    worktreeRoot,
    nowFn: () => Date.now() + 3 * 24 * 60 * 60 * 1_000
  } as never)
}

describe('balayage des copies abandonnées', () => {
  it('supprime une copie ORPHELINE que git ne connaît plus', () => {
    const { base, worktreeRoot, copie } = depotAvecCopie()
    /*
      Le vrai cas MESURÉ, et non un cas plus dur : dans l'installation observée, `git rev-parse HEAD`
      FONCTIONNAIT à l'intérieur de la copie — seul le registre l'ignorait. Une première version de ce
      test supprimait le dossier d'administration : `rev-parse` échouait alors, la copie était écartée
      bien avant le code en cause, et le test prouvait autre chose.

      La copie est dupliquée sous un nom qui passe AVANT sa voisine dans l'ordre de parcours : son
      `.git` pointe vers l'administration de cette voisine, donc elle APPARTIENT bien à la base — et
      elle doit être traitée pendant que cette administration existe encore.

      Deux fixtures ont été écartées, chacune parce qu'elle prouvait autre chose que le code visé :
      supprimer le dossier d'administration faisait échouer `rev-parse`, donc la copie était écartée
      bien en amont ; copier le dépôt de base entier en faisait un dépôt ÉTRANGER, que le manager
      refuse de toucher à juste titre (« aucune écriture n'y est faite »).
    */
    const orpheline = join(worktreeRoot, 'agent__aaa-orphelin-1')
    cpSync(copie, orpheline, { recursive: true })
    expect(git(orpheline, 'rev-parse', 'HEAD')).toMatch(/^[0-9a-f]{40}$/)
    expect(git(base, 'worktree', 'list', '--porcelain')).not.toContain('agent__aaa-orphelin-1')

    manager(base, worktreeRoot).reconcileResidues()
    expect(existsSync(orpheline)).toBe(false)
  })

  it('supprime aussi une copie ENCORE enregistrée, comme avant', () => {
    // Le chemin d'origine ne doit pas régresser : c'est lui qui traite le cas nominal.
    const { base, worktreeRoot, copie } = depotAvecCopie()
    manager(base, worktreeRoot).reconcileResidues()
    expect(existsSync(copie)).toBe(false)
  })

  it('PRÉSERVE le travail non publié dans une référence, puis libère la copie', () => {
    /*
      La garantie a CHANGÉ DE FORME, et elle est plus forte qu'avant. La version précédente de ce test
      affirmait qu'une copie porteuse de travail est épargnée — vrai, et sans issue : un run mort sans
      passer par `finalize` gardait ses 30 Mo pour toujours, puisque personne ne viendrait jamais
      publier ce travail. Mesuré le 2026-08-14 : 1 453 Mo de copies pour 665 Ko de travail unique.

      Le travail est désormais committé sur `autowin/recovery/<id>` AVANT la libération. Il n'est donc
      plus seulement épargné : il est SAUVEGARDÉ, restaurable par une commande git, et il cesse
      d'occuper un checkout complet.
    */
    const { base, worktreeRoot, copie, agentId } = depotAvecCopie()
    writeFileSync(join(copie, 'a.txt'), 'travail en cours\n')

    manager(base, worktreeRoot).reconcileResidues()

    expect(existsSync(copie)).toBe(false)
    expect(git(base, 'show', `autowin/recovery/${agentId}:a.txt`)).toBe('travail en cours')
  })

  it('n’efface RIEN quand le travail ne peut PAS être préservé', () => {
    // Perdre du travail pour gagner 30 Mo serait le pire échange possible. On rend la sauvegarde
    // impossible en cassant l'administration git : la copie doit alors survivre.
    const { base, worktreeRoot, copie } = depotAvecCopie()
    writeFileSync(join(copie, 'a.txt'), 'travail en cours\n')
    rmSync(join(base, '.git', 'worktrees'), { recursive: true, force: true })

    manager(base, worktreeRoot).reconcileResidues()
    expect(existsSync(copie)).toBe(true)
  })

  it('ÉPARGNE une copie trop récente : l’âge minimal reste une protection', () => {
    const { base, worktreeRoot, copie } = depotAvecCopie()
    const orpheline = join(worktreeRoot, 'agent__aaa-orphelin-3')
    cpSync(copie, orpheline, { recursive: true })
    const jeune = new WorktreeManager({
      baseRepo: base,
      worktreeRoot,
      nowFn: () => Date.now()
    } as never)
    jeune.reconcileResidues()
    expect(existsSync(orpheline)).toBe(true)
  })
})
