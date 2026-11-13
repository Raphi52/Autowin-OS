import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  demandesDuFil,
  type ConversationPourLaCarte,
  type MessageStockePourLaCarte
} from './carte-des-besoins'
import type { ArriveeDuTour } from './arrivee-sur-main'
import { depotPrincipalSurDisque } from '../git/depot-git'

/**
 * ARRIVÉ SUR MAIN — le journal de main lu est celui du dépôt de l'app. Il ne juge que les fils qui
 * travaillent dans ce dépôt.
 *
 * Défaut mesuré sur les données du poste : un fil rangé dans `D:\WebTesting` (hors de tout dépôt) avait
 * sa demande du 23/09 (12:20 UTC) classée « refusé — pas encore arrivé sur main », parce que le seul
 * commit de ce fil dans le journal de main de `D:\AutoWinOS` datait de 11:22. Ce journal ne pouvait
 * rien dire de ce fil.
 *
 * L'entrée qui fait échouer une correction fausse : la copie d'un AUTRE dépôt rangée physiquement SOUS
 * le dossier de l'app (les copies de fil des autres projets vivent sous
 * `D:\AutoWinOS\.autowin-data\autowin-os\copies-de-taches\`). Une correction qui comparerait les
 * chemins par préfixe la croirait dans le dépôt de l'app et la refuserait encore.
 */
// fix-ok: cause mesurée — le garde `separation-entreprise.test.ts` refusait ce fichier : ses commentaires
// citaient le dossier d'un projet d'entreprise et un nom court Windows personnel ; ils parlent désormais
// d'« un autre projet du poste ».

const user = (content: string, ts: number): MessageStockePourLaCarte =>
  ({ role: 'user', content, ts, messageId: `message-${ts}` }) as MessageStockePourLaCarte

/** Un vert qui attend seulement que la base se libère (même forme que dans `arrivee-sur-main.test.ts`). */
const enAttenteDePublication = {
  kind: 'action',
  name: 'orchestrate',
  ok: true,
  data: {
    gateBlocked: true,
    gateReasons: [
      'intégration locale non terminée',
      'blocage d’intégration: base-dirty — fichiers en cause: AGENTS.md'
    ]
  }
}

const filEnAttente = (id: string, projectPath?: string): ConversationPourLaCarte => ({
  id,
  title: 'fil de test',
  ...(projectPath === undefined ? {} : { projectPath }),
  messages: [
    user('construis', 1),
    {
      role: 'assistant',
      content: '',
      status: 'completed',
      ts: 2,
      turnId: 'tour-sans-trace',
      parts: [enAttenteDePublication]
    } as unknown as MessageStockePourLaCarte
  ]
})

let racine = ''
/** Le dépôt de l'app : celui dont le journal de main est lu. */
let depotDeLApp = ''
/** Une copie de travail du dépôt de l'app, rangée sous lui (copie de fil d'Autowin). */
let copieDeLApp = ''
/** Un autre dépôt (un autre projet du poste). */
let autreDepot = ''
/** Une copie de l'AUTRE dépôt, rangée physiquement sous le dossier de l'app. */
let copieDeLAutreSousLApp = ''
/** Un dossier hors de tout dépôt git (comme `D:\WebTesting`). */
let horsDepot = ''

/** Une copie liée (`git worktree`) telle que git l'écrit sur disque : `.git` fichier + `commondir`. */
function copieLiee(depot: string, copie: string, nom: string): void {
  const dossierGitDeLaCopie = join(depot, '.git', 'worktrees', nom)
  mkdirSync(dossierGitDeLaCopie, { recursive: true })
  writeFileSync(join(dossierGitDeLaCopie, 'commondir'), '../..\n')
  mkdirSync(copie, { recursive: true })
  writeFileSync(join(copie, '.git'), `gitdir: ${dossierGitDeLaCopie.replace(/\\/g, '/')}\n`)
}

beforeAll(() => {
  // Chemin long réel : sous Windows, `tmpdir()` peut rendre un dossier en nom court (8.3).
  racine = realpathSync.native(mkdtempSync(join(tmpdir(), 'arrivee-autre-depot-')))
  depotDeLApp = join(racine, 'appli')
  mkdirSync(join(depotDeLApp, '.git'), { recursive: true })
  autreDepot = join(racine, 'autre')
  mkdirSync(join(autreDepot, '.git'), { recursive: true })
  copieDeLApp = join(depotDeLApp, '.autowin-data', 'copies', 'conv-a')
  copieLiee(depotDeLApp, copieDeLApp, 'conv-a')
  copieDeLAutreSousLApp = join(depotDeLApp, '.autowin-data', 'copies', 'conv-b')
  copieLiee(autreDepot, copieDeLAutreSousLApp, 'conv-b')
  horsDepot = join(racine, 'hors-depot')
  mkdirSync(horsDepot)
})

afterAll(() => {
  rmSync(racine, { recursive: true, force: true })
})

/** Le journal de main de l'app dit « aucun commit du fil après la demande » ; aucune trace de run. */
function journalDeLApp(filApres: (conversationId: string, depuis: number) => boolean | undefined) {
  const lu = vi.fn(filApres)
  const arrivee: ArriveeDuTour = Object.assign(() => undefined, {
    filApres: lu,
    depotDuJournal: depotDeLApp
  })
  return { arrivee, lu }
}

describe('le journal de main de l’app ne juge que les fils de son dépôt', () => {
  it('le décor est bien celui qu’il prétend être (sinon les tests ci-dessous ne prouvent rien)', () => {
    expect(depotPrincipalSurDisque(horsDepot)).toBeUndefined()
    expect(depotPrincipalSurDisque(copieDeLApp)).toBe(depotDeLApp)
    expect(depotPrincipalSurDisque(copieDeLAutreSousLApp)).toBe(autreDepot)
  })

  it('fil rangé hors de tout dépôt (conv-798, D:\\WebTesting) : arrivée inconnue, pas refusé', () => {
    const { arrivee, lu } = journalDeLApp(() => false)
    const [demande] = demandesDuFil(filEnAttente('conv-798', horsDepot), arrivee)
    expect(demande).toMatchObject({
      statut: 'sans-preuve',
      constat: 'en attente de publication — arrivée sur main inconnue'
    })
    expect(lu).not.toHaveBeenCalled()
  })

  it('fil rangé dans un autre dépôt : le journal de l’app ne le refuse pas', () => {
    const { arrivee, lu } = journalDeLApp(() => false)
    const [demande] = demandesDuFil(filEnAttente('conv-900', autreDepot), arrivee)
    expect(demande.statut).toBe('sans-preuve')
    expect(lu).not.toHaveBeenCalled()
  })

  it('fil rangé dans la copie d’un autre dépôt posée SOUS le dossier de l’app : pas refusé non plus', () => {
    // L'entrée qui fait échouer une comparaison de chemins par préfixe.
    const { arrivee, lu } = journalDeLApp(() => false)
    const [demande] = demandesDuFil(filEnAttente('conv-1864', copieDeLAutreSousLApp), arrivee)
    expect(demande.statut).toBe('sans-preuve')
    expect(lu).not.toHaveBeenCalled()
  })

  it('un journal d’un autre dépôt qui dirait « arrivé » ne prouve rien non plus', () => {
    const { arrivee } = journalDeLApp(() => true)
    const [demande] = demandesDuFil(filEnAttente('conv-900', autreDepot), arrivee)
    expect(demande.statut).toBe('sans-preuve')
  })

  // Jumeaux acceptés : la même attente, pour un fil qui travaille bien dans le dépôt de l'app.
  it('fil rangé dans une copie de travail du dépôt de l’app : le journal répond (refusé)', () => {
    const { arrivee, lu } = journalDeLApp(() => false)
    const [demande] = demandesDuFil(filEnAttente('conv-1856', copieDeLApp), arrivee)
    expect(demande).toMatchObject({
      statut: 'refuse',
      constat: 'en attente de publication — pas encore arrivé sur main'
    })
    expect(lu).toHaveBeenCalledWith('conv-1856', 1)
  })

  it('fil rangé dans le dossier de l’app lui-même, écrit autrement : le journal répond (prouvé)', () => {
    const { arrivee } = journalDeLApp(() => true)
    const [demande] = demandesDuFil(filEnAttente('conv-1905', `${depotDeLApp}\\`), arrivee)
    expect(demande.statut).toBe('prouve')
    expect(demande.constat).toContain('lien par le fil')
  })

  it('fil sans dossier rangé : il travaille dans le dépôt de l’app, le journal répond', () => {
    const { arrivee } = journalDeLApp(() => false)
    const [demande] = demandesDuFil(filEnAttente('conv-1585'), arrivee)
    expect(demande.statut).toBe('refuse')
  })

  it('dépôt du journal inconnu : un fil rangé ailleurs n’est pas jugé par ce journal', () => {
    const lu = vi.fn(() => false)
    const arrivee: ArriveeDuTour = Object.assign(() => undefined, { filApres: lu })
    const [demande] = demandesDuFil(filEnAttente('conv-900', autreDepot), arrivee)
    expect(demande.statut).toBe('sans-preuve')
    expect(lu).not.toHaveBeenCalled()
  })
})
