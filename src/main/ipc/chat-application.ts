import { HAUTEUR_BOUTONS_FENETRE } from '../../shared/barre-fenetre'
import { ipcMain, BrowserWindow, nativeTheme, app } from 'electron'
import { pruneLegacyContextValues } from '../runs/context-value-gc'
import {
  listUnfinishedTurnsPuisMenageAsync,
  pruneFinishedTurnJournals,
  readTurnJournal
} from '../runs/turn-journal'
import { assertTrustedRendererSender } from './ipc-senders'
import { ensureAutowinAppData } from '../app/app-data'
import { guardString } from './ipc-guards'
import { checkForUpdate, abortUpdateConflict, applyUpdate } from '../git/git-update'
import type { UpdateAction } from '../../shared/update-contract'
import { restartApplication } from '../app/app-restart'
import { annoncerFermeture } from '../app/journal-arrets'
import { consommerReprise } from '../app/redemarrage-reprise'
import { definirPaletteDeCarte } from '../app/notification-popup-fenetre'
import {
  htmlDeMascotte,
  LARGEUR_MASCOTTE,
  HAUTEUR_MASCOTTE,
  HUMEURS_ACCUEIL,
  type HumeurAccueil,
  cssDeLAccueil
} from '../mascotte/mascotte'
import {
  lireMascotteAffichee,
  ecrireMascotteAffichee,
  lireStyleMascotte,
  ecrireStyleMascotte,
  styleAffiche
} from '../mascotte/mascotte-reglage'
import type { ContexteIpcChat } from '../index'

/**
 * LES CANAUX DE L’APPLICATION ELLE-MÊME : tours restés inachevés, reprise après un redémarrage,
 * présence des runs, mascotte, couleur des boutons de fenêtre, schéma de couleurs, carte de fin
 * de tour et mise à jour.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : application, fenêtre, mascotte et mise à jour. */
export function registerApplicationIpc(ctx: ContexteIpcChat): void {
  const { appDataRoot, mascotteDuBureau, os, refleterRunsVivants, turnJournalRoot } = ctx
  // Survie niveau 2 : au démarrage, le renderer demande les tours restés INACHEVÉS (app fermée en
  // pleine exécution) pour les rejouer/afficher. Le ménage des journaux terminés suit la réponse
  // (25 gels, 69 s cumulées, quand il la PRÉCÉDAIT) — cf. listUnfinishedTurnsPuisMenageAsync
  // (runs/turn-journal.ts).
  ipcMain.handle('runs:unfinishedTurns', (event) => {
    assertTrustedRendererSender(event, 'UnfinishedTurns')
    // La LISTE part tout de suite (tampons vides d'abord, sinon un tour en vol serait invisible) ;
    // scan et suppressions passent apres le premier rendu. 25 gels, 69 s, ~2,8 s par ouverture.
    return listUnfinishedTurnsPuisMenageAsync(turnJournalRoot, {
      menage: () => {
        pruneFinishedTurnJournals(turnJournalRoot)
        pruneLegacyContextValues()
      }
    })
  })
  ipcMain.handle('runs:turnJournal', (event, conversationId: string, turnId: string) => {
    assertTrustedRendererSender(event, 'TurnJournal')
    return readTurnJournal(
      turnJournalRoot,
      guardString(conversationId, 'conversationId'),
      guardString(turnId, 'turnId')
    )
  })
  // Auto-update git : check au démarrage (non-bloquant) + application 1-clic (pull + relaunch).
  //
  // `os.executionWorkspace` et NON `process.cwd()` : dans l'app PACKAGÉE, le cwd est le dossier de
  // lancement de l'exécutable, pas le dépôt. `git fetch` y échoue (« not a git repository »),
  // l'erreur est capturée en `{ available: false }` et la bannière reste MUETTE. Symptôme observé
  // le 2026-08-04 : des merges sur `main` ne faisaient apparaître aucun bouton chez les collègues,
  // alors que la bannière fonctionnait en développement — où le cwd EST le dépôt, par accident.
  // Tout le reste de ce fichier utilise déjà `os.executionWorkspace` ; ces deux appels étaient les
  // seuls à ne pas le faire.
  /**
   * La consigne posee avant un redemarrage, rendue UNE SEULE FOIS puis effacee du disque.
   * Le renderer la rejoue comme un message ordinaire dans la conversation d'origine.
   */
  ipcMain.handle('app:reprise-en-attente', (event) => {
    assertTrustedRendererSender(event, 'Reprise après redémarrage')
    return consommerReprise(ensureAutowinAppData(appDataRoot))
  })
  /**
   * COULEUR DES BOUTONS DE FENETRE — reduire / agrandir / fermer.
   *
   * Ces trois boutons sont dessines par WINDOWS, pas par la page : aucune feuille de style ne les
   * atteint. Leur couleur se fixe a la creation de la fenetre (`window.ts`, `titleBarOverlay`),
   * donc dans le processus principal, alors que le theme choisi vit dans le renderer. Sans ce
   * canal, la barre ne peut suivre AUCUN theme : elle garde son quasi-blanc de depart, invisible
   * des que la page passe en clair. Constate a l'ecran le 2026-09-07.
   *
   * Le renderer envoie une couleur, pas un nom de theme : c'est lui qui sait ce que vaut
   * `--text` dans le theme courant, et cela reste vrai pour les themes a venir sans toucher ici.
   * ENTREE QUI DOIT FAIRE ECHOUER LE GARDE : retirer cet appel, ou remettre une couleur en dur
   * dans `window.ts` sans point de mise a jour — le defaut reviendrait en silence.
   */
  /**
   * PRÉSENCE SYSTÈME des runs. Le renderer est le seul à tenir la liste des runs vivants ; il
   * l'envoie ici comme il envoie déjà la couleur des boutons de fenêtre juste en dessous.
   */
  ipcMain.handle('os:presence', (event, etat: unknown) => {
    assertTrustedRendererSender(event, 'Présence système des runs')
    const brut = (etat ?? {}) as Record<string, unknown>
    const nombre = (cle: string): number =>
      typeof brut[cle] === 'number' ? (brut[cle] as number) : 0
    refleterRunsVivants({
      runsActifs: nombre('runsActifs'),
      etapesFaites: nombre('etapesFaites'),
      etapesTotales: nombre('etapesTotales')
    })
    return true
  })
  // L'interrupteur « Mascotte du bureau » de Settings · Interface. Le moteur garde le
  // choix (`mascotte-reglage.ts`) : la mascotte vit hors de la fenêtre, fenêtre fermée comprise.
  ipcMain.handle('os:mascotte', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return lireMascotteAffichee()
  })
  ipcMain.handle('os:mascotte:afficher', (event, affichee: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    ecrireMascotteAffichee(affichee)
    mascotteDuBureau.afficher(lireMascotteAffichee())
    return lireMascotteAffichee()
  })
  // Le choix « Magicien / Basique » de la même ligne de Settings · Interface.
  ipcMain.handle('os:mascotte:style', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return lireStyleMascotte()
  })
  ipcMain.handle('os:mascotte:choisir-style', (event, style: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    ecrireStyleMascotte(style)
    mascotteDuBureau.changerStyle(styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte))
    return lireStyleMascotte()
  })
  // Le thème appliqué par la fenêtre : le thème NieR montre la machine, sans toucher au
  // style gardé. Seul un identifiant de thème court en lettres, chiffres et tirets est accepté.
  ipcMain.handle('os:mascotte:theme', (event, theme: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    if (typeof theme !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(theme)) return false
    ctx.themeDeLaMascotte = theme
    mascotteDuBureau.changerStyle(styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte))
    return true
  })
  // La même mascotte sur l'accueil d'un fil vide : sa vraie page, puis son humeur.
  ipcMain.handle('os:mascotte:page', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return {
      html: htmlDeMascotte(lireStyleMascotte()),
      largeur: LARGEUR_MASCOTTE,
      hauteur: HAUTEUR_MASCOTTE
    }
  })
  ipcMain.handle('os:mascotte:feuille-accueil', (event, humeur: unknown, agents: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    const connue = HUMEURS_ACCUEIL.includes(humeur as HumeurAccueil)
    return cssDeLAccueil(
      connue ? (humeur as HumeurAccueil) : 'eveil',
      typeof agents === 'number' && Number.isFinite(agents) ? Math.floor(agents) : 0,
      lireStyleMascotte()
    )
  })
  ipcMain.handle('app:titlebar-symbol-color', (event, couleur: unknown) => {
    assertTrustedRendererSender(event, 'Couleur des boutons de fenêtre')
    // On n'accepte qu'un hexadecimal : cette valeur part vers une API natice de Windows.
    if (typeof couleur !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(couleur)) return false
    const fenetre = BrowserWindow.fromWebContents(event.sender)
    if (!fenetre || fenetre.isDestroyed()) return false
    try {
      fenetre.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: couleur,
        height: HAUTEUR_BOUTONS_FENETRE
      })
      return true
    } catch {
      // Plateforme sans overlay de barre de titre (macOS, Linux) : ce n'est pas une panne.
      return false
    }
  })
  /*
   * `prefers-color-scheme` suit le THEME AUTOWIN, pas celui de Windows. Sans ce reglage, Electron
   * repond la preference du systeme (`themeSource: 'system'`) : un Windows en mode clair faisait
   * matcher `prefers-color-scheme: light` dans une app SOMBRE, et le HTML rendu dans le fil
   * appliquait ses couleurs de theme clair -- texte bleu marine sur fond noir (
   * 2026-10-08, `AppsUseLightTheme = 1`). Doc : https://www.electronjs.org/docs/latest/api/native-theme
   * Seules deux valeurs passent : `system` reviendrait exactement au defaut corrige ici.
   */
  ipcMain.handle('app:color-scheme', (event, schema: unknown) => {
    assertTrustedRendererSender(event, 'Schema de couleurs')
    if (schema !== 'dark' && schema !== 'light') return false
    nativeTheme.themeSource = schema
    return true
  })
  // Les couleurs du thème choisi pour la carte de fin de tour, qui vit hors de la page.
  // `definirPaletteDeCarte` n'accepte que huit `#rrggbb` : ces valeurs finissent dans du CSS.
  ipcMain.handle('app:carte-fin-de-tour-palette', (event, palette: unknown) => {
    assertTrustedRendererSender(event, 'Couleurs de la carte de fin de tour')
    return definirPaletteDeCarte(palette)
  })
  ipcMain.handle('update:check', (event) => {
    assertTrustedRendererSender(event, 'Update')
    return checkForUpdate(os.executionWorkspace)
  })
  ipcMain.handle('update:apply', async (event, action?: UpdateAction) => {
    assertTrustedRendererSender(event, 'Update')
    // La stratégie vient du BOUTON cliqué : hors de main, c'est ce qui distingue une intégration
    // demandée d'un merge fabriqué dans le dos de l'utilisateur.
    const result =
      action === 'abort-conflict'
        ? await abortUpdateConflict(os.executionWorkspace)
        : await applyUpdate(os.executionWorkspace, action ? { strategy: action } : {})
    if (result.ok && result.reload) {
      // Le changement ne touche que le renderer : on recharge les FENÊTRES et le process principal
      // reste vivant — donc les runs en cours, les connexions et l'état en mémoire survivent.
      // `reloadIgnoringCache` et pas `reload` : un bundle reconstruit sous le même nom serait
      // resservi depuis le cache, et l'utilisateur verrait l'ANCIEN écran en croyant l'avoir mis
      // à jour — un faux vert particulièrement traître puisqu'il ressemble à un succès.
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.reloadIgnoringCache()
      }
    } else if (result.ok && result.relaunch) {
      annoncerFermeture('mise a jour appliquee — relance demandee')
      restartApplication(app)
    }
    return result
  })
}
