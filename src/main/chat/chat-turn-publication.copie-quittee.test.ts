import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ouvrirLaCopieDeTache } from '../copies/copie-de-tache'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import type { GitRunner } from '../runs/run-autoclose'
import { photographierDebutDeTour, publierLaCopieQuitteeDuFil } from './chat-turn-publication'

/*
 * UN FIL SORTI DE SA COPIE Y LAISSE DU TRAVAIL : IL ENTRE QUAND MÊME DANS LE DÉPÔT DE LA COPIE.
 *
 * Vécu le 20/11/2026 (conv-2020) : le fil avait sa copie d'un dépôt de l'utilisateur, puis il est passé sur
 * le dossier d'Autowin pour corriger l'app. Au tour suivant, il a écrit une fonctionnalité dans sa copie
 * (`copies-de-taches/conv-2020`), chemin qu'il connaissait encore. La fin de tour ne publiait que le
 * dossier DU TOUR (Autowin, commit 85e47c405, sans ces fichiers) et le ménage horaire ne refait que les
 * entrées déjà refusées : le code est resté hors du dépôt, puis une mise en ligne faite depuis la copie
 * d'un autre fil l'a fait disparaître de la version publiée.
 *
 * Contrôles négatifs : un tour qui travaille DANS sa copie passe déjà par la porte habituelle (pas une
 * seconde fois ici), et une copie quittée sans écart ne fait aucun commit.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout.trim()

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) supprimerArbre(d)
})

const DEBUT = 1_000_000

async function depotTemoin(
  racine: string,
  nom: string
): Promise<{ depot: string; distant: string }> {
  const depot = join(racine, nom)
  const distant = join(racine, `${nom}-distant.git`)
  mkdirSync(depot)
  await run('git', ['init', '--bare', distant])
  await run('git', ['init', '-b', 'travail'], { cwd: depot })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: depot })
  await run('git', ['config', 'user.name', 'T'], { cwd: depot })
  await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: depot })
  writeFileSync(join(depot, 'partage.ts'), 'export const partage = 0\n')
  await run('git', ['add', '-A'], { cwd: depot })
  await run('git', ['commit', '-m', 'base'], { cwd: depot })
  await run('git', ['remote', 'add', 'origin', distant], { cwd: depot })
  await run('git', ['push', 'origin', 'travail'], { cwd: depot })
  return { depot, distant }
}

/** L'app (`appli`), le dépôt métier (`metier`) et la copie de `metier` notée sur le fil conv-R. */
async function filSortiDeSaCopie(): Promise<{
  appli: { depot: string; distant: string }
  metier: { depot: string; distant: string }
  copie: string
  dossierDeDonnees: string
}> {
  const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-copie-quittee-')))
  dirs.push(racine)
  const appli = await depotTemoin(racine, 'appli')
  const metier = await depotTemoin(racine, 'metier')
  const dossierDeDonnees = join(racine, 'donnees')
  const ouverte = await ouvrirLaCopieDeTache({
    dossierDeDonnees,
    depot: metier.depot,
    tache: 'conv-R',
    sansDistant: true
  })
  if (!ouverte.ok) throw new Error(ouverte.raison)
  return { appli, metier, copie: ouverte.chemin, dossierDeDonnees }
}

const porteDe = (
  depot: string,
  dossierDeDonnees: string
): Parameters<typeof publierLaCopieQuitteeDuFil>[0]['porte'] => ({
  depot,
  dossierDeDonnees,
  publication: {
    ouvrir: async () => {
      throw new Error('la file de publication ne doit pas servir à une copie de la racine unique')
    },
    fermer: async () => undefined
  }
})

describe('fil sorti de sa copie — le travail laissé dedans entre dans le dépôt de la copie', () => {
  it('rejoue conv-2020 : tour parti du dossier de l’app, fichiers écrits dans la copie du métier', async () => {
    const { appli, metier, copie, dossierDeDonnees } = await filSortiDeSaCopie()
    const teteAppliAvant = await git(appli.depot, 'rev-parse', 'HEAD')
    const distantMetierAvant = await git(metier.distant, 'rev-parse', 'travail')
    // Le fil travaille maintenant dans le dossier de l'app : c'est de là que part son tour.
    const debut = await photographierDebutDeTour(appli.depot, realGit, DEBUT)
    writeFileSync(join(copie, 'Regles.cs'), 'class PropositionsDeRenvoi {}\n')

    const rapport = await publierLaCopieQuitteeDuFil({
      conversationId: 'conv-R',
      turnId: 'tour-R-0002',
      request: 'propose les prochaines dates réelles',
      debut,
      copie,
      runGit: realGit,
      porte: porteDe(metier.depot, dossierDeDonnees)
    })

    expect(rapport?.project).toMatchObject({ status: 'committed', files: 1 })
    expect(await git(metier.depot, 'show', 'travail:Regles.cs')).toBe(
      'class PropositionsDeRenvoi {}'
    )
    // Commit local seulement, et rien dans l'app.
    expect(await git(metier.distant, 'rev-parse', 'travail')).toBe(distantMetierAvant)
    expect(await git(appli.depot, 'rev-parse', 'HEAD')).toBe(teteAppliAvant)
  })

  it('un tour qui travaille DANS sa copie est laissé à la porte habituelle', async () => {
    const { metier, copie, dossierDeDonnees } = await filSortiDeSaCopie()
    const teteMetierAvant = await git(metier.depot, 'rev-parse', 'travail')
    const debut = await photographierDebutDeTour(copie, realGit, DEBUT)
    writeFileSync(join(copie, 'Regles.cs'), 'class A {}\n')

    const rapport = await publierLaCopieQuitteeDuFil({
      conversationId: 'conv-R',
      turnId: 'tour-R-0003',
      request: 'ajoute A',
      debut,
      copie,
      runGit: realGit,
      porte: porteDe(metier.depot, dossierDeDonnees)
    })

    expect(rapport).toBeUndefined()
    expect(await git(metier.depot, 'rev-parse', 'travail')).toBe(teteMetierAvant)
  })

  it('une copie quittée sans écart ne fait aucun commit', async () => {
    const { appli, metier, copie, dossierDeDonnees } = await filSortiDeSaCopie()
    const teteMetierAvant = await git(metier.depot, 'rev-parse', 'travail')
    const debut = await photographierDebutDeTour(appli.depot, realGit, DEBUT)

    const rapport = await publierLaCopieQuitteeDuFil({
      conversationId: 'conv-R',
      turnId: 'tour-R-0004',
      request: 'question sans écriture',
      debut,
      copie,
      runGit: realGit,
      porte: porteDe(metier.depot, dossierDeDonnees)
    })

    expect(rapport).toBeUndefined()
    expect(await git(metier.depot, 'rev-parse', 'travail')).toBe(teteMetierAvant)
  })

  it('aucune copie notée, ou une copie disparue : rien', async () => {
    const { appli, metier, dossierDeDonnees } = await filSortiDeSaCopie()
    const debut = await photographierDebutDeTour(appli.depot, realGit, DEBUT)
    for (const copie of [undefined, join(dossierDeDonnees, 'absente')]) {
      const rapport = await publierLaCopieQuitteeDuFil({
        conversationId: 'conv-R',
        turnId: 'tour-R-0005',
        request: 'rien',
        debut,
        copie,
        runGit: realGit,
        porte: porteDe(metier.depot, dossierDeDonnees)
      })
      expect(rapport).toBeUndefined()
    }
  })
})

/*
 * CÂBLAGE : la fin de tour de l'app (`publishChatTurn`, dans `os.ts`) passe la copie notée du fil après le dossier
 * du tour, avec la même porte, et annonce son refus dans le fil comme celui du tour. Le texte est lu, pas importé :
 * `os.ts` charge Electron.
 */
describe('câblage — la fin de tour de l’app passe la copie quittée par le fil', () => {
  const source = readFileSync(new URL('../app/os.ts', import.meta.url), 'utf8')
  const debut = source.indexOf('publishChatTurn(input: {')
  const corps = source.slice(debut, source.indexOf('setFanOut(', debut))

  it('appelle publierLaCopieQuitteeDuFil avec la copie notée et la porte du tour, après publierTourDeChat', () => {
    expect(corps).toMatch(
      /publierLaCopieQuitteeDuFil\(\{ \.\.\.tour, copie: copieDuFil\.chemin, porte \}\)/
    )
    expect(corps.indexOf('publierTourDeChat(')).toBeGreaterThan(0)
    expect(corps.indexOf('publierLaCopieQuitteeDuFil(')).toBeGreaterThan(
      corps.indexOf('publierTourDeChat(')
    )
  })

  it('annonce dans le fil le refus de l’un comme de l’autre', () => {
    expect(corps).toMatch(/for \(const rendu of \[report, rapportDeLaCopie\]\)/)
    expect(corps).toContain(
      'annonceRefusDuProjet(this.conversations, tour.conversationId, rendu.project)'
    )
  })
})
