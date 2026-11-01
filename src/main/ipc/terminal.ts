/**
 * TERMINAL INTÉGRÉ DU CHAT — les canaux IPC entre l'interface et le moteur (conv-1362, lot 3/3,
 * 2026-10-31).
 *
 * Le moteur (`../terminal-integre.ts`) porte toutes les règles ; ce module ne fait que trois choses :
 *  1. VÉRIFIER chaque appel à la frontière : expéditeur de confiance d'abord, puis la forme de chaque
 *     argument. Le dossier d'ouverture n'en fait pas partie : il vient du fil, jamais de l'interface ;
 *  2. créer LE gestionnaire de l'app. Contrairement au navigateur, il n'est pas lié à la fenêtre :
 *     fermer la fenêtre laisse l'app en zone de notification, et un terminal doit y survivre ;
 *  3. pousser la sortie et les changements d'état à la fenêtre principale du moment, relue à chaque
 *     envoi : une fenêtre rouverte reçoit la suite sans se réabonner.
 *
 * Comme dans `navigateur.ts`, les noms de canaux sont écrits EN TOUTES LETTRES dans `ipcMain.handle(` :
 * le contrôle de sécurité (`security-critical-fixes.test.ts`) ne voit que les canaux littéraux. La
 * dérive avec le contrat est fermée par `terminal.test.ts`.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import {
  GestionnaireTerminal,
  poserGestionnaireTerminal,
  type DependancesTerminal
} from '../terminal-integre'
import { CANAUX_TERMINAL, type TailleTerminal } from '../../shared/terminal'

/** Ce que le module prend de l'extérieur. */
export type TerminalIpcDeps = DependancesTerminal & {
  /** La fenêtre principale vivante, ou `null` (`window.ts`). */
  fenetrePrincipale: () => BrowserWindow | null
}

/** Le nom donné au contrôle d'expéditeur : c'est lui qu'un refus affiche. */
const PORTEE = 'Terminal intégré du chat'
/** Un identifiant de fil ou de terminal : court, jamais vide. */
const MAX_IDENTIFIANT = 200
/** Ce qu'un seul appel peut écrire : un gros collage passe, un fichier entier non. */
const MAX_ECRITURE = 1024 * 1024
/** Bornes larges : au-delà, c'est une valeur fausse, pas une grande fenêtre. */
const MAX_COLONNES = 2_000
const MAX_LIGNES = 1_000

function guardIdentifiant(valeur: unknown, nom: string): string {
  const texte = guardString(valeur, nom)
  if (!texte.trim() || texte.length > MAX_IDENTIFIANT) {
    throw new Error(`IPC ${nom}: valeur invalide`)
  }
  return texte
}

function guardEntier(valeur: unknown, nom: string, max: number): number {
  if (!Number.isInteger(valeur) || (valeur as number) < 1 || (valeur as number) > max) {
    throw new Error(`IPC ${nom}: entier de 1 à ${max} attendu`)
  }
  return valeur as number
}

function guardTaille(valeur: unknown, nom: string): TailleTerminal {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    throw new Error(`IPC ${nom}: taille attendue`)
  }
  const brut = valeur as Record<string, unknown>
  return {
    colonnes: guardEntier(brut.colonnes, `${nom}.colonnes`, MAX_COLONNES),
    lignes: guardEntier(brut.lignes, `${nom}.lignes`, MAX_LIGNES)
  }
}

function guardEcriture(valeur: unknown): string {
  const texte = guardString(valeur, 'terminal.ecrire.donnees')
  if (texte.length > MAX_ECRITURE) {
    throw new Error(`IPC terminal.ecrire.donnees: ${MAX_ECRITURE} caractères au plus`)
  }
  return texte
}

/** Branche les six canaux de `ApiTerminal` et crée le gestionnaire ; appelé UNE fois (`index.ts`). */
export function registerTerminalIpc(deps: TerminalIpcDeps): void {
  const { fenetrePrincipale, ...dependances } = deps
  const gestionnaire = new GestionnaireTerminal(dependances)
  poserGestionnaireTerminal(gestionnaire)

  const envoyer = (canal: string, valeur: unknown): void => {
    const fenetre = fenetrePrincipale()
    if (!fenetre || fenetre.isDestroyed() || fenetre.webContents.isDestroyed()) return
    fenetre.webContents.send(canal, valeur)
  }
  gestionnaire.surDonnees((morceau) => envoyer(CANAUX_TERMINAL.evenementDonnees, morceau))
  gestionnaire.surEtat((etat) => envoyer(CANAUX_TERMINAL.evenementEtat, etat))

  ipcMain.handle('terminal:etat', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    return gestionnaire.etat(guardIdentifiant(conversationId, 'terminal.etat'))
  })
  ipcMain.handle('terminal:ouvrir', (event, conversationId: unknown, taille: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const fil = guardIdentifiant(conversationId, 'terminal.ouvrir.conversationId')
    return gestionnaire.ouvrir(fil, guardTaille(taille, 'terminal.ouvrir.taille'))
  })
  ipcMain.handle('terminal:ecrire', (event, terminalId: unknown, donnees: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const terminal = guardIdentifiant(terminalId, 'terminal.ecrire.terminalId')
    gestionnaire.ecrire(terminal, guardEcriture(donnees))
  })
  ipcMain.handle('terminal:redimensionner', (event, terminalId: unknown, taille: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    const terminal = guardIdentifiant(terminalId, 'terminal.redimensionner.terminalId')
    gestionnaire.redimensionner(terminal, guardTaille(taille, 'terminal.redimensionner.taille'))
  })
  ipcMain.handle('terminal:fermer', (event, terminalId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    gestionnaire.fermer(guardIdentifiant(terminalId, 'terminal.fermer'))
  })
  ipcMain.handle('terminal:tampon', (event, terminalId: unknown) => {
    assertTrustedRendererSender(event, PORTEE)
    return gestionnaire.tampon(guardIdentifiant(terminalId, 'terminal.tampon'))
  })
}
