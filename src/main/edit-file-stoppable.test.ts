import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import { supprimerArbre } from './fs-supprimer'

/**
 * LE BOUTON STOP DOIT ATTEINDRE LA VERIFICATION AUTOMATIQUE D'`edit_file`.
 *
 * Suite de conv-978 (2026-10-15) : `run` et `verify` recoivent le signal d'arret du tour, mais la
 * verification qu'`edit_file` lance dans sa copie isolee (`mesurerAvecRapport` -> `spawnVerify`)
 * ne le recevait pas. Apres un Stop, la suite de tests continuait de tourner en arriere-plan
 * jusqu'a sa fin, et le tour coupe gardait un processus vivant derriere lui.
 *
 * Vrai depot git, vrai coordinateur de copies isolees, vrai `spawnVerify` : seul le runner est
 * remplace — un `vitest` qui dort 30 s et pose un temoin des qu'il demarre, pour que le Stop tombe
 * PENDANT la verification et non avant.
 */
const SAUT = String.fromCharCode(10)

// Hors du depot mesure : sous `process.cwd()`, les chemins cumules depassent la limite Windows
// (meme motif que `edit-file-publication-differee.test.ts`).
const RACINE = realpathSync.native(mkdtempSync(join(tmpdir(), 'autowin-edit-stop-')))

const temporaires: string[] = []
afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      supprimerArbre(chemin)
    } catch {
      /* Windows relache ses verrous en differe — le menage est un confort, pas le verdict */
    }
  }
})

function depotAVerificationLente(): { repo: string; temoin: string } {
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot-lent', scripts: { 'test:unit': 'vitest run' } }),
    'utf8'
  )
  writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 1' + SAUT, 'utf8')
  writeFileSync(
    join(repo, 'sujet.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "import { valeur } from './sujet'",
      "it('rend 1', () => expect(valeur()).toBe(1))",
      ''
    ].join(SAUT),
    'utf8'
  )
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  // `spawnVerify` met `<dossier du tour>/node_modules/.bin` en tete du PATH : le faux runner y vit,
  // hors de l'historique git, donc hors de la copie isolee.
  const bin = join(repo, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  const temoin = join(repo, 'verification-demarree.txt')
  const dormir = 'node -e "setTimeout(function(){},30000)"'
  writeFileSync(
    join(bin, 'vitest.cmd'),
    ['@echo off', `echo demarre> "${temoin}"`, dormir, 'exit /b 0', ''].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(bin, 'vitest'),
    ['#!/bin/sh', `echo demarre > "${temoin}"`, dormir, 'exit 0', ''].join(SAUT),
    'utf8'
  )
  chmodSync(join(bin, 'vitest'), 0o755)
  return { repo, temoin }
}

function busSur(repo: string): AppCommandBus {
  const wtRoot = mkdtempSync(join(RACINE, 'wt-'))
  temporaires.push(wtRoot)
  const coordinator = new RunWorktreeCoordinator({
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
  })
  return new AppCommandBus(
    { executionWorkspace: repo, worktrees: coordinator } as never,
    () => undefined
  )
}

async function attendre(condition: () => boolean, maxMs: number): Promise<void> {
  const fin = Date.now() + maxMs
  while (!condition()) {
    if (Date.now() > fin) throw new Error(`condition non atteinte en ${maxMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe('edit_file — le Stop de l’utilisateur coupe la vérification automatique', () => {
  it('rend la main tout de suite, ne publie rien et dit que l’arrêt vient de l’utilisateur', async () => {
    const { repo, temoin } = depotAVerificationLente()
    const bus = busSur(repo)
    const controller = new AbortController()
    bus.signalDuTour = () => controller.signal

    const promesse = bus.exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 1',
        newText: 'export const valeur = (): number => 2'
      },
      'conv-1'
    )
    // Le Stop doit tomber PENDANT la verification : on attend que le runner ait vraiment demarre.
    await attendre(() => existsSync(temoin), 60_000)
    const stop = Date.now()
    controller.abort('user')

    const result = (await promesse) as { ok?: boolean; error?: string }
    // Le runner dort 30 s : revenir en quelques secondes ne peut venir que de la mise a mort.
    expect(Date.now() - stop).toBeLessThan(10_000)
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('arrêtée par l’utilisateur')
    // Rien n'est prouve, donc rien n'est publie : le depot garde son contenu d'origine.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('number => 1')
  }, 120_000)
})
