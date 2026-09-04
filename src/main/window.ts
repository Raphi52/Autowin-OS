/**
 * LES FENÊTRES de l'application, sorties de `src/main/index.ts`.
 *
 * Pourquoi ce fichier existe : `createWindow`, `setupTray`, `showMainWindow` et
 * `openQuestionWindow` étaient posés au milieu du fichier de démarrage, avec leur état (`tray`,
 * `isQuitting`, `relayoutMainWindow`) en variables de module — donc impossibles à lire ou à
 * modifier sans traverser tout `index.ts`.
 *
 * Déplacement MÉCANIQUE, comportement inchangé : les corps sont identiques, seules les six valeurs
 * qu'ils prenaient dans `index.ts` deviennent des dépendances passées explicitement. L'état de
 * fenêtrage, lui, DÉMÉNAGE ICI : il n'était lu nulle part ailleurs, sauf `isQuitting` (exposé en
 * lecture par `estEnFermeture()`) et la table des fenêtres de question (exposée telle quelle, car
 * un canal IPC de `index.ts` la consulte).
 */
import { signalerInterfaceVisible } from './startup-gate'
import { cloreDemarrage, pendantOperation } from './gel-main'
import { app, shell, BrowserWindow, Menu, Tray } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'
import { BOOT_SPLASH_DOCUMENT } from '../shared/boot-splash'
import { warmCapabilities } from './capability-controls'
import { isTrustedRendererUrl } from './behaviour-access'
import { behaviourRendererOptions } from './ipc-senders'
import { type ModelQuestionHub, type PendingModelQuestion } from './model-questions'
import { annoncerFermeture } from './journal-arrets'
import { presentAutomationWindow } from './headless-instance'
import icon from '../../resources/icon.png?asset'
import devIcon from '../../resources/autowin-os-dev.png?asset'

/** Ce que le fenêtrage prenait dans `index.ts` — désormais passé explicitement. */
export type WindowingDeps = {
  /** Horodatage du tout début du process, pour les jalons de démarrage. */
  T0_DEMARRAGE: number
  jalonDemarrage: (etape: string) => void
  automationInstanceMode: { isolated: boolean; headless: boolean }
  isolatedTestInstance: boolean
  headlessTestInstance: boolean
  modelQuestions: ModelQuestionHub
}

/** Ce que `index.ts` câble ensuite sur son démarrage et ses canaux IPC. */
export type Fenetres = {
  createWindow: () => void
  showMainWindow: () => void
  setupTray: () => void
  openQuestionWindow: (parent: BrowserWindow | null, question: PendingModelQuestion) => void
  rendererLocation: () => { devRendererUrl?: string; rendererHtmlPath: string }
  /** Vrai UNIQUEMENT après un quit demandé depuis le menu du tray. */
  estEnFermeture: () => boolean
  /** Les fenêtres de question ouvertes, par identifiant — un canal IPC de `index.ts` les ferme. */
  questionWindows: Map<string, BrowserWindow>
}

export function createWindowing(deps: WindowingDeps): Fenetres {
  const {
    T0_DEMARRAGE,
    jalonDemarrage,
    automationInstanceMode,
    isolatedTestInstance,
    headlessTestInstance,
    modelQuestions
  } = deps

  const questionWindows = new Map<string, BrowserWindow>()
  /**
   * Relayout forcé de la fenêtre principale (correctif desync fenêtre↔viewport, cf. createWindow).
   * Exposé au niveau module pour être rejoué depuis les chemins déclenchés PAR LE MODÈLE (fermeture
   * d'une fenêtre de question `alwaysOnTop` enfant), pas seulement sur les transitions utilisateur.
   */
  let relayoutMainWindow: (() => void) | null = null
  /**
   * Survie à la fermeture de FENÊTRE (robustesse niveau 1) : fermer la fenêtre ne tue plus l'app ni le
   * run en cours — le process main reste vivant en TRAY (les tours d'agent y tournent + s'y persistent),
   * et rouvrir la fenêtre rebranche sur la conversation (résultat conservé). Quit RÉEL via le menu tray.
   */
  let tray: Tray | null = null
  let isQuitting = false
  /** Montre la fenêtre existante (ou en recrée une si toutes fermées). */
  function showMainWindow(): void {
    const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
    } else {
      createWindow()
    }
  }
  /** Icône de barre d'état : présence VISIBLE de l'app vivante (anti « process fantôme ») + quit réel. */
  function setupTray(): void {
    if (tray) return
    try {
      tray = new Tray(process.env['AUTOWIN_OS_DEV'] === '1' ? devIcon : icon)
      tray.setToolTip('Autowin OS — actif (les runs continuent fenêtre fermée)')
      const menu = Menu.buildFromTemplate([
        { label: 'Ouvrir Autowin', click: () => showMainWindow() },
        { type: 'separator' },
        {
          label: 'Quitter Autowin',
          click: () => {
            isQuitting = true
            annoncerFermeture('menu du tray — « Quitter Autowin »')
            app.quit()
          }
        }
      ])
      tray.setContextMenu(menu)
      tray.on('click', () => showMainWindow())
    } catch {
      // Tray best-effort : un échec (env sans zone de notification) ne doit pas casser le démarrage.
      tray = null
    }
  }
  function openQuestionWindow(parent: BrowserWindow | null, question: PendingModelQuestion): void {
    const win = new BrowserWindow({
      width: 640,
      height: 560,
      minWidth: 480,
      minHeight: 420,
      parent: parent ?? undefined,
      modal: false,
      show: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      title: 'Question du modèle',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: false
      }
    })
    questionWindows.set(question.id, win)
    win.on('closed', () => {
      // Une fenêtre enfant `alwaysOnTop` qui apparaît/disparaît peut laisser la fenêtre parente avec
      // des métriques périmées (contenu rogné). C'est un chemin déclenché PAR LE MODÈLE, pas par
      // l'utilisateur → on force le relayout du parent à sa fermeture.
      relayoutMainWindow?.()
      if (!questionWindows.delete(question.id)) return
      try {
        modelQuestions.resolve(question.id, 'attend pour l’instant')
      } catch {
        // La réponse a déjà été transmise juste avant la fermeture.
      }
    })
    win.once('ready-to-show', () => {
      presentAutomationWindow(win, headlessTestInstance, { focus: true, flash: true })
    })
    win.webContents.once('did-finish-load', () => win.webContents.send('model:question', question))
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#model-question`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'model-question' })
    }
  }
  function rendererLocation(): { devRendererUrl?: string; rendererHtmlPath: string } {
    return {
      devRendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
      rendererHtmlPath: join(__dirname, '../renderer/index.html')
    }
  }
  function createWindow(): void {
    // Create the browser window.
    jalonDemarrage('construction de la fenêtre')
    const mainWindow = new BrowserWindow({
      title: isolatedTestInstance ? 'Autowin OS Test' : 'Autowin OS',
      width: 900,
      height: 670,
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#f5f7fb',
        height: 28
      },
      icon: process.env['AUTOWIN_OS_DEV'] === '1' ? devIcon : icon,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // sandbox:false requis par le preload @electron-toolkit ; contextIsolation
        // reste à true (défaut Electron) — affirmé ici pour éviter toute régression.
        contextIsolation: true,
        sandbox: false
      }
    })

    // Clic droit dans un champ de saisie : Electron SOULIGNE les fautes tout seul, mais n'affiche
    // aucune suggestion sans menu contextuel applicatif — il faut le construire à partir de
    // params.dictionarySuggestions et appeler replaceMisspelling.
    mainWindow.webContents.on('context-menu', (_event, params) => {
      const items: Electron.MenuItemConstructorOptions[] = []
      for (const suggestion of params.dictionarySuggestions) {
        items.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        })
      }
      if (params.misspelledWord) {
        if (items.length === 0) items.push({ label: 'Aucune suggestion', enabled: false })
        items.push({ type: 'separator' })
        items.push({
          label: 'Ajouter au dictionnaire',
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
        items.push({ type: 'separator' })
      }
      if (params.isEditable || params.selectionText) {
        if (params.selectionText) {
          if (params.isEditable) items.push({ role: 'cut', label: 'Couper' })
          items.push({ role: 'copy', label: 'Copier' })
        }
        if (params.isEditable) items.push({ role: 'paste', label: 'Coller' })
        items.push({ role: 'selectAll', label: 'Tout sélectionner' })
      }
      if (items.length === 0) return
      Menu.buildFromTemplate(items).popup({ window: mainWindow })
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      // Allowlist : n'ouvre à l'extérieur QUE http/https (une réponse modèle peut
      // contenir un lien hostile file://, ms-*: … → jamais shell.openExternal dessus).
      try {
        const u = new URL(details.url)
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          shell.openExternal(details.url)
        }
      } catch {
        /* URL invalide — ignorée */
      }
      return { action: 'deny' }
    })

    const blockUntrustedNavigation = (event: { preventDefault(): void }, url: string): void => {
      if (!isTrustedRendererUrl(url, behaviourRendererOptions())) event.preventDefault()
    }
    mainWindow.webContents.on('will-navigate', blockUntrustedNavigation)
    mainWindow.webContents.on('will-redirect', blockUntrustedNavigation)
    mainWindow.webContents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      const currentUrl = details.frame?.url ?? ''
      const isInitialLocalFrameLoad =
        (currentUrl === '' || currentUrl === 'about:blank') &&
        (details.url.startsWith('data:') || details.url.startsWith('blob:'))
      if (!isInitialLocalFrameLoad) details.preventDefault()
    })

    // Desync fenêtre↔viewport (vécu) : le contenu reste parfois rendu à ses ANCIENNES métriques —
    // rogné en haut à gauche, le reste noir — jusqu'à ce qu'un vrai resize force un relayout, d'où le
    // « minimiser puis réagrandir » qui répare. Terrain propice ici : zoomFactor persistant
    // (webFrame.setZoomFactor au montage), `maximize()` juste avant `show()`, titleBarOverlay, et un
    // écran à DPI ≠ 100 %. On ne devine pas lequel déclenche : on force un recalcul COMPLET des
    // métriques sur chaque transition à risque. enableDeviceEmulation/disable recalcule layout ET
    // scale (invalidate() ne fait qu'un repaint) et ne dé-maximise pas la fenêtre.
    const forceRelayout = (): void => {
      const wc = mainWindow.webContents
      if (wc.isDestroyed()) return
      try {
        wc.enableDeviceEmulation({
          screenPosition: 'desktop',
          screenSize: { width: 0, height: 0 },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: 0, height: 0 },
          deviceScaleFactor: 0,
          scale: 1
        })
        wc.disableDeviceEmulation()
      } catch {
        // API indisponible sur un futur Electron → repli best-effort, jamais casser l'affichage.
        try {
          wc.invalidate()
        } catch {
          /* rien de mieux à faire : on laisse la fenêtre telle quelle */
        }
      }
    }
    // `on` est surchargé par nom d'event → on branche explicitement (une boucle sur une union ne typecheck pas).
    mainWindow.on('show', forceRelayout)
    mainWindow.on('restore', forceRelayout)
    mainWindow.on('maximize', forceRelayout)
    mainWindow.on('unmaximize', forceRelayout)
    relayoutMainWindow = forceRelayout

    mainWindow.on('ready-to-show', () => {
      /*
       * L'etiquette est BORNEE au segment synchrone de ce gestionnaire.
       *
       * `ready-to-show` est emis APRES `did-finish-load`, donc apres la cloture du demarrage : un
       * simple jalon reposait une etiquette que plus rien ne depilait. Mesure du 2026-09-02 : 56 gels
       * etales sur pres de 24 h ressortaient sous 'demarrage:ready-to-show'. `pendantOperation` la
       * retire des que l'affichage est fait.
       */
      console.log(`[demarrage] ${String(Date.now() - T0_DEMARRAGE).padStart(6)} ms  ready-to-show`)
      pendantOperation('fenetre:affichage-initial', () => {
        presentAutomationWindow(mainWindow, automationInstanceMode.headless, { maximize: true })
      })
      setTimeout(() => void warmCapabilities(), 250)
    })

    /**
     * ÉCRAN D'ATTENTE, chargé par le processus PRINCIPAL avant l'URL du renderer.
     *
     * Un premier essai avait mis ce bloc dans `index.html`. Il ne marche pas, et c'est une CAPTURE au
     * niveau de l'OS qui l'a montré : la fenêtre devient visible AVANT que le serveur de développement
     * ait servi la page, donc il n'y a encore rien à peindre — la fenêtre reste entièrement vide.
     * Chronométré, cache chaud : fenêtre visible vers 35-55 s, interface montée vers 70-80 s.
     *
     * Ici l'attente ne dépend plus de vite : c'est un document autonome. Et Electron continue
     * d'afficher le document COURANT jusqu'à ce que le suivant ait peint sa première image — donc
     * l'écran reste visible pendant toute la compilation, puis disparaît de lui-même quand l'interface
     * est prête. Aucun code de nettoyage, aucune fenêtre séparée à gérer.
     */
    /**
     * Le travail de fond attend que l'interface soit CHARGÉE, pas seulement que la fenêtre existe.
     *
     * MESURÉ : signalé à `ready-to-show`, la réconciliation des copies (~23 s, synchrone) occupait le
     * fil principal avant que `loadURL` soit même demandé — écran d'attente visible à 6,5 s, interface
     * réelle à 32,8 s. Signalé ici, le vrai document est demandé tout de suite et la réconciliation
     * tourne derrière une interface déjà affichée.
     */
    const chargerInterface = (): void => {
      jalonDemarrage("chargement de l'interface demandé")
      if (mainWindow.isDestroyed()) return
      // L'écoute est posée ICI, et pas plus haut : posée à la création de la fenêtre, elle captait le
      // `did-finish-load` de l'ÉCRAN D'ATTENTE — MESURÉ, elle partait à 7 149 ms, avant même que le vrai
      // document soit demandé, et les 23 s de réconciliation synchrone repoussaient `loadURL` à 30 400 ms.
      mainWindow.webContents.once('did-finish-load', () => {
        jalonDemarrage('interface chargée')
        // Le demarrage est FINI : sans cette cloture, son jalon reste en pile et etiquette a tort
        // tous les gels de la session (49 sur 173 dans le journal du 2026-08-30).
        cloreDemarrage()
        signalerInterfaceVisible()
      })
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
        if (isolatedTestInstance) rendererUrl.searchParams.set('instance', 'test')
        void mainWindow.loadURL(rendererUrl.toString())
      } else {
        void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
          query: isolatedTestInstance ? { instance: 'test' } : undefined
        })
      }
    }

    /**
     * L'attente est écrite dans un vrai FICHIER, puis chargée par `loadFile`.
     *
     * Une version précédente passait par `data:text/html,…`. MESURÉ : le document se chargeait bien —
     * le protocole relevé était `data:` — mais son contenu était VIDE, `#autowin-boot` introuvable.
     * Chromium bloque les navigations de premier niveau vers une URL `data:`, et Electron suit. L'écran
     * n'était donc jamais visible pendant les 44 secondes qu'il devait couvrir : seul celui d'
     * `index.html` s'affichait, à la toute fin, d'où l'impression qu'il « disparaissait après une
     * seconde ».
     *
     * Le fichier vit dans le dossier temporaire : il est régénéré à chaque lancement, donc jamais
     * périmé, et son absence ne peut pas empêcher le démarrage — l'interface est chargée dans les deux
     * branches du `.then`.
     */
    const cheminAttente = join(app.getPath('temp'), 'autowin-boot.html')
    let attentePrete = false
    try {
      writeFileSync(cheminAttente, BOOT_SPLASH_DOCUMENT, 'utf8')
      attentePrete = true
    } catch {
      // Écriture impossible : on saute l'attente plutôt que de retarder l'application.
    }

    // L'ATTENTE DOIT ÊTRE PEINTE AVANT de demander le vrai document. Enchaîner deux chargements sans
    // attendre ANNULE le premier : l'écran n'aurait jamais été affiché, et on retombait exactement sur
    // la fenêtre vide que ceci corrige. On attend donc la fin du chargement — quelques millisecondes
    // pour un document autonome — puis on lance l'interface.
    if (attentePrete) mainWindow.loadFile(cheminAttente).then(chargerInterface, chargerInterface)
    else chargerInterface()
  }
  return {
    createWindow,
    showMainWindow,
    setupTray,
    openQuestionWindow,
    rendererLocation,
    estEnFermeture: () => isQuitting,
    questionWindows
  }
}
