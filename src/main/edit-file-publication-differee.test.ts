import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'

/**
 * DEFAUT VECU le 2026-08-25 (conv-1404) : TROIS `edit_file` sur QUATRE ont rendu
 * « Le bureau edit_file a ete conserve : publication automatique incomplete » — alors que les trois
 * manifestes portaient `verdict: green, publication: complete` et que les trois commits etaient
 * dans `HEAD`. Le travail etait publie ; seul le message disait le contraire.
 *
 * CAUSE : `RunWorktreeCoordinator.endAsync` rend `undefined` quand la copie a encore des processus
 * actifs (les workers `vitest` que la verification vient elle-meme de lancer). Ce n'est pas un
 * echec, c'est un REPORT : la copie passe en attente et `retryRecovery` la publie ensuite.
 * `withIsolatedMutation` ne blanchissait que quatre issues nommees, donc `undefined` tombait dans
 * le `throw`.
 *
 * Le cout n'est pas cosmetique : face a un faux echec, l'agent RECOMMENCE. Quatre appels pour deux
 * changements utiles, quatre bureaux sur le disque, trois branches de recuperation.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une issue reellement BLOQUEE
 * (`blocked` / `conflict`) rendue silencieuse. Le second test la garde — un differe n'est pas un
 * blocage, et rebaptiser l'un en l'autre serait exactement le pansement a ne pas poser.
 */
/** Saut de ligne construit par son code : un antislash ecrit a la main a deja fige un defaut ici. */
const SAUT = String.fromCharCode(10)

const RACINE = join(process.cwd(), '.autowin-data', 'tests-differe')

const temporaires: string[] = []
afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relache ses verrous en differe — le menage est un confort, pas le verdict */
    }
  }
})

function depotSain(): string {
  mkdirSync(RACINE, { recursive: true })
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot-sain', scripts: { 'test:unit': 'vitest run' } }),
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
  git('commit', '-q', '-m', 'base saine')
  verificateurNeutre(repo)
  return repo
}

/**
 * UN VERIFICATEUR NEUTRE, et c'est deliberate.
 *
 * Ce test porte sur la SEMANTIQUE de publication — un report n'est pas un echec — pas sur ce que
 * `vitest` sait prouver. Faire tourner le vrai runner dans un depot temporaire le rend dependant
 * d'un `node_modules` qu'il n'a pas : le meme obstacle laisse `edit-file-portee.test.ts` rouge sur
 * cette branche. On fixe donc le verdict de verification a VERT, pour que le seul comportement sous
 * observation soit celui de la finalisation.
 *
 * `spawnVerify` prefixe le PATH de `<executionWorkspace>/node_modules/.bin` : y deposer un `vitest`
 * qui sort a 0 suffit, sans toucher au code de production.
 */
function verificateurNeutre(repo: string): void {
  const bin = join(repo, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  const cmd = join(bin, 'vitest.cmd')
  writeFileSync(cmd, ['@echo off', 'echo Tests 1 passed', 'exit /b 0', ''].join(SAUT), 'utf8')
  writeFileSync(
    join(bin, 'vitest'),
    ['#!/bin/sh', 'echo "Tests 1 passed"', 'exit 0', ''].join(SAUT),
    'utf8'
  )
  chmodSync(join(bin, 'vitest'), 0o755)
}

/**
 * Le vrai coordinateur, avec la SEULE difference qui compte : sa finalisation rend l'issue passee en
 * parametre. `undefined` reproduit exactement le chemin « processus encore actifs » du code reel.
 */
function busSur(repo: string, issue: unknown): AppCommandBus {
  const wtRoot = mkdtempSync(join(RACINE, 'wt-'))
  temporaires.push(wtRoot)
  const coordinator = new RunWorktreeCoordinator({
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
  })
  const differe = {
    ...coordinator,
    beginAsync: coordinator.beginAsync?.bind(coordinator),
    begin: coordinator.begin.bind(coordinator),
    endAsync: async (): Promise<unknown> => issue,
    end: (): unknown => issue
  }
  return new AppCommandBus(
    { executionWorkspace: repo, worktrees: differe } as never,
    () => undefined
  )
}

const EDITION = {
  path: 'sujet.ts',
  oldText: 'export const valeur = (): number => 1',
  newText: 'export const valeur = (): number => 1 // commentaire sans effet'
}

describe('edit_file — une publication DIFFEREE n’est pas un echec', () => {
  it('ne rend PAS une erreur quand la finalisation est reportee', async () => {
    const repo = depotSain()

    const result = await busSur(repo, undefined).exec('edit_file', EDITION, 'conv-1')

    expect(result).toMatchObject({ ok: true })
  }, 180_000)

  it('NOMME l’attente au lieu de laisser croire a une publication faite', async () => {
    const repo = depotSain()

    const result = await busSur(repo, undefined).exec('edit_file', EDITION, 'conv-1')

    const data = result.data as { publication?: string }
    expect(data.publication).toMatch(/différée|differee/)
  }, 180_000)

  /**
   * LE MESSAGE DOIT ARRIVER JUSQU'A L'AGENT, pas seulement exister dans un module.
   *
   * Le quatrieme volet de conv-1407 a donne un motif propre a chacune des six issues. Prouver la
   * FONCTION ne prouve pas le CHEMIN : ces trois cas passent par `edit_file` REEL et lisent l'erreur
   * telle que l'orchestrateur la recevra. Sans eux, « expose » aurait ete pris pour « integre ».
   */
  it('un CONFLIT dit qu il est un conflit, nomme les fichiers, et ne dit pas de republier', async () => {
    const repo = depotSain()

    const result = await busSur(repo, {
      outcome: 'conflict',
      files: ['sujet.ts'],
      agentId: 'a',
      baseSha: 'x',
      agentSha: 'y'
    }).exec('edit_file', EDITION, 'conv-1')

    expect(result).toMatchObject({ ok: false })
    const message = String((result as { error?: string }).error)
    expect(message).toContain('conflict')
    expect(message).toContain('sujet.ts')
    // Le defaut d'origine : « Reprendre pour republier » sur un conflit, republier a l'identique
    // echouant exactement pareil.
    expect(message.toLowerCase()).toContain('resous')
  }, 180_000)

  it('une copie ABSENTE n envoie pas chercher un bureau qui n existe plus', async () => {
    const repo = depotSain()

    const result = await busSur(repo, { outcome: 'absente' }).exec('edit_file', EDITION, 'conv-1')

    expect(result).toMatchObject({ ok: false })
    const message = String((result as { error?: string }).error).toLowerCase()
    expect(message).toContain('absente')
    expect(message).not.toContain('bureaux conserves')
  }, 180_000)

  it('un travail SAUVE SUR UNE BRANCHE le dit, au lieu de faire refaire l edition', async () => {
    const repo = depotSain()

    const result = await busSur(repo, {
      outcome: 'preserve-et-libere',
      branche: 'autowin/sauvegarde/xyz'
    }).exec('edit_file', EDITION, 'conv-1')

    expect(result).toMatchObject({ ok: false })
    const message = String((result as { error?: string }).error)
    expect(message).toContain('autowin/sauvegarde/xyz')
    expect(message.toLowerCase()).toContain('branche')
  }, 180_000)

  it('continue de REFUSER une issue reellement bloquee', async () => {
    const repo = depotSain()

    const result = await busSur(repo, { outcome: 'blocked', reason: 'base-dirty' }).exec(
      'edit_file',
      EDITION,
      'conv-1'
    )

    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).not.toContain('commentaire sans effet')
  }, 180_000)
})
