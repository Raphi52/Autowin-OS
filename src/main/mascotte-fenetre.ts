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
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  avecLisereArcEnCiel,
  CANAL_GESTE_MASCOTTE,
  creerGlisserMascotte,
  creerSuiviMascotte,
  cssDeLEtat,
  estLaFermeture,
  etatDeLaMascotte,
  gesteDeMascotte,
  htmlDeMascotte,
  issuePourLaMascotte,
  placerMascotteGardee,
  PRELOAD_MASCOTTE,
  TAILLE_MASCOTTE,
  zoneDesCartes,
  type PositionMascotte
} from './mascotte'
import {
  ecrireMascotteAffichee,
  ecrirePositionMascotte,
  lirePositionMascotte
} from './mascotte-reglage'
import type { FinDeTourPourNotification } from './notification-fin-de-tour'
import type { Rect, ZoneDesCartes } from './notification-popup'

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
  /**
   * Branche la mascotte sur Autowin (une seule fois) ; sa fenêtre n'est créée que si elle est
   * affichée (`affichee`, le choix de Settings · Interface lu au démarrage).
   */
  demarrer: (deps: DependancesMascotte, affichee: boolean) => void
  /**
   * L'interrupteur de Settings · Interface (conv-1145). Masquée = fenêtre FERMÉE, pas seulement
   * cachée : rien ne reste à l'écran ni en mémoire. Réaffichée = fenêtre recréée.
   */
  afficher: (affichee: boolean) => void
  estLaMascotte: (fenetre: BrowserWindow | null) => boolean
  /**
   * La zone des cartes de fin de tour : à côté de la bille, là où elle est et sur SON écran, quand
   * elle est affichée (conv-1142) ; sinon la zone reçue (l'écran principal), inchangée.
   */
  zoneDesCartes: (zone: Rect) => ZoneDesCartes
  /** La page d'une carte : avec le liseré arc-en-ciel quand la mascotte est affichée. */
  decorerCarte: (html: string) => string
}

/** Les réponses de chat n'émettent aucun événement de début : relues à ce rythme. */
const RYTHME_MS = 1500

export function creerMascotteDuBureau(): MascotteDuBureau {
  const suivi = creerSuiviMascotte()
  let runs = 0
  let deps: DependancesMascotte | null = null
  let affichee = true
  /** `app.whenReady` passé : avant, aucune fenêtre ne peut naître. */
  let prete = false
  let win: BrowserWindow | null = null
  let chargee = false
  const glisser = creerGlisserMascotte()
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
    const feuille = cssDeLEtat(etatCourant())
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

  /** Visible seulement quand elle est affichée et que personne ne regarde Autowin. */
  const ajusterVisibilite = (): void => {
    if (!win || win.isDestroyed() || !chargee || !deps) return
    if (!affichee || deps.autowinRegardee()) {
      if (win.isVisible()) win.hide()
    } else if (!win.isVisible()) win.showInactive()
  }

  /** La place gardée si elle est encore sur un écran, sinon le coin au-dessus de l'horloge. */
  const placement = (): ReturnType<typeof placerMascotteGardee> =>
    placerMascotteGardee(
      lirePositionMascotte(),
      screen.getAllDisplays().map((ecran) => ecran.workArea),
      screen.getPrimaryDisplay().workArea
    )

  const placer = (): void => {
    if (win && !win.isDestroyed()) win.setBounds(placement())
  }

  /** Le clic sur la bille : le fil qui t'attend, sinon Autowin. Lu AVANT que l'ouverture l'efface. */
  const cliquer = (): void => {
    if (!deps) return
    const { fil } = etatCourant()
    if (fil) deps.ouvrirFil(fil)
    else deps.ouvrirAutowin()
  }

  /** Le lâcher d'un glisser : ramenée entière sur l'écran, puis la place est gardée. */
  const poser = (fenetre: BrowserWindow, position: PositionMascotte): void => {
    const rect = placerMascotteGardee(
      position,
      screen.getAllDisplays().map((ecran) => ecran.workArea),
      screen.getPrimaryDisplay().workArea
    )
    fenetre.setBounds(rect)
    try {
      ecrirePositionMascotte({ x: rect.x, y: rect.y })
    } catch (erreur) {
      console.warn('[mascotte] place non gardée —', String(erreur))
    }
  }

  /**
   * Les gestes du préchargement (`PRELOAD_MASCOTTE`), acceptés de LA fenêtre de la bille seulement.
   * Pendant un glisser, `setBounds` avec la taille fixe : un `setPosition` entre deux écrans
   * d'échelles différentes peut changer la taille de la fenêtre.
   */
  const surGeste = (evenement: IpcMainEvent, brut: unknown, x: unknown, y: unknown): void => {
    const fenetre = win
    if (!fenetre || fenetre.isDestroyed() || evenement.sender !== fenetre.webContents) return
    const recu = gesteDeMascotte(brut, x, y)
    if (!recu) return
    const { geste, curseur } = recu
    if (geste === 'appui') {
      const [x, y] = fenetre.getPosition()
      glisser.appui(curseur, { x, y })
      return
    }
    if (geste === 'bouge') {
      const position = glisser.bouge(curseur)
      if (position)
        fenetre.setBounds({ ...position, width: TAILLE_MASCOTTE, height: TAILLE_MASCOTTE })
      return
    }
    const fin = geste === 'lache' ? glisser.lache(curseur) : glisser.annule(curseur)
    if (fin?.type === 'clic') cliquer()
    else if (fin?.type === 'pose') poser(fenetre, fin.position)
  }

  const creerFenetre = (): void => {
    const fichier = join(tmpdir(), `autowin-mascotte-${process.pid}.html`)
    const preload = join(tmpdir(), `autowin-mascotte-${process.pid}.preload.js`)
    writeFileSync(fichier, htmlDeMascotte(), 'utf8')
    writeFileSync(preload, PRELOAD_MASCOTTE, 'utf8')
    win = new BrowserWindow({
      ...placement(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      // Déplacée par le moteur pendant un glisser de la bille (`surGeste`, conv-1142).
      movable: true,
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
        // Pour le seul préchargement : la page, elle, interdit tout script (sa politique de contenu).
        javascript: true,
        preload,
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
    // La croix : navigation INTERNE vers `#fermer`. Le clic de la bille passe par `surGeste`.
    fenetre.webContents.on('did-navigate-in-page', (_evenement, url, principale) => {
      if (principale && deps && estLaFermeture(url)) fermerDepuisLaBille()
    })
    fenetre.webContents.on('will-navigate', (evenement) => evenement.preventDefault())
    fenetre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    fenetre.once('closed', () => {
      rmSync(fichier, { force: true })
      rmSync(preload, { force: true })
      if (win === fenetre) win = null
      chargee = false
    })
    fenetre.loadFile(fichier).catch((erreur: unknown) => {
      // Sans page, pas de mascotte : les cartes et la bulle Windows préviennent toujours.
      console.warn('[mascotte] page non chargée —', String(erreur))
      if (!fenetre.isDestroyed()) fenetre.close()
    })
  }

  /** Crée la fenêtre si elle doit exister et n'existe pas encore. */
  const assurerFenetre = (): void => {
    if (!prete || !deps || !affichee || (win && !win.isDestroyed())) return
    try {
      creerFenetre()
    } catch (erreur) {
      console.warn('[mascotte] fenêtre impossible —', String(erreur))
    }
  }

  const visible = (): boolean => deps !== null && affichee

  const afficher = (oui: boolean): void => {
    affichee = oui
    if (oui) {
      assurerFenetre()
      ajusterVisibilite()
    } else if (win && !win.isDestroyed()) win.close()
  }

  /**
   * La croix de la bille (conv-1142) : le MÊME choix que l'interrupteur « Masquée » de Settings ·
   * Interface, donc gardé — fermée, elle ne revient pas au prochain démarrage, et c'est
   * l'interrupteur qui la rouvre. Un enregistrement impossible la ferme quand même : l'utilisateur
   * a demandé qu'elle parte, elle ne reviendra qu'au prochain démarrage.
   */
  function fermerDepuisLaBille(): void {
    try {
      ecrireMascotteAffichee(false)
    } catch (erreur) {
      console.warn('[mascotte] fermeture non gardée —', String(erreur))
    }
    afficher(false)
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
    demarrer: (dependances, afficheeAuDemarrage) => {
      if (deps) return
      deps = dependances
      affichee = afficheeAuDemarrage
      ipcMain.on(CANAL_GESTE_MASCOTTE, surGeste)
      void app.whenReady().then(() => {
        prete = true
        assurerFenetre()
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
    afficher,
    estLaMascotte: (fenetre) => fenetre !== null && fenetre === win,
    zoneDesCartes: (zone) => {
      if (!visible()) return zone
      // La fenêtre si elle existe ; pas encore créée, la place où elle va naître.
      const bille = win && !win.isDestroyed() ? win.getBounds() : placement()
      return zoneDesCartes(bille, screen.getDisplayMatching(bille).workArea)
    },
    decorerCarte: (html) => (visible() ? avecLisereArcEnCiel(html) : html)
  }
}
