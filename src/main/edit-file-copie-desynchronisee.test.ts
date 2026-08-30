import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'

/**
 * DEFAUT MESURE le 2026-08-30 : `edit_file` edite une COPIE DESYNCHRONISEE.
 *
 * Le bureau isole est cree sur `baseSha` ; `describeForLaunch` EXCLUT explicitement les fichiers
 * non committes (`excludedDirtyFiles`). L'agent, lui, construit son `oldText` avec `read_file`, qui
 * lit l'espace de travail VIVANT. Des qu'un fichier est sale — l'etat normal d'un depot en cours de
 * travail — les deux lectures portent sur des textes DIFFERENTS.
 *
 * Ce test reproduit exactement cela : `sujet.ts` est modifie SANS commit, puis edite sur son
 * contenu reel. ROUGE avant correction : « texte a remplacer introuvable ».
 */
const SAUT = String.fromCharCode(10)
const RACINE = join(process.cwd(), '.autowin-data', 'tests-desync')

const temporaires: string[] = []
afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relache ses verrous en differe */
    }
  }
})

function depotAvecTravailNonCommitte(): string {
  mkdirSync(RACINE, { recursive: true })
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot-desync', scripts: { 'test:unit': 'vitest run' } }),
    'utf8'
  )
  writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 1' + SAUT, 'utf8')
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  // LE COEUR DU CAS : le fichier vivant n'est PLUS celui du commit, et rien ne le committe.
  writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 2' + SAUT, 'utf8')
  verificateurNeutre(repo)
  return repo
}

/** Verdict de verification fixe a VERT : le comportement sous observation est la SYNCHRONISATION. */
function verificateurNeutre(repo: string): void {
  const bin = join(repo, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'vitest.cmd'),
    ['@echo off', 'echo Tests 1 passed', 'exit /b 0', ''].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(bin, 'vitest'),
    ['#!/bin/sh', 'echo "Tests 1 passed"', 'exit 0', ''].join(SAUT),
    'utf8'
  )
  chmodSync(join(bin, 'vitest'), 0o755)
}

function busSur(repo: string): AppCommandBus {
  const wtRoot = mkdtempSync(join(RACINE, 'wt-'))
  temporaires.push(wtRoot)
  const coordinator = new RunWorktreeCoordinator({
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
  })
  const differe = {
    ...coordinator,
    beginAsync: coordinator.beginAsync?.bind(coordinator),
    begin: coordinator.begin.bind(coordinator),
    endAsync: async (): Promise<unknown> => undefined,
    end: (): unknown => undefined
  }
  return new AppCommandBus({ executionWorkspace: repo, worktrees: differe } as never, () => undefined)
}

describe('edit_file — le bureau porte le fichier VIVANT, pas celui du dernier commit', () => {
  it('edite le contenu NON COMMITTE que l’agent a lu', async () => {
    const repo = depotAvecTravailNonCommitte()

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 2',
        newText: 'export const valeur = (): number => 3'
      },
      'conv-desync'
    )

    expect(result).toMatchObject({ ok: true })
    const diff = String((result.data as { diff?: string })?.diff)
    expect(diff).toContain('number => 3')
  }, 180_000)

  it('ne fabrique pas une edition sur la version PERIMEE quand l’extrait existe des deux cotes', async () => {
    const repo = depotAvecTravailNonCommitte()
    // Extrait present dans les DEUX versions : sans synchronisation, l'edition part de « => 1 » et
    // publier ecraserait le « => 2 » non committe de l'utilisateur.
    const result = await busSur(repo).exec(
      'edit_file',
      { path: 'sujet.ts', oldText: 'export const valeur', newText: 'export const resultat' },
      'conv-desync-2'
    )

    expect(result).toMatchObject({ ok: true })
    const bureau = String((result.data as { path?: string })?.path)
    expect(bureau).toBe('sujet.ts')
    // Le fichier vivant garde sa valeur 2 : l'edition n'a pas ramene la version du commit.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('=> 2')
  }, 180_000)
})
