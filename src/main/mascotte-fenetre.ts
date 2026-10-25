/**
 * La VRAIE fenêtre de la mascotte du bureau (conv-1145, 2026-10-25) — l'état, la page et le
 * placement vivent dans `mascotte.ts`, testés sans Electron.
 *
 * Même fenêtre que les cartes de fin de tour (`notification-popup-fenetre.ts`) : sans bordure,
 * transparente, au premier plan, hors de la barre des tâches, et qui ne prend JAMAIS le focus.
 * Aucun script dans la page : l'état y entre par une feuille de style ajoutée (`insertCSS`, qui
 * n'a pas besoin de JavaScript), le clic en sort par un lien vers un fragment.
 *
 * Elle se CACHE tant qu'une fenêtre d'Autowin est regardée : posée en bas à droite, elle couvrirait
 * le bas de la fenêtre (la saisie), pour la même raison que les cartes se ferment alors.
 */
import { app, BrowserWindow, screen } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  creerSuiviMascotte,
  cssDeLEtat,
  etatDeLaMascotte,
  htmlDeMascotte,
  issuePourLaMascotte,
  lienDuFragment,
  placerMascotte,
  zoneDesCartes,
  type LienActif
} from './mascotte'
import type { FinDeTourPourNotification } from './notification-fin-de-tour'
import type { Rect } from './notification-popup'

export type DependancesMascotte = {
  /** Réponses de chat en cours, préparation comprise. */
  toursEnCours: () => number
  /** Une fenêtre d'Autowin a le focus (ni une carte, ni la mascotte). */
  autowinRegardee: () => boolean
  /** Ramène Autowin sur ce fil. */
  ouvrirFil: (conversationId: string) => void
  /** Ramène Autowin, sans fil particulier. */
  ouvrirAutowin: () => void
}

export type MascotteDuBureau = {
  /** Le nombre de runs en cours, tel que l'interface l'envoie (`os:presence`). */
  runsActifs: (nombre: number) => void
  /** Un tour de chat vient de finir : il attend peut-être l'utilisateur. */
  finDeTour: (
    conversationId: string,
    fin: FinDeTourPourNotification & { tourDeFond?: boolean }
  ) => void
  /** Crée la fenêtre (une seule fois) et la branche sur Autowin. */
  demarrer: (deps: DependancesMascotte) => void
  estLaMascotte: (fenetre: BrowserWindow | null) => boolean
  /** La zone des cartes de fin de tour : à gauche de la mascotte quand elle existe. */
  zoneDesCartes: (zone: Rect) => Rect
}

/** Les réponses de chat n'émettent aucun événement de début : relues à ce rythme. */
const RYTHME_MS = 1500

export function creerMascotteDuBureau(): MascotteDuBureau {
  const suivi = creerSuiviMascotte()
  let runs = 0
  let deps: DependancesMascotte | null = null
  let win: BrowserWindow | null = null
  let chargee = false
  let lien: LienActif = 1
  let feuilleCourante = ''
  let cleFeuille: string | null = null
  let fileFeuilles: Promise<void> = Promise.resolve()

  const etatCourant = (): ReturnType<typeof etatDeLaMascotte> =>
    etatDeLaMascotte({
      toursEnCours: deps?.toursEnCours() ?? 0,
      runsActifs: runs,
      filsEnAttente: suivi.filsEnAttente(),
      filsEnEchec: suivi.filsEnEchec()
    })

  /** Pose la feuille de l'état si elle a changé ; une à la fois, dans l'ordre. */
  const rafraichir = (): void => {
    if (!win || win.isDestroyed() || !chargee) return
    const feuille = cssDeLEtat(etatCourant(), lien)
    if (feuille === feuilleCourante) return
    feuilleCourante = feuille
    const contenu = win.webContents
    fileFeuilles = fileFeuilles
      .then(async () => {
        if (contenu.isDestroyed()) return
        const nouvelle = await contenu.insertCSS(feuille)
        if (cleFeuille) await contenu.removeInsertedCSS(cleFeuille)
        cleFeuille = nouvelle
      })
      .catch((erreur: unknown) => {
        // Une feuille refusée laisse l'état précédent affiché : la prochaine relecture réessaie.
        feuilleCourante = ''
        console.warn('[mascotte] état non appliqué —', String(erreur))
      })
  }

  /** Visible seulement quand personne ne regarde Autowin. */
  const ajusterVisibilite = (): void => {
    if (!win || win.isDestroyed() || !chargee || !deps) return
    if (deps.autowinRegardee()) {
      if (win.isVisible()) win.hide()
    } else if (!win.isVisible()) win.showInactive()
  }

  const placer = (): void => {
    if (win && !win.isDestroyed())
      win.setBounds(placerMascotte(screen.getPrimaryDisplay().workArea))
  }

  const creerFenetre = (): void => {
    const fichier = join(tmpdir(), `autowin-mascotte-${process.pid}.html`)
    writeFileSync(fichier, htmlDeMascotte(), 'utf8')
    win = new BrowserWindow({
      ...placerMascotte(screen.getPrimaryDisplay().workArea),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      title: 'Autowin — mascotte',
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false
      }
    })
    const fenetre = win
    fenetre.webContents.on('did-finish-load', () => {
      chargee = true
      feuilleCourante = ''
      cleFeuille = null
      rafraichir()
      ajusterVisibilite()
    })
    // Le clic : navigation INTERNE vers `#o1` ou `#o2`. L'état est lu AVANT que l'ouverture du fil
    // ne ramène Autowin (qui efface « pour toi »), puis l'autre lien prend le prochain clic.
    fenetre.webContents.on('did-navigate-in-page', (_evenement, url, principale) => {
      if (!principale || !deps) return
      const clique = lienDuFragment(url)
      if (clique === null) return
      const { fil } = etatCourant()
      lien = clique === 1 ? 2 : 1
      rafraichir()
      if (fil) deps.ouvrirFil(fil)
      else deps.ouvrirAutowin()
    })
    fenetre.webContents.on('will-navigate', (evenement) => evenement.preventDefault())
    fenetre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    fenetre.once('closed', () => {
      rmSync(fichier, { force: true })
      if (win === fenetre) win = null
      chargee = false
    })
    fenetre.loadFile(fichier).catch((erreur: unknown) => {
      // Sans page, pas de mascotte : les cartes et la bulle Windows préviennent toujours.
      console.warn('[mascotte] page non chargée —', String(erreur))
      if (!fenetre.isDestroyed()) fenetre.close()
    })
  }

  return {
    runsActifs: (nombre) => {
      runs = Number.isFinite(nombre) ? Math.max(0, Math.floor(nombre)) : 0
      rafraichir()
    },
    finDeTour: (conversationId, fin) => {
      if (!deps) return
      const issue = issuePourLaMascotte(fin, deps.autowinRegardee())
      if (!issue) return
      suivi.finDeTour(conversationId, issue)
      rafraichir()
    },
    demarrer: (dependances) => {
      if (deps) return
      deps = dependances
      void app.whenReady().then(() => {
        try {
          creerFenetre()
        } catch (erreur) {
          console.warn('[mascotte] fenêtre impossible —', String(erreur))
          return
        }
        // Regarder Autowin efface « pour toi » et « problème », comme les cartes, et cache la bille.
        app.on('browser-window-focus', (_evenement, fenetre) => {
          if (fenetre === win || !deps?.autowinRegardee()) return
          suivi.regarde()
          rafraichir()
          ajusterVisibilite()
        })
        // Le focus part peut-être vers une autre fenêtre d'Autowin : on relit juste après.
        app.on('browser-window-blur', () => {
          setTimeout(ajusterVisibilite, 120).unref?.()
        })
        screen.on('display-metrics-changed', placer)
        screen.on('display-added', placer)
        screen.on('display-removed', placer)
        setInterval(rafraichir, RYTHME_MS).unref?.()
      })
    },
    estLaMascotte: (fenetre) => fenetre !== null && fenetre === win,
    zoneDesCartes: (zone) => (deps ? zoneDesCartes(zone) : zone)
  }
}
