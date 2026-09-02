/**
 * LES CANAUX DE L'INVENTAIRE DES CAPACITÉS, sortis de `src/main/index.ts`.
 *
 * Quatre canaux : lister une vue de capacités (skills, hooks, outils, plugins), lister les hooks
 * Claude, lister les hooks Codex, et activer ou désactiver un jeu d'outils.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * refus d'une vue de capacités inconnue. Trois règles de fond intactes :
 *   - la vue demandée est vérifiée contre une liste FERMÉE avant toute lecture de disque ;
 *   - une mutation lit l'état AVANT, puis compare : c'est cette comparaison qui rend le changement
 *     de configuration visible dans le journal, au lieu d'une simple ligne « ça a changé » ;
 *   - le changement est aussi rattaché à la conversation active quand il y en a une, et les écrans
 *     sont prévenus — sinon la vue continuerait d'afficher l'ancien état.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardBoolean, guardString } from '../ipc-guards'
import { listCapabilities, setCapabilityEnabled } from '../capability-controls'
import { listClaudeHooks, listCodexHooks } from '../claude-hooks'
import { promptConfigChange } from '../activity/prompt-config-change'
import { appendPromptConfigActivity } from '../activity/prompt-config-store'
import { appendConvActivity } from '../activity/conv-activity'
import type { AppEvent } from '../commands'

/** Ce que les canaux des capacités prenaient dans `index.ts` — désormais passé explicitement. */
export type CapabilitiesIpcDeps = {
  /** La conversation active à l'instant de l'appel : elle change au fil de l'usage. */
  lireConversationActive: () => string | undefined
  /** Prévenir les écrans que la configuration a changé. */
  broadcast: (e: AppEvent) => void
}

export function registerCapabilitiesIpc({
  lireConversationActive,
  broadcast
}: CapabilitiesIpcDeps): void {
  ipcMain.handle(
    'os:capabilities:list',
    (event, kind: 'skills' | 'hooks' | 'tools' | 'plugins') => {
      assertTrustedRendererSender(event, 'Capabilities')
      if (!['skills', 'hooks', 'tools', 'plugins'].includes(kind))
        throw new Error('Vue de capacités inconnue')
      return listCapabilities(kind)
    }
  )

  ipcMain.handle('claude:hooks:list', (event) => {
    assertTrustedRendererSender(event, 'Claude hooks')
    return listClaudeHooks()
  })
  ipcMain.handle('codex:hooks:list', (event) => {
    assertTrustedRendererSender(event, 'Codex hooks')
    return listCodexHooks()
  })
  ipcMain.handle('os:capabilities:tools:set', async (event, name: string, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Capabilities')
    const before = await listCapabilities('tools')
    const result = await setCapabilityEnabled(
      'tools',
      guardString(name, 'toolset'),
      guardBoolean(enabled, 'toolset.enabled')
    )
    const change = promptConfigChange('tools', before, result.items)
    appendPromptConfigActivity(`Prompt Load · toolset ${name}`, change)
    const conversationActive = lireConversationActive()
    if (conversationActive) {
      appendConvActivity(conversationActive, {
        kind: 'configuration-change',
        label: `Prompt Load · toolset ${name}`,
        text: JSON.stringify(change)
      })
    }
    broadcast({ type: 'refresh', scope: 'workflows' })
    return result
  })
}
