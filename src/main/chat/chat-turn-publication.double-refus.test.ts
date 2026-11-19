import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ouvrirLaCopieDeTache } from '../copies/copie-de-tache'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { lireLaBaseDuFil } from '../git/photo-du-code'
import type { GitRunner } from '../runs/run-autoclose'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'

/*
 * LE DOUBLE REFUS. La porte refuse le travail d'un fil : il change les mêmes lignes qu'un autre fil
 * déjà entré dans main. Au tour de réparation, l'agent remet sa copie sur main (sa tête passe sur le
 * commit de main, son travail reposé dessus, les deux apports gardés). La porte doit alors publier
 * depuis CE point de départ : publier depuis l'ancien rejouerait la ligne de l'autre fil comme un
 * changement du fil, en conflit avec main, et refuserait une seconde fois un travail déjà réconcilié.
 *
 * Ce qui fait échouer une version fausse :
 *  - la base laissée à l'ancien point de départ → second refus « change les mêmes lignes » ;
 *  - une base recalée sur une tête déplacée SANS ses fichiers (`reset --soft`) → la porte publierait
 *    le retrait de ce que l'autre fil a fait entrer dans main.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout.trim()
const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) supprimerArbre(d)
})

const FIL = 'conv-D'
const ECRAN = 'ecran.tsx'
const ecran = (imports: string): string =>
  `import { ${imports} } from './outils'\nexport function Ecran() {\n  return a\n}\n`

/** Le dépôt sur main, la copie du fil ouverte dessus, puis un autre fil qui entre dans main. */
async function depotCopieEtAutreFil(): Promise<{
  depot: string
  copie: string
  dossierDeDonnees: string
}> {
  const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-double-refus-')))
  dirs.push(racine)
  const depot = join(racine, 'depot')
  mkdirSync(depot)
  await git(depot, 'init', '-b', 'main')
  await git(depot, 'config', 'user.email', 't@t.t')
  await git(depot, 'config', 'user.name', 'T')
  await git(depot, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(depot, ECRAN), ecran('a'))
  writeFileSync(join(depot, 'autre.txt'), 'autre, avant\n')
  await git(depot, 'add', '-A')
  await git(depot, 'commit', '-m', 'base')
  const dossierDeDonnees = join(racine, 'donnees')
  const ouverte = await ouvrirLaCopieDeTache({
    dossierDeDonnees,
    depot,
    tache: FIL,
    sansDistant: true
  })
  if (!ouverte.ok) throw new Error(ouverte.raison)
  // L'autre fil entre dans main : la même ligne d'import, et un fichier que ce fil ne touche pas.
  writeFileSync(join(depot, ECRAN), ecran('a, poignee'))
  writeFileSync(join(depot, 'autre.txt'), 'autre, après l’autre fil\n')
  await git(depot, 'commit', '-qam', 'autre fil')
  return { depot, copie: ouverte.chemin, dossierDeDonnees }
}

/** La fin d'un tour du fil : la porte de sa copie, comme l'app la passe. */
async function finDeTour(
  entree: { depot: string; copie: string; dossierDeDonnees: string },
  tour: string
): ReturnType<typeof publierTourDeChat> {
  const debut = await photographierDebutDeTour(entree.copie, realGit, 1_000_000)
  return publierTourDeChat({
    conversationId: FIL,
    turnId: tour,
    request: 'garde le panneau ouvert',
    debut,
    runGit: realGit,
    traces: [],
    porte: {
      depot: entree.depot,
      dossierDeDonnees: entree.dossierDeDonnees,
      publication: {
        ouvrir: async () => {
          throw new Error('la file de publication ne sert pas à une copie de la racine unique')
        },
        fermer: async () => undefined
      }
    }
  })
}

describe('réparation d’un refus de la porte — le point de départ suit la copie remise sur main', () => {
  it('copie remise sur main par l’agent : le tour de réparation entre, sans second refus', async () => {
    const lieux = await depotCopieEtAutreFil()
    const { depot, copie } = lieux
    writeFileSync(join(copie, ECRAN), ecran('a, visible'))

    const premier = await finDeTour(lieux, 'tour-D-0001')
    expect(premier?.project).toMatchObject({ status: 'skipped', reason: 'porte-refusee' })
    expect(String((premier?.project as { detail?: unknown }).detail)).toContain(ECRAN)

    // Le tour de réparation, geste par geste comme l'agent l'a fait : son fichier remis à la tête,
    // la copie posée sur main, puis son apport reposé à côté de celui de l'autre fil.
    await git(copie, 'checkout', 'HEAD', '--', ECRAN)
    await git(copie, 'checkout', '-q', '--detach', 'main')
    writeFileSync(join(copie, ECRAN), ecran('a, poignee, visible'))
    const main = await git(depot, 'rev-parse', 'HEAD')

    const reparation = await finDeTour(lieux, 'tour-D-0002')

    expect(reparation?.project).toMatchObject({ status: 'committed', files: 1 })
    expect(await git(depot, 'show', `main:${ECRAN}`)).toBe(ecran('a, poignee, visible').trim())
    expect(await git(depot, 'show', 'main:autre.txt')).toBe('autre, après l’autre fil')
    // La base a quitté l'ancien point de départ : elle repose sur main, puis sur ce passage.
    const base = await lireLaBaseDuFil({ dossier: copie, conversationId: FIL, runGit: realGit })
    expect(await git(depot, 'rev-parse', `${base}^`)).toBe(main)
  })

  it('tête posée sur main sans ses fichiers : la base reste, rien de l’autre fil n’est défait', async () => {
    const lieux = await depotCopieEtAutreFil()
    const { depot, copie } = lieux
    const avant = await lireLaBaseDuFil({ dossier: copie, conversationId: FIL, runGit: realGit })
    writeFileSync(join(copie, 'du-fil.txt'), 'travail du fil\n')
    // La tête bouge seule : la copie garde l'ancien `autre.txt` et l'ancien import.
    await git(copie, 'reset', '-q', '--soft', 'main')

    const issue = await finDeTour(lieux, 'tour-D-0001')

    expect(issue?.project).toMatchObject({ status: 'committed', files: 1 })
    expect(await git(depot, 'show', 'main:du-fil.txt')).toBe('travail du fil')
    expect(await git(depot, 'show', 'main:autre.txt')).toBe('autre, après l’autre fil')
    expect(await git(depot, 'show', `main:${ECRAN}`)).toBe(ecran('a, poignee').trim())
    const base = await lireLaBaseDuFil({ dossier: copie, conversationId: FIL, runGit: realGit })
    expect(await git(depot, 'rev-parse', `${base}^`)).toBe(avant)
    expect(lire(join(copie, 'autre.txt'))).toBe('autre, avant\n')
  })

  it('le refus qui suit dit pourquoi le point de départ n’a pas suivi, avant le détail de la porte', async () => {
    const lieux = await depotCopieEtAutreFil()
    const { copie } = lieux
    writeFileSync(join(copie, ECRAN), ecran('a, visible'))
    await git(copie, 'reset', '-q', '--soft', 'main')

    const issue = await finDeTour(lieux, 'tour-D-0001')

    expect(issue?.project).toMatchObject({ status: 'skipped', reason: 'porte-refusee' })
    const detail = String((issue?.project as { detail?: unknown }).detail)
    expect(detail).toMatch(
      /^La tête de la copie est sur main \([0-9a-f]{7}\), mais un fichier y est resté à l’ancienne version : autre\.txt\./u
    )
    expect(detail).toContain(
      `Ce fil change les mêmes lignes que main depuis son dernier passage : ${ECRAN}.`
    )
  })
})
