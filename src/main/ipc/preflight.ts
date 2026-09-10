/**
 * LES CANAUX DU DIAGNOSTIC DE PRÉREQUIS, sortis de `src/main/index.ts`.
 *
 * Trois canaux : réparer un prérequis rouge d'un clic (connexion OAuth, démarrage du brain_server),
 * relancer le diagnostic, relire le dernier résultat connu.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * refus silencieux de `repair` quand l'identifiant reçu n'est pas une chaîne. La règle de fond ne
 * bouge pas : `repair` rend ce qui a été LANCÉ, jamais un verdict — le verdict appartient au
 * re-diagnostic.
 *
 * Une seule dépendance à recevoir : la liste des fournisseurs en veille. Elle se calcule dans
 * `index.ts` à partir de l'état des fournisseurs, et elle doit être lue AU MOMENT de l'appel, pas
 * figée au démarrage — d'où une fonction et non une valeur.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { appPreflightProbes, getLastAppPreflightResult, runAppPreflight } from '../preflight-probes'
import { repairPreflightCheck } from '../preflight-repair'
import { assertTrustedRendererSender } from '../ipc-senders'
import type { RoutedProvider } from '../routed-providers'

/** Ce que les canaux de prérequis prenaient dans `index.ts` — désormais passé explicitement. */
export type PreflightIpcDeps = {
  /** Les fournisseurs en veille à l'instant de l'appel : lus à chaque diagnostic, jamais figés. */
  preflightProviderOptions: () => { standbyProviders: RoutedProvider[] }
}

export function registerPreflightIpc({ preflightProviderOptions }: PreflightIpcDeps): void {
  // RÉPARER un prérequis rouge d'un clic (login OAuth, démarrage brain_server) au lieu de faire
  // recopier une commande. Renvoie ce qui a été LANCÉ — le verdict reste au re-diagnostic.
  ipcMain.handle('preflight:repair', (event, checkId?: unknown) => {
    assertTrustedRendererSender(event, 'Preflight')
    if (typeof checkId !== 'string') {
      return { started: false, detail: 'Prérequis inconnu.' }
    }
    return repairPreflightCheck(checkId, { pingBrain: () => appPreflightProbes().pingBrain() })
  })
  ipcMain.handle('preflight:recheck', async (event, force?: boolean) => {
    assertTrustedRendererSender(event, 'Preflight')
    const result = await runAppPreflight(force === true, preflightProviderOptions())
    /*
     * UN DIAGNOSTIC RELANCÉ VAUT POUR TOUTE L'APP, PAS POUR LA SEULE PAGE QUI L'A DEMANDÉ.
     * Mesure 2026-09-10 : au démarrage un prérequis rouge allume la pastille de l'onglet Settings
     * (App.tsx) ; la surveillance de démarrage s'arrête dès que le rouge n'est pas `brain`. Quand
     * l'utilisateur répare puis relance le diagnostic, la page passait au vert mais la pastille
     * restait allumée — seul `preflight:result` l'éteint, et personne ne l'émettait plus. On
     * rediffuse donc le résultat du re-diagnostic : une seule source de vérité pour tout l'écran.
     */
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('preflight:result', result)
    return result
  })
  ipcMain.handle('preflight:current', (event) => {
    assertTrustedRendererSender(event, 'Preflight')
    return getLastAppPreflightResult()
  })
}
