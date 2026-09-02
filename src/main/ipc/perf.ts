/**
 * LES CANAUX DE L'ONGLET LATENCE, sortis de `src/main/index.ts`.
 *
 * Trois canaux : la latence des derniers tours, les gels du process principal, et le SIGNALEMENT
 * d'un gel venu de la fenêtre.
 *
 * Les deux premiers sont en lecture seule et bornés aux derniers tours (200 par défaut). Le
 * troisième est le seul à écrire — et il écrit dans le MÊME journal que les gels du process
 * principal, par l'unique puits d'écriture existant : pas de second chemin. C'est le préfixe
 * `renderer:` qui permet ensuite de trancher « c'est le fond » ou « c'est l'interface » en relisant
 * `gels.jsonl`.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * bornes. La racine des données est reçue telle quelle et résolue à CHAQUE appel, comme avant.
 */
import { ipcMain } from 'electron'
import { ensureAutowinAppData } from '../app-data'
import { lireLatenceTours } from '../perf-lag-main'
import { journaliserGel, lireGels } from '../gel-main'
import { assertTrustedRendererSender } from '../ipc-senders'

/** Ce que les canaux de latence prenaient dans `index.ts` — désormais passé explicitement. */
export type PerfIpcDeps = {
  /** La racine des données de l'application, résolue à chaque appel comme dans `index.ts`. */
  appDataRoot: string
}

export function registerPerfIpc({ appDataRoot }: PerfIpcDeps): void {
  // Onglet Latence de la vue Tests : rapport LU du journal de jalons ecrit par `turn-timing.ts`.
  // Lecture seule, bornee aux derniers tours.
  ipcMain.handle('perf:turnLatency', (event, derniers?: unknown) => {
    assertTrustedRendererSender(event, 'PerfTurnLatency')
    const n = typeof derniers === 'number' && derniers > 0 ? Math.floor(derniers) : 200
    return lireLatenceTours(ensureAutowinAppData(appDataRoot), n)
  })
  // Onglet Latence : gels REELS du process main, dates et attribues a une operation.
  ipcMain.handle('perf:gels', (event, derniers?: unknown) => {
    assertTrustedRendererSender(event, 'PerfGels')
    const n = typeof derniers === 'number' && derniers > 0 ? Math.floor(derniers) : 200
    return lireGels(ensureAutowinAppData(appDataRoot), n)
  })
  /*
   * Gels du RENDERER, deposes dans le MEME journal que ceux du main.
   *
   * Le detecteur de gel ne surveille que le process principal : un freeze de la fenetre cause par
   * le thread d'interface n'etait attribuable NULLE PART apres coup. Le renderer signale donc ses
   * taches longues ici, et elles passent par l'unique puits d'ecriture existant — pas de second
   * chemin d'ecriture. Le prefixe 'renderer:' est ce qui permet enfin de trancher main vs
   * interface en relisant gels.jsonl.
   */
  ipcMain.handle('perf:gelRenderer', (event, dureeMs: unknown) => {
    assertTrustedRendererSender(event, 'PerfGelRenderer')
    const ms = typeof dureeMs === 'number' && Number.isFinite(dureeMs) ? Math.floor(dureeMs) : 0
    if (ms <= 0) return false
    journaliserGel({
      ts: new Date().toISOString(),
      blocageMs: ms,
      operation: 'renderer:longtask',
      // Mesure DIRECTE d'une tache longue du thread d'interface : imputable par construction.
      cause: 'boucle-tenue'
    })
    return true
  })
}
