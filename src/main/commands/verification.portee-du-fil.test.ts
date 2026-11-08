import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fichiersNonCommites, runVerifyAt } from './verification'
import {
  fichiersCommitesHorsDeLaCopie,
  fichiersRestesDansLaCopie,
  synchroniserBureauDeVerification
} from '../verify/verification-isolee'

/**
 * L'AVIS DE PORTÉE PARLE DU DOSSIER DU FIL, PAS DE LA COPIE DE VÉRIFICATION.
 *
 * Mesuré le 2026-11-08 : dossier du fil et dépôt principal à 0 fichier non commité, et pourtant
 * « l'ARBRE DE TRAVAIL contient 23 fichier(s) non commité(s) ». Les 23 étaient ceux d'un commit
 * arrivé sur main et absent de la copie du fil. La copie de vérification naît sur la dernière base
 * puis reçoit le contenu du fil : son `git status` montre aussi l'écart entre les deux commits.
 * L'avis lisait ce `git status` et prenait cet écart pour du travail non commité.
 */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

const ecrire = (racine: string, relatif: string, contenu: string): void => {
  mkdirSync(join(racine, relatif, '..'), { recursive: true })
  writeFileSync(join(racine, relatif), contenu)
}

const dossiers: string[] = []

/** Un dépôt, le dossier du fil en retard d'un commit sur main, et la copie préparée comme `verify`. */
async function preparer(
  avantSynchro?: (fil: string) => void
): Promise<{ fil: string; copie: string }> {
  const racine = mkdtempSync(join(tmpdir(), 'aos-portee-du-fil-'))
  dossiers.push(racine)
  const depot = join(racine, 'depot')
  const fil = join(racine, 'fil')
  const copie = join(racine, 'copie')
  mkdirSync(depot)
  git(depot, 'init', '-q', '-b', 'main')
  git(depot, 'config', 'user.email', 'test@exemple.invalid')
  git(depot, 'config', 'user.name', 'Test')
  ecrire(depot, 'package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
  ecrire(depot, 'src/a.ts', 'export const a = 1\n')
  ecrire(depot, 'src/a.test.ts', "it('a', () => {})\n")
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'premier')
  git(depot, 'worktree', 'add', '-q', '--detach', fil, 'HEAD')
  // Un autre fil publie sur main : le dossier du fil a désormais un commit de retard.
  ecrire(depot, 'src/a.ts', 'export const a = 2\n')
  ecrire(depot, 'src/b.ts', 'export const b = 1\n')
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'second, venu d’un autre fil')
  git(depot, 'worktree', 'add', '-q', '--detach', copie, 'main')
  avantSynchro?.(fil)
  // Même report que `bureauDeVerification` : commits hors copie, non commités, restes de la copie.
  synchroniserBureauDeVerification(fil, copie, [
    ...((await fichiersCommitesHorsDeLaCopie(fil, copie)) ?? []),
    ...(await fichiersNonCommites(fil)),
    ...((await fichiersRestesDansLaCopie(copie)) ?? [])
  ])
  return { fil, copie }
}

function busDouble(fil: string): Parameters<typeof runVerifyAt>[0] {
  return {
    workspaceDuTour: fil,
    fichiersNonCommites,
    spawnVerify: async (_argv: string[], _cwd: string, etiquette: string) => ({
      ok: true,
      exitCode: 0,
      command: etiquette,
      output: '1 passed'
    }),
    runRelatedVerifyAt: async () => ({ allowed: false })
  } as never
}

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

describe('verify — avis de portée quand le fil a un commit de retard sur main', () => {
  it('fil propre : aucun avis, même si la copie montre l’écart avec main', async () => {
    const { fil, copie } = await preparer()
    // Le décor reproduit bien le défaut : fil propre, copie « sale » de l'autre commit.
    expect(await fichiersNonCommites(fil)).toEqual([])
    expect(await fichiersNonCommites(copie)).not.toEqual([])

    const resultat = await runVerifyAt(busDouble(fil), copie, undefined, 'src/a.test.ts')

    expect(resultat.ok).toBe(true)
    expect(resultat.output).not.toMatch(/Portée de ce résultat/u)
  }, 30_000)

  it('fil sale : l’avis nomme SON fichier, pas ceux du commit de l’autre fil', async () => {
    const { fil, copie } = await preparer((dossierDuFil) =>
      ecrire(dossierDuFil, 'src/c.ts', 'export const c = 1\n')
    )

    const resultat = await runVerifyAt(busDouble(fil), copie, undefined, 'src/a.test.ts')

    expect(resultat.output).toMatch(/contient 1 fichier\(s\) non commité\(s\)/u)
    expect(resultat.output).toContain('src/c.ts')
    expect(resultat.output).not.toContain('src/b.ts')
  }, 30_000)
})
