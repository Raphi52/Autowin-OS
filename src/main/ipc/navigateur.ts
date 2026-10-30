/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — les canaux IPC entre l'interface et le moteur (conv-1286, lot 2/5,
 * 2026-10-29).
 *
 * Le moteur (`../navigateur-integre.ts`) porte toutes les règles ; ce module ne fait que trois choses :
 *  1. VÉRIFIER chaque appel à la frontière : expéditeur de confiance d'abord, puis la forme de chaque
 *     argument (un identifiant vide, un rectangle non numérique ou un mode inconnu sont refusés AVANT
 *     d'atteindre le moteur) ;
 *  2. tenir UN gestionnaire, lié à la fenêtre principale vivante (`fenetrePrincipale` de
 *     `window.ts`) : ses pages sont posées DANS cette fenêtre. Fermer la fenêtre ne quitte pas l'app
 *     (elle vit dans la barre d'état) : les pages se ferment avec elle, et la fenêtre rouverte reçoit
 *     un gestionnaire neuf. Sans « garder les cookies », les données sont effacées à ce moment-là ;
 *  3. pousser chaque changement d'état à la fenêtre principale, sur `CANAUX_NAVIGATEUR.evenementEtat`.
 *
 * Pourquoi les noms de canaux sont écrits EN TOUTES LETTRES dans `ipcMain.handle(` au lieu de
 * `CANAUX_NAVIGATEUR.x` : le contrôle de sécurité (`security-critical-fixes.test.ts`) ne voit que les
 * canaux littéraux — il vérifie que chacun est gardé et les compte. Avec la constante, ces vingt et un
 * canaux lui échapperaient. La dérive avec le contrat est fermée par `navigateur.test.ts`, qui exige que les
 * canaux enregistrés soient EXACTEMENT ceux de `CANAUX_NAVIGATEUR`.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardBoolean, guardString, guardStringOrNull } from '../ipc-guards'
import {
  creerFabriqueElectron,
  GestionnaireNavigateur,
  type FabriqueVueNavigateur
} from '../navigateur-integre'
import {
  CANAUX_NAVIGATEUR,
  type ModeNavigateur,
  type OrdrePilotageNavigateur,
  type RectNavigateur,
  type ReglagesNavigateur,
  type ReponseAccordNavigateur
} from '../../shared/navigateur'

/** Ce que le module prend de l'extérieur. */
export type NavigateurIpcDeps = {
  /** La fenêtre principale vivante, ou `null` (`window.ts`). */
  fenetrePrincipale: () => BrowserWindow | null
  /** La fabrique des pages ; défaut : une `WebContentsView` par onglet. Remplacée par les tests. */
  creerFabrique?: (fenetre: BrowserWindow) => FabriqueVueNavigateur
  /** Dossier des réglages et des sites autorisés ; défaut : racine de données de l'app. */
  racine?: string
}

/** Le nom donné au contrôle d'expéditeur : c'est lui qu'un refus affiche. */
const PORTEE = 'Navigateur intégré du chat'
/** Un identifiant de fil, d'onglet ou d'annotation : court, jamais vide. */
const MAX_IDENTIFIANT = 200
/** Une origine (`https://exemple.fr`) : une adresse sans chemin. */
const MAX_ORIGINE = 2_048

let dependances: NavigateurIpcDeps | null = null
let liaison: { fenetre: BrowserWindow; gestionnaire: GestionnaireNavigateur } | null = null

/**
 * LE gestionnaire de la fenêtre principale, créé à la première demande ; `null` quand la fenêtre est
 * fermée (ou avant l'enregistrement). Exporté pour le lot 4, qui le branche sur les commandes de
 * l'agent : il doit le redemander à chaque commande, la fenêtre rouverte en ayant un neuf.
 */
export function gestionnaireNavigateur(): GestionnaireNavigateur | null {
  if (!dependances) return null
  const fenetre = dependances.fenetrePrincipale()
  if (liaison && liaison.fenetre !== fenetre) delier()
  if (!fenetre || fenetre.isDestroyed()) return null
  if (liaison) return liaison.gestionnaire

  const gestionnaire = new GestionnaireNavigateur({
    fabrique: (dependances.creerFabrique ?? creerFabriqueElectron)(fenetre),
    ...(dependances.racine ? { racine: dependances.racine } : {})
  })
  gestionnaire.surEtat((etat) => {
    if (fenetre.isDestroyed() || fenetre.webContents.isDestroyed()) return
    fenetre.webContents.send(CANAUX_NAVIGATEUR.evenementEtat, etat)
  })
  liaison = { fenetre, gestionnaire }
  fenetre.once('closed', () => {
    if (liaison?.fenetre === fenetre) delier()
  })
  return gestionnaire
}

/** Ferme les pages du gestionnaire lié ; sans « garder les cookies », efface les données. */
function delier(): void {
  if (!liaison) return
  const { gestionnaire } = liaison
  liaison = null
  const garderCookies = gestionnaire.lireReglages().garderCookies
  gestionnaire.detruire()
  if (!garderCookies) {
    void gestionnaire.effacerDonnees().catch((erreur: unknown) => {
      console.warn('[navigateur] effacement des données à la fermeture impossible :', erreur)
    })
  }
}

/** Le gestionnaire, ou un refus lisible : la fenêtre qui porte les pages n'existe plus. */
function exiger(): GestionnaireNavigateur {
  const gestionnaire = gestionnaireNavigateur()
  if (!gestionnaire) {
    throw new Error('Navigateur intégré indisponible : la fenêtre principale est fermée.')
  }
  return gestionnaire
}

// ─── Gardes propres au navigateur ───────────────────────────────────────────────────────────────

function guardTexteNonVide(valeur: unknown, nom: string, max: number): string {
  const texte = guardString(valeur, nom)
  if (!texte.trim() || texte.length > max) throw new Error(`IPC ${nom}: valeur invalide`)
  return texte
}

function guardIdentifiant(valeur: unknown, nom: string): string {
  return guardTexteNonVide(valeur, nom, MAX_IDENTIFIANT)
}

function guardNombreFini(valeur: unknown, nom: string): number {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
    throw new Error(`IPC ${nom}: nombre fini attendu`)
  }
  return valeur
}

/** `null` cache la page ; sinon quatre nombres finis, largeur et hauteur positives ou nulles. */
function guardRect(valeur: unknown): RectNavigateur | null {
  if (valeur === null) return null
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    throw new Error('IPC navigateur.poserCadre: rectangle ou null attendu')
  }
  const brut = valeur as Record<string, unknown>
  const rect: RectNavigateur = {
    x: guardNombreFini(brut.x, 'navigateur.poserCadre.x'),
    y: guardNombreFini(brut.y, 'navigateur.poserCadre.y'),
    largeur: guardNombreFini(brut.largeur, 'navigateur.poserCadre.largeur'),
    hauteur: guardNombreFini(brut.hauteur, 'navigateur.poserCadre.hauteur')
  }
  if (rect.largeur < 0 || rect.hauteur < 0) {
    throw new Error('IPC navigateur.poserCadre: dimensions négatives')
  }
  return rect
}

function guardZoom(valeur: unknown): number {
  const zoom = guardNombreFini(valeur, 'navigateur.poserCadre.zoom')
  if (zoom <= 0) throw new Error('IPC navigateur.poserCadre.zoom: zoom positif attendu')
  return zoom
}

function guardMode(valeur: unknown): ModeNavigateur {
  if (valeur === null || valeur === 'annoter' || valeur === 'choisir') return valeur
  throw new Error('IPC navigateur.basculerMode: « annoter », « choisir » ou null attendu')
}

function guardReponseAccord(valeur: unknown): ReponseAccordNavigateur {
  if (valeur === 'une-fois' || valeur === 'toujours' || valeur === 'refuser') return valeur
  throw new Error(
    'IPC navigateur.repondreAccord: « une-fois », « toujours » ou « refuser » attendu'
  )
}

const ORDRES_PILOTAGE: ReadonlySet<unknown> = new Set<OrdrePilotageNavigateur>([
  'pause',
  'reprendre',
  'pas-suivant',
  'reprendre-la-main',
  'rendre-la-main'
])

function guardOrdrePilotage(valeur: unknown): OrdrePilotageNavigateur {
  if (ORDRES_PILOTAGE.has(valeur)) return valeur as OrdrePilotageNavigateur
  throw new Error(
    'IPC navigateur.piloter: « pause », « reprendre », « pas-suivant », « reprendre-la-main » ou « rendre-la-main » attendu'
  )
}

/** Un réglage partiel : seuls les deux réglages connus sont lus, et chacun doit être un booléen. */
function guardReglages(valeur: unknown): Partial<ReglagesNavigateur> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    throw new Error('IPC navigateur.reglages: objet attendu')
  }
  const brut = valeur as Record<string, unknown>
  const partiel: Partial<ReglagesNavigateur> = {}
  if (brut.garderCookies !== undefined) {
    partiel.garderCookies = guardBoolean(brut.garderCookies, 'navigateur.reglages.garderCookies')
  }
  if (brut.ouvrirLiensDuChatIci !== undefined) {
    partiel.ouvrirLiensDuChatIci = guardBoolean(
      brut.ouvrirLiensDuChatIci,
      'navigateur.reglages.ouvrirLiensDuChatIci'
    )
  }
  return partiel
}

// ─── Les canaux ─────────────────────────────────────────────────────────────────────────────────

/** Branche les vingt et un canaux de `ApiNavigateur` ; appelé UNE fois au démarrage (`index.ts`). */
export function registerNavigateurIpc(deps: NavigateurIpcDeps): void {
  dependances = deps

  ipcMain.handle('navigateur:etat', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'navigateur.etat')
    return exiger().etat(fil)
  })
  ipcMain.handle('navigateur:afficher-fil', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const brut = guardStringOrNull(conversationId, 'navigateur.afficherFil')
    const fil = brut === null ? null : guardIdentifiant(brut, 'navigateur.afficherFil')
    exiger().afficherFil(fil)
  })
  ipcMain.handle('navigateur:ouvrir', (event, conversationId: unknown, url: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'navigateur.ouvrir.conversationId')
    const adresse = guardString(url, 'navigateur.ouvrir.url')
    return exiger().ouvrir(fil, adresse)
  })
  ipcMain.handle('navigateur:naviguer', (event, ongletId: unknown, url: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.naviguer.ongletId')
    const adresse = guardString(url, 'navigateur.naviguer.url')
    exiger().naviguer(onglet, adresse)
  })
  ipcMain.handle('navigateur:reculer', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.reculer')
    exiger().reculer(onglet)
  })
  ipcMain.handle('navigateur:avancer', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.avancer')
    exiger().avancer(onglet)
  })
  ipcMain.handle('navigateur:recharger', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.recharger')
    exiger().recharger(onglet)
  })
  ipcMain.handle('navigateur:arreter', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.arreter')
    exiger().arreter(onglet)
  })
  ipcMain.handle('navigateur:activer-onglet', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.activerOnglet')
    exiger().activerOnglet(onglet)
  })
  ipcMain.handle('navigateur:fermer-onglet', (event, ongletId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const onglet = guardIdentifiant(ongletId, 'navigateur.fermerOnglet')
    exiger().fermerOnglet(onglet)
  })
  ipcMain.handle('navigateur:poser-cadre', (event, rect: unknown, zoom: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const cadre = guardRect(rect)
    const facteur = guardZoom(zoom)
    exiger().poserCadre(cadre, facteur)
  })
  ipcMain.handle('navigateur:basculer-mode', async (event, mode: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const voulu = guardMode(mode)
    await exiger().basculerMode(voulu)
  })
  ipcMain.handle('navigateur:annotations', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'navigateur.annotations')
    return exiger().annotations(fil)
  })
  ipcMain.handle('navigateur:supprimer-annotation', (event, id: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const annotation = guardIdentifiant(id, 'navigateur.supprimerAnnotation')
    exiger().supprimerAnnotation(annotation)
  })
  ipcMain.handle('navigateur:vider-annotations', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'navigateur.viderAnnotations')
    exiger().viderAnnotations(fil)
  })
  ipcMain.handle('navigateur:repondre-accord', (event, origine: unknown, reponse: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const site = guardTexteNonVide(origine, 'navigateur.repondreAccord.origine', MAX_ORIGINE)
    const choix = guardReponseAccord(reponse)
    exiger().repondreAccord(site, choix)
  })
  ipcMain.handle('navigateur:reglages-lire', (event) => {
    assertTrustedRendererSender(event, PORTEE)
    return exiger().lireReglages()
  })
  ipcMain.handle('navigateur:reglages-ecrire', (event, reglages: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const partiel = guardReglages(reglages)
    return exiger().ecrireReglages(partiel)
  })
  ipcMain.handle('navigateur:effacer-donnees', async (event) => {
    assertTrustedRendererSender(event, PORTEE)
    await exiger().effacerDonnees()
  })
  ipcMain.handle('navigateur:ouvrir-dans-navigateur-par-defaut', async (event, url: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const adresse = guardString(url, 'navigateur.ouvrirDansNavigateurParDefaut')
    await exiger().ouvrirDansNavigateurParDefaut(adresse)
  })
  // Pas-à-pas (conv-1286, 2026-10-30) : boutons Pause, Reprendre, Pas suivant, Reprendre la main et
  // Rendre la main du bandeau, pour UN fil. Le moteur ne fait que libérer, retenir ou refuser les
  // gestes de l'agent : aucune page chargée, rien écrit sur le disque.
  ipcMain.handle('navigateur:piloter', (event, conversationId: unknown, ordre: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'navigateur.piloter.conversationId')
    const voulu = guardOrdrePilotage(ordre)
    exiger().piloter(fil, voulu)
  })
}
