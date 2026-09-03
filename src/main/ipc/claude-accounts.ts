/**
 * LES CANAUX DES COMPTES CLAUDE MULTIPLES, sortis de `src/main/index.ts`.
 *
 * Quatre canaux : lister, ajouter, basculer, retirer. Un compte = un dossier de configuration
 * (`CLAUDE_CONFIG_DIR`), mecanisme verifie sur le CLI reel — basculer ne relance aucun login, les
 * sessions restent stockees cote a cote comme dans claude.exe.
 *
 * Deplacement MECANIQUE depuis `index.ts` : corps identiques, memes gardes d'expediteur. Les deux
 * fonctions d'aide (la mise en forme de la liste et la sonde d'identite) suivent leurs canaux — ils
 * etaient leurs seuls appelants.
 *
 * Trois comportements que le demenagement n'avait pas le droit de simplifier :
 *  - la sonde d'identite RETIRE explicitement le dossier de configuration herite du processus.
 *    Sans ce retrait, elle lirait l'identite d'un AUTRE compte que celui demande.
 *  - elle est bornee a 8 s et fail-open : une sonde muette laisse le compte tel quel plutot que
 *    de bloquer l'affichage de la liste.
 *  - ajouter un compte ENCHAINE sur le login dans son dossier : un compte jamais authentifie ne
 *    servirait a rien, et l'utilisateur n'a aucun moyen de le faire lui-meme depuis l'app.
 */
import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import {
  accountEnv,
  describeAccounts,
  parseIdentity,
  type ClaudeAccountsStore,
  type ClaudeIdentity,
  withClaudeAccountEnv
} from '../claude-accounts'
import { resolveClaudeBin } from '../providers/claude'
import { invalidateModelQuotaCache } from '../model-quotas'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import type { AutowinOS } from '../os'

/** Ce que les canaux des comptes Claude prenaient dans `index.ts` — desormais passe explicitement. */
export type ClaudeAccountsIpcDeps = {
  os: AutowinOS
  claudeAccounts: ClaudeAccountsStore
}

export function registerClaudeAccountsIpc({ os, claudeAccounts }: ClaudeAccountsIpcDeps): void {
  // --- Comptes Claude multiples : lister / basculer / ajouter / retirer ---
  // Un compte = un CLAUDE_CONFIG_DIR (mecanisme verifie sur le CLI reel). Basculer ne relance
  // aucun login : les sessions restent stockees cote a cote, comme dans claude.exe.
  const claudeAccountsPayload = (): {
    activeId: string
    accounts: Array<{
      id: string
      displayName: string
      tier: string
      email?: string
      active: boolean
    }>
  } => {
    const state = claudeAccounts.current()
    return {
      activeId: state.activeId,
      accounts: describeAccounts(state.accounts, state.activeId).map((account) => ({
        id: account.id,
        displayName: account.displayName,
        tier: account.tier,
        email: account.email,
        active: account.active
      }))
    }
  }

  /**
   * Sonde l'identite REELLE d'un compte : `claude auth status` dans SON dossier de configuration.
   * C'est le seul moyen de distinguer deux comptes qui partagent la meme adresse mail et ne
   * different que par le niveau d'abonnement (`subscriptionType`) — le cas d'usage demande.
   * Borne dans le temps et fail-open : une sonde muette laisse le compte tel quel, elle ne doit
   * jamais bloquer l'affichage de la liste.
   */
  const probeAccountIdentity = async (accountId: string): Promise<void> => {
    const account = claudeAccounts.find(accountId)
    if (!account) return
    const identity = await new Promise<ClaudeIdentity | undefined>((resolve) => {
      let out = ''
      let settled = false
      const done = (value: ClaudeIdentity | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => done(undefined), 8000)
      try {
        const child = spawn(resolveClaudeBin(), ['auth', 'status'], {
          windowsHide: true,
          shell: false,
          // EXPLICITE : pour le compte par defaut, accountEnv rend {} — sans retrait, la sonde
          // heriterait le CLAUDE_CONFIG_DIR du processus et lirait l'identite d'un AUTRE compte.
          env: withClaudeAccountEnv(process.env, accountEnv(account))
        })
        child.stdout?.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8')
        })
        child.on('error', () => done(undefined))
        child.on('close', () => done(parseIdentity(out)))
      } catch {
        done(undefined)
      }
    })
    claudeAccounts.setIdentity(accountId, identity)
  }

  /** Sonde TOUS les comptes en parallele — la liste ne vaut que si chaque puce dit vrai. */
  const refreshAllAccountIdentities = async (): Promise<void> => {
    await Promise.all(
      claudeAccounts.current().accounts.map((account) => probeAccountIdentity(account.id))
    )
  }

  ipcMain.handle('os:claudeAccounts:list', async (event) => {
    assertTrustedRendererSender(event, 'Claude accounts list')
    await refreshAllAccountIdentities()
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:add', (event, label: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts add')
    const account = claudeAccounts.add(typeof label === 'string' ? label : undefined)
    // On enchaine directement sur le login DANS LE DOSSIER DU NOUVEAU COMPTE : un compte ajoute
    // mais jamais authentifie ne servirait a rien, et l'utilisateur n'a aucun moyen de le faire
    // lui-meme depuis l'app.
    os.startProviderLogin('claude', account.dir)
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:switch', (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts switch')
    claudeAccounts.switchTo(guardString(id, 'id'))
    // Le quota appartient a l'ABONNEMENT : changer de compte rend le snapshot memorise caduc,
    // sinon l'indicateur affiche encore celui du compte quitte pendant une minute.
    invalidateModelQuotaCache()
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:remove', (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts remove')
    claudeAccounts.remove(guardString(id, 'id'))
    return claudeAccountsPayload()
  })
}
