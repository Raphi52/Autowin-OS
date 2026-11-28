import { registerWorktreeIpc, type WorktreeFixtureDeTest } from './worktree'
import { ipcMain, BrowserWindow } from 'electron'
import { evenementRefusIntegration } from '../activity/ledger'
import { assertTrustedRendererSender } from './ipc-senders'
import type { SuiviDesPlans } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LA FIN D’UN RUN : clôture automatique, publication après un fil, copies de travail et leur
 * activité, refus d’intégration comptés au ledger.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `registerClotureDesRunsIpc` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesClotureDesRuns {
  suiviDesPlans: SuiviDesPlans
}

/** IPC : clôture des runs et copies de travail. */
export function registerClotureDesRunsIpc(
  ctx: ContexteIpcChat,
  deps: DependancesClotureDesRuns
): void {
  const { isolatedTestInstance, ledger, os } = ctx
  const { suiviDesPlans } = deps
  // Racine du Brain partagé : permet à Source control de basculer sur SON dépôt git en un clic
  // (les notes du Brain sont versionnées comme le code). Lecture seule, aucun secret exposé.
  // Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut.
  ipcMain.handle('run:autoClose:get', (event) => {
    assertTrustedRendererSender(event, 'AutoClose')
    return os.getAutoClose()
  })
  ipcMain.handle('run:autoClose:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'AutoClose')
    os.setAutoClose(enabled === true)
    return os.getAutoClose()
  })
  ipcMain.handle('run:gitApresFil:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'GitApresFil')
    os.setGitApresFil(enabled === true)
    return os.getAutoClose()
  })
  // Les canaux des copies de travail vivent dans src/main/ipc/worktree.ts. La fixture de test
  // reste posee d'ici (canal `app:test:worktree-fixture`), mais l'etat vit la-bas.
  const worktreeIpc = registerWorktreeIpc({ os })
  ipcMain.handle('app:test:worktree-fixture', (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Fixture worktree')
    if (!isolatedTestInstance) throw new Error('Fixture worktree indisponible hors instance isolée')
    if (!value || typeof value !== 'object') throw new Error('Fixture worktree invalide')
    const fixture = value as Record<string, unknown>
    if (!Array.isArray(fixture.activity) || !fixture.status || typeof fixture.status !== 'object') {
      throw new Error('Fixture worktree incomplète')
    }
    const nextFixture = fixture as WorktreeFixtureDeTest
    worktreeIpc.poserFixtureDeTest(nextFixture)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('worktree:activity-changed', nextFixture.activity)
    }
    return true
  })
  os.onWorktreeActivity((activity) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send('worktree:activity-changed', activity)
    // Un lot qui attend sa publication passe « fait » quand son travail gardé de côté est publié.
    suiviDesPlans.coordinateur?.surActiviteDesRuns(activity)
  })
  // COMPTER les refus d'intégration. Rien ne les comptait : `trace.json` n'a pas de champ `reason`
  // (ses occurrences du mot sont du code source cité par des agents), les 1995 RUN.md n'en gardent
  // rien, et le journal de conversations est rotatif. Un chantier antérieur s'est pourtant priorisé
  // sur un décompte tiré de cet artefact. Ici l'événement est ÉMIS, jamais lu d'un fichier : il ne
  // peut pas se polluer de la même façon.
  os.onRefusIntegration((refus) => ledger.append(evenementRefusIntegration(refus)))
}
