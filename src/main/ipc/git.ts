/**
 * LES CANAUX GIT, sortis de `src/main/index.ts`.
 *
 * Six canaux, tous en LECTURE SEULE : l'état d'un dépôt (branche, changements), la frise de
 * commits, le diff d'un fichier, le sélecteur de dépôt, puis les deux lectures rattachées à une
 * conversation (l'état et le diff de SA copie de travail).
 *
 * Aucune ACTION git ici — pas de commit, pas de push, pas de checkout. C'est le contrat de ce
 * module, et le déplacement ne l'élargit pas.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * replis de `cwd`. Deux points que le déménagement n'a pas le droit de simplifier :
 *  - `git:graph` se rabat sur `AUTOWIN_OS_WORKSPACE` avant `process.cwd()`, les trois autres non ;
 *  - `git:conversationDiff` normalise le chemin reçu (antislashs, `./` en tête) AVANT de le lire.
 */
import { ipcMain } from 'electron'
import { readGitGraph } from '../git-graph-main'
import { readGitState, readGitDiff, readGitBranches } from '../git-read-main'
import {
  readConversationGitDiff,
  readConversationGitState
} from '../activity/conversation-git-state'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import type { AutowinOS } from '../os'

/** Ce que les canaux git prenaient dans `index.ts` — désormais passé explicitement. */
export type GitIpcDeps = {
  os: AutowinOS
  /** Ouvre le sélecteur de dossier natif : une fenêtre, pas un chemin fourni par le renderer. */
  pickDirectory: (sender: Electron.WebContents) => Promise<string | null>
}

export function registerGitIpc({ os, pickDirectory }: GitIpcDeps): void {
  // Source control : lecture git READ-ONLY (statut/branche/changements/historique). Aucune action git ici.
  // Le dépôt lu est configurable (multi-repo) : le renderer fournit un cwd (défaut = cwd de l'app).
  ipcMain.handle('git:read', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitRead')
    return readGitState(cwd && typeof cwd === 'string' ? cwd : process.cwd())
  })
  // Branches LOCALES d'un dépôt, pour le sélecteur de la barre du chat. Lecture seule.
  ipcMain.handle('git:branches', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitBranches')
    return readGitBranches(cwd && typeof cwd === 'string' ? cwd : process.cwd())
  })
  // Historique git : la frise de commits de la vue Worktrees. Lecture seule, bornée côté main.
  ipcMain.handle('git:graph', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitGraph')
    return readGitGraph(
      cwd && typeof cwd === 'string' ? cwd : (process.env.AUTOWIN_OS_WORKSPACE ?? process.cwd())
    )
  })
  ipcMain.handle('git:diff', (event, path: string, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitDiff')
    return readGitDiff(cwd && typeof cwd === 'string' ? cwd : process.cwd(), String(path ?? ''))
  })
  // Selecteur de depot (dialogue dossier, read-only) → renvoie le chemin choisi ou null si annulé.
  ipcMain.handle('git:pickRepo', async (event) => {
    assertTrustedRendererSender(event, 'GitPickRepo')
    return pickDirectory(event.sender)
  })
  ipcMain.handle('git:conversationRead', async (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'ConversationGitRead')
    const safeConversationId = guardString(conversationId, 'conversationId')
    return readConversationGitState(safeConversationId, os.executionWorkspace)
  })
  ipcMain.handle(
    'git:conversationDiff',
    async (event, conversationId: unknown, rawPath: unknown, rawWorkspaceRoot: unknown) => {
      assertTrustedRendererSender(event, 'ConversationGitDiff')
      const safeConversationId = guardString(conversationId, 'conversationId')
      const path = guardString(rawPath, 'path')
        .replaceAll('\\', '/')
        .replace(/^\.\/+/, '')
      const requestedRoot = guardString(rawWorkspaceRoot, 'workspaceRoot')
      return readConversationGitDiff(safeConversationId, path, requestedRoot)
    }
  )
}
