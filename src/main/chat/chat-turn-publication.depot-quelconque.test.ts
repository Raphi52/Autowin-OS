import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationFileTrace } from '../activity/conversation-file-trace-spool'
import { ouvrirLaCopieDeTache } from '../copies/copie-de-tache'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { estUnDepotGit } from '../git/git-apres-fil'
import {
  ouvrirLaCopieDuFilPourLeTour,
  preparerLeDossierDuTour
} from '../conversations/bascule-dossier-conversation'
import { exactLineFingerprint } from '../fichiers/exact-line-fingerprint'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import type { GitRunner } from '../runs/run-autoclose'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'

/*
 * UNE COPIE D'UN DÉPÔT QUI N'EST PAS AUTOWIN. L'application tourne sur Autowin (`appli`) ; le fil
 * travaille dans une copie de `metier`, un autre dépôt git. La porte doit faire entrer le travail de la
 * copie dans la branche de `metier` en commit LOCAL : rien ne part vers son distant, et les fichiers non
 * commités de son dossier partagé restent identiques octet pour octet.
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
const PENDANT = new Date(DEBUT + 5_000).toISOString()
const lignes = (...contenu: string[]): string[] => contenu.map(exactLineFingerprint)

/** Un dépôt témoin sur la branche `travail`, avec un distant nu local pour observer un envoi. */
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
  writeFileSync(join(depot, 'ouvert.txt'), 'deux\n')
  await run('git', ['add', '-A'], { cwd: depot })
  await run('git', ['commit', '-m', 'base'], { cwd: depot })
  await run('git', ['remote', 'add', 'origin', distant], { cwd: depot })
  await run('git', ['push', 'origin', 'travail'], { cwd: depot })
  return { depot, distant }
}

describe('copie d’un dépôt qui n’est pas Autowin — la porte entre le travail en commit local', () => {
  it('le travail entre dans la branche de son dépôt, rien ne part, le non-commité reste intact', async () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-porte-quelconque-')))
    dirs.push(racine)
    const appli = await depotTemoin(racine, 'appli')
    const autreDepot = await depotTemoin(racine, 'metier')
    // Le travail non commité de l'utilisateur, dans le dossier partagé du dépôt tiers.
    writeFileSync(join(autreDepot.depot, 'ouvert.txt'), 'modifie a la main\n')
    writeFileSync(join(autreDepot.depot, 'brouillon.txt'), 'pas encore\n')
    const avantOuvert = readFileSync(join(autreDepot.depot, 'ouvert.txt'))
    const avantBrouillon = readFileSync(join(autreDepot.depot, 'brouillon.txt'))
    const teteAutreDepotAvant = await git(autreDepot.depot, 'rev-parse', 'HEAD')
    const teteAppliAvant = await git(appli.depot, 'rev-parse', 'HEAD')

    const dossierDeDonnees = join(racine, 'donnees')
    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees,
      depot: autreDepot.depot,
      tache: 'conv-R',
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(ouverte.raison)
    const debut = await photographierDebutDeTour(ouverte.chemin, realGit, DEBUT)
    writeFileSync(join(ouverte.chemin, 'mine.cs'), 'class A {}\n')

    const rapport = await publierTourDeChat({
      conversationId: 'conv-R',
      turnId: 'tour-R-0001',
      request: 'ajoute la classe A',
      debut,
      runGit: realGit,
      traces: [
        {
          timestamp: PENDANT,
          conversationId: 'conv-R',
          turnId: 'tour-R-0001',
          workspaceRoot: ouverte.chemin,
          source: 'chat_tool',
          paths: ['mine.cs'],
          pathLineFingerprints: { 'mine.cs': lignes('class A {}') }
        } satisfies ConversationFileTrace
      ],
      porte: {
        // Le dépôt DU FIL (celui où sa copie a été ouverte), pas celui d'où tourne l'application.
        depot: autreDepot.depot,
        dossierDeDonnees,
        publication: {
          ouvrir: async () => {
            throw new Error(
              'la file de publication ne doit pas servir à une copie de la racine unique'
            )
          },
          fermer: async () => undefined
        }
      }
    })

    expect(rapport?.project).toMatchObject({ status: 'committed', files: 1 })
    expect(await git(autreDepot.depot, 'show', 'travail:mine.cs')).toBe('class A {}')
    // Rien n'est parti vers le distant, ni d'un dépôt ni de l'autre.
    expect(await git(autreDepot.distant, 'rev-parse', 'travail')).toBe(teteAutreDepotAvant)
    expect(await git(appli.distant, 'rev-parse', 'travail')).toBe(teteAppliAvant)
    expect(await git(appli.depot, 'rev-parse', 'HEAD')).toBe(teteAppliAvant)
    // Le travail non commité du dossier partagé n'a pas bougé d'un octet.
    expect(readFileSync(join(autreDepot.depot, 'ouvert.txt'))).toEqual(avantOuvert)
    expect(readFileSync(join(autreDepot.depot, 'brouillon.txt'))).toEqual(avantBrouillon)
  })
})

/*
 * Un projet LIÉ (copie `git worktree` du dépôt principal, sur la branche `feature`). Le fil est rangé dans
 * `feature` : son travail entre sur `feature`, dans le projet lié, et la branche du dépôt principal ne bouge
 * pas. Le premier `worktree` de la copie désigne le dépôt principal : ce n'est pas lui qui décide.
 */
describe('un projet lié (git worktree) — le travail de la copie entre dans sa propre branche', () => {
  it('le travail entre sur feature, dans le projet lié ; la branche du dépôt principal ne bouge pas', async () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-porte-lie-')))
    dirs.push(racine)
    const principal = await depotTemoin(racine, 'principal')
    const lie = join(racine, 'principal-feature')
    await run('git', ['worktree', 'add', '-b', 'feature', lie], { cwd: principal.depot })
    const teteTravailAvant = await git(principal.depot, 'rev-parse', 'travail')

    const dossierDeDonnees = join(racine, 'donnees')
    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees,
      depot: lie,
      tache: 'conv-L',
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(ouverte.raison)
    const debut = await photographierDebutDeTour(ouverte.chemin, realGit, DEBUT)
    writeFileSync(join(ouverte.chemin, 'mine.cs'), 'class L {}\n')

    const rapport = await publierTourDeChat({
      conversationId: 'conv-L',
      turnId: 'tour-L-0001',
      request: 'ajoute la classe L',
      debut,
      runGit: realGit,
      traces: [
        {
          timestamp: PENDANT,
          conversationId: 'conv-L',
          turnId: 'tour-L-0001',
          workspaceRoot: ouverte.chemin,
          source: 'chat_tool',
          paths: ['mine.cs'],
          pathLineFingerprints: { 'mine.cs': lignes('class L {}') }
        } satisfies ConversationFileTrace
      ],
      porte: {
        // fix-ok: la porte reçoit le projet lié lui-même ; le premier worktree de git serait le dépôt principal.
        depot: lie,
        dossierDeDonnees,
        publication: {
          ouvrir: async () => {
            throw new Error(
              'la file de publication ne doit pas servir à une copie de la racine unique'
            )
          },
          fermer: async () => undefined
        }
      }
    })

    expect(rapport?.project).toMatchObject({ status: 'committed', files: 1 })
    expect(await git(lie, 'show', 'feature:mine.cs')).toBe('class L {}')
    expect(await git(principal.depot, 'rev-parse', 'travail')).toBe(teteTravailAvant)
    expect(await git(principal.depot, 'ls-tree', '-r', '--name-only', 'travail')).not.toContain(
      'mine.cs'
    )
  })

  it('une porte qui nomme un autre dépôt que celui de la copie ne fait entrer rien dans la branche de la copie', async () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-porte-autre-')))
    dirs.push(racine)
    const appli = await depotTemoin(racine, 'appli')
    const autreDepot = await depotTemoin(racine, 'metier')
    const teteAutreDepotAvant = await git(autreDepot.depot, 'rev-parse', 'travail')
    const dossierDeDonnees = join(racine, 'donnees')
    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees,
      depot: autreDepot.depot,
      tache: 'conv-X',
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(ouverte.raison)
    const debut = await photographierDebutDeTour(ouverte.chemin, realGit, DEBUT)
    writeFileSync(join(ouverte.chemin, 'mine.cs'), 'class X {}\n')

    const rapport = await publierTourDeChat({
      conversationId: 'conv-X',
      turnId: 'tour-X-0001',
      request: 'ajoute la classe X',
      debut,
      runGit: realGit,
      traces: [
        {
          timestamp: PENDANT,
          conversationId: 'conv-X',
          turnId: 'tour-X-0001',
          workspaceRoot: ouverte.chemin,
          source: 'chat_tool',
          paths: ['mine.cs'],
          pathLineFingerprints: { 'mine.cs': lignes('class X {}') }
        } satisfies ConversationFileTrace
      ],
      porte: {
        // Le dépôt d'où tourne l'application : ce n'est pas le dépôt du fil, la copie ne s'y range pas.
        depot: appli.depot,
        dossierDeDonnees,
        publication: {
          ouvrir: async () => {
            throw new Error('la porte ne doit pas ouvrir de copie pour un autre dépôt')
          },
          fermer: async () => undefined
        }
      }
    })

    expect(rapport?.project?.status).not.toBe('committed')
    expect(await git(autreDepot.depot, 'rev-parse', 'travail')).toBe(teteAutreDepotAvant)
    expect(await git(autreDepot.depot, 'ls-tree', '-r', '--name-only', 'travail')).not.toContain(
      'mine.cs'
    )
  })
})

/*
 * Le début du tour, côté fil : la copie d'un dépôt tiers s'ouvre pour une demande de travail, et une
 * question seule n'en ouvre pas. Le tri du dépôt (`estUnDepotGit`) est celui que `chat.ts` passe.
 */
describe('un fil rangé dans un dépôt tiers — ouverture de sa copie au début du tour', () => {
  it('une demande de travail ouvre la copie du dépôt tiers, rangée sous la racine unique', async () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-ouverture-tiers-')))
    dirs.push(racine)
    const autreDepot = await depotTemoin(racine, 'metier')
    const dossierDeDonnees = join(racine, 'donnees')
    const passages: Array<{ chemin: string; depot: string }> = []
    const issue = await preparerLeDossierDuTour({
      fil: { projectPath: autreDepot.depot },
      depotPartage: estUnDepotGit(autreDepot.depot) ? autreDepot.depot : null,
      actif: true,
      rienAEcrire: false,
      ouvrirCopie: () =>
        ouvrirLaCopieDuFilPourLeTour({
          dossierDeDonnees,
          depot: autreDepot.depot,
          conversationId: 'conv-R'
        }),
      passer: (copie) => passages.push(copie),
      revenir: () => {},
      annoncer: () => {}
    })
    expect(issue).toBe('ouverte')
    expect(passages).toHaveLength(1)
    expect(passages[0]?.depot).toBe(autreDepot.depot)
    expect(existsSync(passages[0]?.chemin ?? '')).toBe(true)
    expect(await git(passages[0]?.chemin ?? '', 'rev-parse', '--show-toplevel')).toBeTruthy()
  })

  it('une question seule n’ouvre aucune copie, et ne crée pas la racine des copies', async () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-question-tiers-')))
    dirs.push(racine)
    const autreDepot = await depotTemoin(racine, 'metier')
    const dossierDeDonnees = join(racine, 'donnees')
    const issue = await preparerLeDossierDuTour({
      fil: { projectPath: autreDepot.depot },
      depotPartage: autreDepot.depot,
      actif: true,
      rienAEcrire: true,
      ouvrirCopie: async () => {
        throw new Error('une question seule ne doit ouvrir aucune copie')
      },
      passer: () => {
        throw new Error('rien ne doit passer le fil dans une copie')
      },
      revenir: () => {},
      annoncer: () => {}
    })
    expect(issue).toBe('rien')
    expect(existsSync(racineDesCopiesDeTaches(dossierDeDonnees))).toBe(false)
  })
})
