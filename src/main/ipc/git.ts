/**
 * LES CANAUX GIT, sortis de `src/main/index.ts`.
 *
 * Six canaux, tous en LECTURE SEULE : l'état d'un dépôt (branche, changements), la frise de
 * commits, le diff d'un fichier, le sélecteur de dépôt, puis les deux lectures rattachées à une
 * conversation (l'état et le diff de SA copie de travail).
 *
 * DEUX actions git seulement, et elles sont nommées : `git:checkout` (bascule de branche) et
 * `git:action` (le glisser-déposer du graphe, liste blanche de deux gestes en AVANT). Pas de commit,
 * pas de push, aucune réécriture d'histoire. C'est le contrat de ce module ; tout le reste y est en
 * LECTURE SEULE.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * replis de `cwd`. Deux points que le déménagement n'a pas le droit de simplifier :
 *  - `git:graph` se rabat sur `AUTOWIN_OS_WORKSPACE` avant `process.cwd()`, les trois autres non ;
 *  - `git:conversationDiff` normalise le chemin reçu (antislashs, `./` en tête) AVANT de le lire.
 */
import { ipcMain } from 'electron'
import { readGitGraph } from '../git-graph-main'
import { readGitState, readGitDiff, readGitBranches } from '../git-read-main'
import { checkoutBranch } from '../git-checkout-main'
import { executerActionGit, type DemandeActionGit } from '../git-action-main'
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
  /*
    LA SEULE action git de ce canal : basculer sur une branche LOCALE existante, refusée si l'arbre
    de travail est sale. Elle rend un motif explicite au lieu d'échouer en silence.
  */
  ipcMain.handle('git:checkout', (event, branch: string, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitCheckout')
    return checkoutBranch(
      cwd && typeof cwd === 'string' ? cwd : process.cwd(),
      typeof branch === 'string' ? branch : ''
    )
  })
  /*
    LA DEUXIEME action git de ce module, et la DERNIERE : le glisser-deposer du graphe (demande
    utilisateur du 2026-09-15). Elle ne recoit PAS de ligne de commande — seulement un type de geste
    et des noms, que `git-action-main` valide puis assemble. Deux gestes en liste blanche, tous deux
    en AVANT (fusionner une branche, rapporter un commit) ; `rebase`, `reset`, `branch -f` et
    `push --force` sont refuses la-bas, par construction et non par convention.
  */
  ipcMain.handle('git:action', (event, demande: unknown, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitAction')
    const brut = (demande ?? {}) as Record<string, unknown>
    const type = typeof brut.type === 'string' ? brut.type : ''
    const cible = typeof brut.cible === 'string' ? brut.cible : ''
    const depot = cwd && typeof cwd === 'string' ? cwd : process.cwd()
    if (type === 'merge')
      return executerActionGit(depot, {
        type: 'merge',
        source: typeof brut.source === 'string' ? brut.source : '',
        cible
      })
    if (type === 'cherry-pick')
      return executerActionGit(depot, {
        type: 'cherry-pick',
        commit: typeof brut.commit === 'string' ? brut.commit : '',
        cible
      })
    // Un type inconnu ne descend pas plus bas : le refus est NOMME, jamais silencieux.
    return executerActionGit(depot, { type } as unknown as DemandeActionGit)
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
