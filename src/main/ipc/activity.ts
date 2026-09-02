/**
 * LES CANAUX DE L'ACTIVITÉ (sessions consultées et leurs captures), sortis de `src/main/index.ts`.
 *
 * Ils exposent en LECTURE SEULE l'inventaire des sessions et une image déjà présente dans un
 * transcript autorisé. Rien n'y est écrit, et aucun chemin fourni par la fenêtre n'est ouvert tel
 * quel : il doit d'abord être RECONNU par `resolveListedSessionImage`.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur, validations,
 * liste d'extensions et plafond de taille inchangés. Ce module ne prenait RIEN dans `index.ts` —
 * ses quatre fonctions viennent toutes de `./activity/transcripts` —, il n'a donc aucune
 * dépendance à recevoir.
 */
import { ipcMain } from 'electron'
import {
  listSessionsAsync,
  parseSession,
  resolveListedSessionAsync,
  resolveListedSessionImage
} from '../activity/transcripts'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'

export function registerActivityIpc(): void {
  ipcMain.handle('os:activity:sessions', (event) => {
    assertTrustedRendererSender(event, 'Activity sessions')
    return listSessionsAsync(60)
  })
  ipcMain.handle('os:activity:session', async (event, ref: unknown) => {
    assertTrustedRendererSender(event, 'Activity session')
    if (!ref || typeof ref !== 'object') throw new Error('Référence de session invalide')
    const raw = ref as Record<string, unknown>
    const session = await resolveListedSessionAsync({
      id: guardString(raw.id, 'session.id'),
      project: guardString(raw.project, 'session.project')
    })
    if (!session) throw new Error('Session non autorisée ou hors inventaire')
    return parseSession(session)
  })

  // Affichage des screenshots consultés : whitelist extensions + cap taille, lecture seule.
  ipcMain.handle('os:activity:image', async (event, ref: unknown, path: string) => {
    assertTrustedRendererSender(event, 'ActivityImage')
    if (!ref || typeof ref !== 'object') throw new Error('Référence de session invalide')
    const raw = ref as Record<string, unknown>
    const p = guardString(path, 'path')
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) throw new Error('extension non autorisée')
    const authorizedPath = await resolveListedSessionImage(
      {
        id: guardString(raw.id, 'session.id'),
        project: guardString(raw.project, 'session.project')
      },
      p
    )
    if (!authorizedPath) throw new Error('Image absente des transcripts autorisés')
    const { statSync, readFileSync } = await import('node:fs')
    if (statSync(authorizedPath).size > 8_000_000) throw new Error('image trop volumineuse')
    const ext = p.split('.').pop()!.toLowerCase()
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return { dataUrl: `data:${mime};base64,${readFileSync(authorizedPath).toString('base64')}` }
  })
}
