/**
 * LES CANAUX « Projet » : arborescence, lecture et écriture d'un fichier du projet courant.
 *
 * La racine n'est JAMAIS fournie par le renderer : c'est toujours l'espace de travail de l'app
 * (`os.executionWorkspace`). Le renderer ne manipule que des chemins RELATIFS, vérifiés sous cette
 * racine côté principal (voir `project-files.ts`). L'écriture ne crée aucun fichier.
 */
import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listProjectDir, readProjectFile, writeProjectFile } from '../project-files'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import type { AutowinOS } from '../os'

export function registerProjectFilesIpc({ os }: { os: AutowinOS }): void {
  ipcMain.handle('project:root', (event) => {
    assertTrustedRendererSender(event, 'ProjectRoot')
    return os.executionWorkspace
  })
  ipcMain.handle('project:list', (event, rawPath: unknown) => {
    assertTrustedRendererSender(event, 'ProjectList')
    return listProjectDir(os.executionWorkspace, typeof rawPath === 'string' ? rawPath : '')
  })
  ipcMain.handle('project:read', (event, rawPath: unknown) => {
    assertTrustedRendererSender(event, 'ProjectRead')
    return readProjectFile(os.executionWorkspace, guardString(rawPath, 'path'))
  })
  ipcMain.handle('project:write', (event, rawPath: unknown, rawContent: unknown) => {
    assertTrustedRendererSender(event, 'ProjectWrite')
    return writeProjectFile(
      os.executionWorkspace,
      guardString(rawPath, 'path'),
      guardString(rawContent, 'content')
    )
  })
  // Ouvre TOUT le projet courant dans VS Code. La racine vient du principal, jamais du renderer.
  // `code` est un .cmd sous Windows : il faut passer par le shell, chemin entre guillemets.
  ipcMain.handle('project:openInVscode', async (event) => {
    assertTrustedRendererSender(event, 'ProjectOpenInVscode')
    const cible = `"${os.executionWorkspace.replace(/"/g, '')}"`
    // 1. VS Code déjà présent (commande `code` dans le PATH) : on ouvre.
    if ((await executer('code', [cible])) === 0) return { ok: true, installe: false }
    // 2. Absent : installation par winget (VS Code officiel, portée utilisateur, sans question).
    const install = await executer('winget', [
      'install',
      '-e',
      '--id',
      'Microsoft.VisualStudioCode',
      '--scope',
      'user',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ])
    if (install !== 0) {
      return { ok: false, raison: `installation de VS Code par winget en échec (code ${install})` }
    }
    // 3. Le PATH du processus n'est pas rafraîchi : on lance l'exécutable à son emplacement connu.
    const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe')
    if (!existsSync(exe)) return { ok: false, raison: `VS Code installé mais introuvable : ${exe}` }
    spawn(exe, [os.executionWorkspace], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, installe: true }
  })
}

/** Lance une commande via le shell (les .cmd Windows l'exigent) et rend son code de sortie. */
function executer(commande: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    try {
      const enfant = spawn(commande, args, { shell: true, stdio: 'ignore', windowsHide: true })
      enfant.once('error', () => resolve(-1))
      enfant.once('exit', (code) => resolve(code ?? -1))
    } catch {
      resolve(-1)
    }
  })
}
