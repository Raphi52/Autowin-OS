import { execFile } from 'node:child_process'
import { BrowserWindow, ipcMain, powerMonitor, screen } from 'electron'
import {
  AFFICHAGE_LOCAL,
  affichageDe,
  affichageForce,
  CANAL_AFFICHAGE_SESSION,
  CANAL_AFFICHAGE_SESSION_MAJ,
  memeAffichage,
  type AffichageSession
} from '../../shared/affichage-session'
import { assertTrustedRendererSender } from '../ipc/ipc-senders'

/**
 * L'AFFICHAGE SELON LA CONNEXION (conv-1442, 2026-11-02) — le côté Windows : la session est-elle à
 * distance, et quelle taille a son écran ? La décision vit dans `shared/affichage-session.ts`.
 *
 * QUAND ON RE-MESURE : au démarrage, à chaque déverrouillage (une reconnexion par Windows App
 * déverrouille la session : journal Windows 4778 puis 4801, ce qu'Electron signale par
 * `unlock-screen` — même signal que `mascotte-fenetre.ts`, conv-1227) et à chaque changement
 * d'écran (le téléphone impose sa résolution à la session). `process.env.SESSIONNAME` ne sert pas :
 * il est figé au lancement d'Autowin, il dirait encore « Console » après une reconnexion à distance.
 */

/**
 * `SystemInformation.TerminalServerSession` lit `GetSystemMetrics(SM_REMOTESESSION)` au moment de
 * l'appel. Vérifié le 2026-11-02 sur ce poste connecté par Windows App : « True », session
 * `rdp-tcp#0`.
 */
const SCRIPT_SESSION_DISTANTE =
  'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::TerminalServerSession'

export function lireSessionDistante(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT_SESSION_DISTANTE],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
      (erreur, sortie) => {
        if (erreur) {
          reject(erreur)
          return
        }
        const texte = String(sortie).trim()
        if (texte === 'True') resolve(true)
        else if (texte === 'False') resolve(false)
        else reject(new Error(`réponse inattendue de Windows : « ${texte.slice(0, 80)} »`))
      }
    )
  })
}

/** Laisse retomber une rafale (reconnexion = déverrouillage + plusieurs changements d'écran). */
const DELAI_REMESURE_MS = 800

type Dependances = {
  lireDistante: () => Promise<boolean>
  ecranPrincipal: () => { width: number; height: number }
  diffuser: (etat: AffichageSession) => void
  force?: string
  journal?: (message: string) => void
}

/** Le cœur, sans Electron : testable (`affichage-session.test.ts`). */
export function creerSuiviAffichage(dep: Dependances): {
  mesurer: () => Promise<AffichageSession>
  remesurerBientot: () => void
  etat: () => AffichageSession
  premiereMesure: () => Promise<AffichageSession>
} {
  let courant: AffichageSession = AFFICHAGE_LOCAL
  let minuterie: ReturnType<typeof setTimeout> | null = null
  let premiere: Promise<AffichageSession> | null = null

  const mesurer = async (): Promise<AffichageSession> => {
    let distante = courant.distante
    if (!affichageForce(dep.force)) {
      try {
        distante = await dep.lireDistante()
      } catch (erreur) {
        // On garde la dernière valeur connue : un PowerShell qui échoue une fois ne doit pas
        // faire basculer l'interface. La cause est journalisée, pas avalée.
        dep.journal?.(
          `[affichage-session] lecture de la session impossible, valeur gardée (${distante}) : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`
        )
      }
    }
    const ecran = dep.ecranPrincipal()
    const neuf = affichageDe({
      distante,
      largeurEcran: ecran.width,
      hauteurEcran: ecran.height,
      force: dep.force
    })
    if (!memeAffichage(neuf, courant)) {
      courant = neuf
      dep.diffuser(neuf)
    }
    return courant
  }

  return {
    mesurer,
    remesurerBientot: () => {
      if (minuterie) clearTimeout(minuterie)
      minuterie = setTimeout(() => {
        minuterie = null
        void mesurer()
      }, DELAI_REMESURE_MS)
    },
    etat: () => courant,
    premiereMesure: () => {
      premiere ??= mesurer()
      return premiere
    }
  }
}

/** Branche le suivi dans le processus principal. À appeler après `app.whenReady`. */
export function brancherAffichageSession(): void {
  const suivi = creerSuiviAffichage({
    lireDistante: lireSessionDistante,
    ecranPrincipal: () => screen.getPrimaryDisplay().size,
    diffuser: (etat) => {
      console.info(
        `[affichage-session] ${etat.distante ? 'à distance' : 'en local'}${etat.telephone ? ', écran de téléphone' : ''}`
      )
      for (const fenetre of BrowserWindow.getAllWindows()) {
        if (!fenetre.isDestroyed()) fenetre.webContents.send(CANAL_AFFICHAGE_SESSION_MAJ, etat)
      }
    },
    force: process.env.AUTOWIN_AFFICHAGE,
    journal: (message) => console.warn(message)
  })

  ipcMain.handle(CANAL_AFFICHAGE_SESSION, (event) => {
    assertTrustedRendererSender(event, 'Affichage selon la connexion')
    // L'état COURANT, une fois la première mesure faite : une page rechargée après une
    // reconnexion ne doit pas recevoir la mesure du démarrage.
    return suivi.premiereMesure().then(() => suivi.etat())
  })

  void suivi.premiereMesure()
  powerMonitor.on('unlock-screen', suivi.remesurerBientot)
  screen.on('display-metrics-changed', suivi.remesurerBientot)
  screen.on('display-added', suivi.remesurerBientot)
  screen.on('display-removed', suivi.remesurerBientot)
}
