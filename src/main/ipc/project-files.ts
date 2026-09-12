/**
 * LES CANAUX « Projet » : arborescence, lecture et écriture d'un fichier du projet courant.
 *
 * La racine n'est JAMAIS fournie par le renderer : c'est toujours l'espace de travail de l'app
 * (`os.executionWorkspace`). Le renderer ne manipule que des chemins RELATIFS, vérifiés sous cette
 * racine côté principal (voir `project-files.ts`). L'écriture ne crée aucun fichier.
 */
import { ipcMain } from 'electron'
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
}
