/**
 * LES CANAUX DE LA VUE TESTS, sortis de `src/main/index.ts`.
 *
 * Quatre canaux : lister les projets du registre, l'enregistrer, choisir un dossier, lancer les
 * tests d'un projet.
 *
 * La vue est MULTI-PROJETS : le registre porte des racines quelconques, elle ne connaît pas « le »
 * dépôt de l'application mais une liste. Le workspace courant y est semé au premier appel pour que
 * l'écran ne soit pas vide — aucun privilège n'est attaché à cette entrée.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur. La
 * protection de `tests:run` est recopiée telle quelle et compte : une racine reçue de la fenêtre
 * doit d'abord être RETROUVÉE dans le registre, sinon l'appel est refusé. Sans elle, un chemin
 * arbitraire ferait lancer des tests n'importe où.
 */
import { ipcMain } from 'electron'
import {
  ensureTestProjects,
  inspectProject,
  loadTestProjects,
  runProjectTests,
  saveTestProjects
} from '../tests-view-main'
import { assertTrustedRendererSender } from '../ipc-senders'
import type { AutowinOS } from '../os'

/** Ce que les canaux de la vue Tests prenaient dans `index.ts` — désormais passé explicitement. */
export type TestsViewIpcDeps = {
  os: AutowinOS
  /** Ouvre le sélecteur de dossier natif : une fenêtre, pas un chemin fourni par le renderer. */
  pickDirectory: (sender: Electron.WebContents) => Promise<string | null>
}

export function registerTestsViewIpc({ os, pickDirectory }: TestsViewIpcDeps): void {
  // Vue Tests — MULTI-PROJETS. Le registre porte des racines quelconques : la vue ne connait pas
  // « le » depot de l'app, elle connait une liste. Le workspace courant y est seme au premier appel
  // pour que l'ecran ne soit pas vide, mais il n'y a aucun privilege attache a cette entree.
  ipcMain.handle('tests:projects', (event) => {
    assertTrustedRendererSender(event, 'TestsProjects')
    return ensureTestProjects(os.executionWorkspace).map((projet) => inspectProject(projet))
  })
  ipcMain.handle('tests:saveProjects', (event, projects: unknown) => {
    assertTrustedRendererSender(event, 'TestsSaveProjects')
    return saveTestProjects(projects).map((projet) => inspectProject(projet))
  })
  ipcMain.handle('tests:pickProject', async (event) => {
    assertTrustedRendererSender(event, 'TestsPickProject')
    return pickDirectory(event.sender)
  })
  ipcMain.handle('tests:run', (event, root: unknown, filter?: unknown) => {
    assertTrustedRendererSender(event, 'TestsRun')
    const racine = String(root ?? '')
    const projet = loadTestProjects().find((p) => p.root === racine)
    if (!projet) throw new Error('projet inconnu du registre des tests')
    return runProjectTests(projet, {
      ...(typeof filter === 'string' && filter.trim() ? { filter: filter.trim() } : {})
    })
  })
}
