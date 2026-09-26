/**
 * LES CANAUX « Projet » : arborescence, lecture et écriture d'un fichier du projet courant.
 *
 * La racine n'est JAMAIS fournie par le renderer : il ne transmet qu'un identifiant de conversation,
 * et le principal en deduit le dossier de travail (CWD) de cette conversation, avec la meme regle que
 * les tours de chat (`dossierDeTravailDuTour`), repli sur `os.executionWorkspace`. Sans cela, changer
 * de CWD laissait l'onglet sur le dossier global (demande du 2026-09-24). Le renderer ne manipule que des chemins RELATIFS, vérifiés sous cette
 * racine côté principal (voir `project-files.ts`). L'écriture ne crée aucun fichier.
 */
import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { listProjectDir, readProjectFile, writeProjectFile } from '../project-files'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import { dossierDeTravailDuTour } from '../bascule-dossier-conversation'
import type { AutowinOS } from '../os'

export function registerProjectFilesIpc({ os }: { os: AutowinOS }): void {
  const racine = (rawConv: unknown): string =>
    dossierDeTravailDuTour(
      typeof rawConv === 'string' && rawConv
        ? os.conversations?.get?.(rawConv)?.projectPath
        : undefined,
      os.executionWorkspace
    )
  ipcMain.handle('project:root', (event, rawConv: unknown) => {
    assertTrustedRendererSender(event, 'ProjectRoot')
    return racine(rawConv)
  })
  /*
   * « CE FICHIER EXISTE-T-IL ? » — lecture seule, pour le mode auto (conv-826) : une suite « quand
   * fin.txt existe » n'est relancée (tour payé) que si le fichier est là. Répond vrai/faux, jamais
   * un contenu ni un listing ; `null` = chemin relatif sans dossier de base absolu (on ne sait pas).
   */
  ipcMain.handle('fs:exists', async (event, rawPath: unknown, rawBase: unknown) => {
    assertTrustedRendererSender(event, 'FsExists')
    const chemin = guardString(rawPath, 'path').trim()
    const base = typeof rawBase === 'string' ? guardString(rawBase, 'base').trim() : ''
    if (!chemin) return null
    // Sans dossier de conversation, le relatif part de l'espace de travail de l'app : rendre `null`
    // faisait retomber le renderer sur un tour PAYÉ (mesuré conv-826, 14:22, fin.txt absent).
    const racine = isAbsolute(base) ? base : os.executionWorkspace
    const cible = isAbsolute(chemin) ? chemin : isAbsolute(racine) ? join(racine, chemin) : null
    if (!cible) return null
    return stat(cible).then(
      () => true,
      () => false
    )
  })
  ipcMain.handle('project:list', (event, rawPath: unknown, rawConv: unknown) => {
    assertTrustedRendererSender(event, 'ProjectList')
    return listProjectDir(racine(rawConv), typeof rawPath === 'string' ? rawPath : '')
  })
  ipcMain.handle('project:read', (event, rawPath: unknown, rawConv: unknown) => {
    assertTrustedRendererSender(event, 'ProjectRead')
    return readProjectFile(racine(rawConv), guardString(rawPath, 'path'))
  })
  ipcMain.handle('project:write', (event, rawPath: unknown, rawContent: unknown, rawConv: unknown) => {
    assertTrustedRendererSender(event, 'ProjectWrite')
    return writeProjectFile(
      racine(rawConv),
      guardString(rawPath, 'path'),
      guardString(rawContent, 'content')
    )
  })
  // Ouvre TOUT le projet courant dans VS Code. La racine vient du principal, jamais du renderer.
  // `code` est un .cmd sous Windows : il faut passer par le shell, chemin entre guillemets.
  ipcMain.handle('project:openInVscode', async (event, rawConv: unknown) => {
    assertTrustedRendererSender(event, 'ProjectOpenInVscode')
    const dossier = racine(rawConv)
    const cible = `"${dossier.replace(/"/g, '')}"`
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
    spawn(exe, [dossier], { detached: true, stdio: 'ignore' }).unref()
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
