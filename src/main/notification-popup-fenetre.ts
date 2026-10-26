/**
 * La VRAIE fenêtre de la carte de fin de tour (conv-1066, 2026-10-22) — la page, la taille et la
 * pile vivent dans `notification-popup.ts`, testées sans Electron.
 *
 * Fenêtre sans bordure, transparente (les coins arrondis du cadre irisé), au premier plan, hors de
 * la barre des tâches, et qui ne prend JAMAIS le focus : l'utilisateur est ailleurs, la carte ne
 * doit pas lui voler son clavier. Aucun preload, aucun script : la page n'a aucun accès à l'app ;
 * les clics sont des liens vers un fragment (`#ouvrir`, `#suite-0`…) que le processus principal lit
 * sur l'événement de navigation interne de la page.
 */
import { BrowserWindow, screen } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  actionDuFragment,
  creerPileDePopups,
  PALETTE_HOLOGRAPHIQUE,
  paletteDeCarte,
  type DependancesPile,
  type FenetrePopup,
  type PaletteCarte,
  type Rect
} from './notification-popup'

/**
 * Le thème choisi dans Réglages · Interface, tel que la page de l'app l'a envoyé (conv-1090). Il
 * vit ICI, dans le processus principal, et survit donc à la fenêtre principale fermée dans la
 * zone de notification : c'est justement là que les cartes servent.
 */
let paletteCourante: PaletteCarte = PALETTE_HOLOGRAPHIQUE

/** Une palette abîmée est refusée en bloc : les cartes gardent la dernière palette valable. */
export function definirPaletteDeCarte(brut: unknown): boolean {
  const palette = paletteDeCarte(brut)
  if (!palette) return false
  paletteCourante = palette
  return true
}

/** Un fichier de page par carte, effacé à sa fermeture. */
let compteur = 0

const ouvrirFenetre: DependancesPile['ouvrirFenetre'] = ({
  html,
  rect,
  surAction,
  surFermee,
  surEchec
}) => {
  // fix-ok: une page chargée en `data:` ne suit JAMAIS un lien `#fragment` (aucune navigation, clic
  // reçu pourtant) ; chargée depuis un FICHIER, le même clic émet `did-navigate-in-page`. Mesuré le
  // 2026-10-22 dans le bureau caché, 4 variantes js/focus/data/fichier (conv-1066).
  // Le fichier s'écrit AVANT la fenêtre : une écriture impossible fait jeter `fabriquer` (la bulle
  // prend le relais dans `index.ts`) sans laisser derrière elle une fenêtre cachée jamais fermée.
  const fichier = join(tmpdir(), `autowin-carte-${process.pid}-${(compteur += 1)}.html`)
  writeFileSync(fichier, html, 'utf8')
  const win = new BrowserWindow({
    ...rect,
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
    title: 'Autowin — fin de tour',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      javascript: false,
      spellcheck: false
    }
  })
  let prete = false
  let demandee = false
  const montrer = (): void => {
    if (prete && demandee && !win.isDestroyed()) win.showInactive()
  }
  win.once('ready-to-show', () => {
    prete = true
    montrer()
  })
  win.on('closed', surFermee)
  // Un clic sur un lien de la carte = navigation INTERNE vers son fragment, sans script.
  win.webContents.on('did-navigate-in-page', (_evenement, url, principale) => {
    if (!principale) return
    const action = actionDuFragment(url)
    if (action) surAction(action)
  })
  // La page ne va nulle part ailleurs, et n'ouvre rien.
  win.webContents.on('will-navigate', (evenement) => evenement.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('closed', () => rmSync(fichier, { force: true }))
  // fix-ok: le rejet de `loadFile` (did-fail-load) partait dans un `void` : rejet non rattrapé,
  // fenêtre cachée laissée ouverte, NI carte NI bulle (notification-popup-fenetre.test.ts, rouge
  // avant ce `catch`, conv-1066). La pile ferme la fenêtre et passe la main à la bulle ; une carte
  // fermée PENDANT son chargement fait aussi rejeter `loadFile` (ERR_ABORTED) : rien à signaler.
  win.loadFile(fichier).catch((erreur: unknown) => {
    if (win.isDestroyed()) return
    console.warn('[fin-de-tour] page de carte non chargée, bulle Windows —', String(erreur))
    surEchec(erreur)
  })
  const fenetre: FenetrePopup = {
    placer: (cible) => {
      if (!win.isDestroyed()) win.setBounds(cible)
    },
    afficher: () => {
      demandee = true
      montrer()
    },
    fermer: () => {
      if (!win.isDestroyed()) win.close()
    }
  }
  fenetresDePopup.add(win)
  win.once('closed', () => fenetresDePopup.delete(win))
  return fenetre
}

const fenetresDePopup = new Set<BrowserWindow>()

type PopupsDeFinDeTour = ReturnType<typeof creerPileDePopups> & {
  /** Une carte n'est pas « Autowin regardé » : son clic ne doit pas fermer les autres cartes. */
  estUneCarte: (win: BrowserWindow | null) => boolean
}

/**
 * Les cartes de fin de tour, posées en bas à droite de l'écran PRINCIPAL (là où Windows sonne).
 * `zone` retouche la zone de travail : la mascotte du bureau (conv-1145) y retire sa colonne, et
 * les cartes sortent alors à sa gauche au lieu de la recouvrir.
 */
export function creerPopupsDeFinDeTour({
  secours,
  zone = (zoneDeTravail) => zoneDeTravail
}: Pick<DependancesPile, 'secours'> & { zone?: (zoneDeTravail: Rect) => Rect }): PopupsDeFinDeTour {
  const pile = creerPileDePopups({
    zone: () => zone(screen.getPrimaryDisplay().workArea),
    heure: () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    palette: () => paletteCourante,
    secours,
    ouvrirFenetre
  })
  return { ...pile, estUneCarte: (win) => win !== null && fenetresDePopup.has(win) }
}
