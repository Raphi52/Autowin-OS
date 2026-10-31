/**
 * TERMINAL INTÉGRÉ DU CHAT — le moteur (conv-1362, lot 3/3, 2026-10-31).
 *
 * Un ou plusieurs vrais terminaux par fil, ouverts dans le dossier de travail du fil. Ce gestionnaire
 * vit avec l'APP, pas avec la fenêtre ni avec le fil affiché : changer de fil, fermer la fenêtre (l'app
 * reste en zone de notification) ou replier le panneau ne coupe rien, et le tampon de 200 Ko permet au
 * panneau de retrouver l'écran là où il était. Seules deux choses arrêtent un shell : la fermeture de
 * ce terminal ou de son fil, et la fermeture de l'app.
 *
 * LE MODULE NATIF N'EST JAMAIS IMPORTÉ STATIQUEMENT. Le paquet est absent de `node_modules` jusqu'au
 * redémarrage (aucun `npm install` tant que l'app tourne), et un module natif qui échoue à l'import
 * empêcherait toute l'app de démarrer pour une fonction annexe. Il est donc chargé à la première
 * ouverture, et son échec devient un état « indisponible » qui porte la raison exacte.
 *
 * LE TERMINAL RESTE À L'UTILISATEUR. L'agent n'y accède que par `lire`, en lecture seule, limité à son
 * fil : un numéro de terminal n'a de sens que dans son fil, l'outil ne peut donc pas viser celui d'un
 * autre. Aucune méthode d'écriture n'est offerte à l'agent (`TerminalDeLAgent`, `commands.ts`).
 */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { redactSecrets } from './crash-handlers'
import { environnementDeScript } from './scripts-copie-main'
import { lignesDuTerminal } from './terminal-texte'
import {
  TAMPON_TERMINAL_MAX,
  type DonneesTerminal,
  type EtatTerminal,
  type ResultatOuvertureTerminal,
  type TailleTerminal,
  type TamponTerminal,
  type TerminalIntegre
} from '../shared/terminal'

/** Ce qu'on prend du paquet natif : une interface locale, pour n'importer aucun de ses types. */
export interface PtyLocal {
  readonly pid: number
  onData(rappel: (donnees: string) => void): { dispose(): void }
  onExit(rappel: (fin: { exitCode: number }) => void): { dispose(): void }
  write(donnees: string): void
  resize(colonnes: number, lignes: number): void
  kill(): void
}

export interface OptionsPty {
  name: string
  cols: number
  rows: number
  cwd: string
  env: NodeJS.ProcessEnv
}

/** Lance un shell. La vraie vient de `chargerNodePty` ; les tests donnent la leur. */
export type FabriquePty = (fichier: string, args: string[], options: OptionsPty) => PtyLocal

const PAQUET_PTY = '@lydell/node-pty'

/**
 * Charge le paquet natif à l'exécution. `createRequire` et un nom passé en variable : ni Vite ni le
 * typage ne voient ce paquet, il reste hors du bundle et n'a pas besoin d'exister pour compiler.
 * Lève si le chargement échoue : c'est `GestionnaireTerminal.ouvrir` qui en fait un état.
 */
export function chargerNodePty(
  requerir: (nom: string) => unknown = createRequire(import.meta.url)
): FabriquePty {
  const module = requerir(PAQUET_PTY) as { spawn?: FabriquePty }
  const { spawn } = module
  if (typeof spawn !== 'function') throw new Error(`${PAQUET_PTY} n'expose pas spawn`)
  return (fichier, args, options) => spawn(fichier, args, options)
}

/**
 * Nos variables, jamais transmises au shell. `ELECTRON_*` et `AUTOWIN_*` sont déjà la règle de
 * `environnementDeScript` : `ELECTRON_RUN_AS_NODE` y transformerait tout Electron lancé à la main en
 * simple Node. S'y ajoutent les marques d'une session du CLI, que l'app hérite quand un agent l'a
 * relancée : avec elles, `claude` tapé dans ce terminal se croirait imbriqué dans un autre.
 */
const MARQUES_INTERNES =
  /^(NODE_ENV_ELECTRON_VITE|CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION_ID|SESSION_ATTENDED|CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN))$/i

/**
 * L'environnement du shell : celui des agents (même PATH, mêmes variables, même compte Claude), sans
 * nos variables internes.
 *
 * On ne reprend PAS `NON_INTERACTIVE_ENV` (`providers/claude.ts`) : ces réglages interdisent toute
 * invite pour qu'un agent échoue au lieu d'attendre. Ici, quelqu'un est au clavier : `git push` doit
 * pouvoir demander son identifiant, `git log` ouvrir son pager.
 */
export function environnementDuTerminal(base: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const env = environnementDeScript({}, base)
  for (const cle of Object.keys(env)) {
    if (MARQUES_INTERNES.test(cle)) delete env[cle]
  }
  return env
}

/** Le shell par défaut. `-NoLogo` : le panneau n'a pas à afficher le bandeau de Microsoft. */
function shellParDefaut(): { fichier: string; args: string[] } {
  if (process.platform === 'win32') return { fichier: 'powershell.exe', args: ['-NoLogo'] }
  return { fichier: process.env.SHELL || '/bin/sh', args: [] }
}

function estUnDossier(chemin: string): boolean {
  try {
    return statSync(chemin).isDirectory()
  } catch {
    return false
  }
}

const messageDe = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur)

/**
 * Ajoute au tampon et garde la fin, au plus `TAMPON_TERMINAL_MAX`. La coupe se fait au début d'une
 * ligne quand il y en a une : le panneau rejoue ce texte, et une coupe au milieu de `<ESC>[38;5;9m`
 * afficherait « 8;5;9m » en tête de l'écran. Une sortie sans aucun saut de ligne se coupe au caractère,
 * jamais au milieu d'une paire de surrogates.
 */
function ajouterAuTampon(tampon: string, donnees: string): string {
  const suite = tampon + donnees
  if (suite.length <= TAMPON_TERMINAL_MAX) return suite
  const coupe = suite.length - TAMPON_TERMINAL_MAX
  const saut = suite.indexOf('\n', coupe)
  if (saut >= 0) return suite.slice(saut + 1)
  const code = suite.charCodeAt(coupe)
  return suite.slice(code >= 0xdc00 && code <= 0xdfff ? coupe + 1 : coupe)
}

/** Ce que `lire` rend à l'agent : le texte, jamais le brut. */
export interface LectureTerminal {
  numero: number
  dossier: string
  enCours: boolean
  codeSortie?: number
  texte: string
  lignesRendues: number
  lignesTotales: number
  /** Les numéros des autres terminaux de ce fil : l'agent peut les lire aussi. */
  autresTerminaux: number[]
}

type TerminalVivant = TerminalIntegre & {
  pty: PtyLocal
  abonnements: Array<{ dispose(): void }>
  tampon: string
  sequence: number
  /** Compteur d'usage : le plus grand désigne le terminal dont l'utilisateur s'est servi en dernier. */
  usage: number
}

export interface DependancesTerminal {
  /** Le dossier de travail du fil : le même calcul que ses tours (`dossierDeTravailDuTour`). */
  dossierDuFil: (conversationId: string) => string
  /** L'environnement du shell, recalculé à chaque ouverture : le compte Claude peut avoir changé. */
  environnement: () => NodeJS.ProcessEnv
  /** Défaut : le vrai module natif (`chargerNodePty`). */
  chargerFabrique?: () => FabriquePty
}

export class GestionnaireTerminal {
  private readonly terminaux = new Map<string, TerminalVivant>()
  /** Dernier numéro donné, par fil. */
  private readonly numeros = new Map<string, number>()
  private readonly ecouteursDonnees = new Set<(donnees: DonneesTerminal) => void>()
  private readonly ecouteursEtat = new Set<(etat: EtatTerminal) => void>()
  private fabrique: FabriquePty | null = null
  private raisonIndisponible: string | undefined
  private usages = 0

  constructor(private readonly deps: DependancesTerminal) {}

  surDonnees(rappel: (donnees: DonneesTerminal) => void): () => void {
    this.ecouteursDonnees.add(rappel)
    return () => this.ecouteursDonnees.delete(rappel)
  }

  surEtat(rappel: (etat: EtatTerminal) => void): () => void {
    this.ecouteursEtat.add(rappel)
    return () => this.ecouteursEtat.delete(rappel)
  }

  etat(conversationId: string): EtatTerminal {
    return {
      conversationId,
      terminaux: this.duFil(conversationId).map(
        ({ id, numero, dossier, colonnes, lignes, enCours, codeSortie }) => ({
          id,
          conversationId,
          numero,
          dossier,
          colonnes,
          lignes,
          enCours,
          ...(codeSortie === undefined ? {} : { codeSortie })
        })
      ),
      ...(this.raisonIndisponible ? { indisponible: this.raisonIndisponible } : {})
    }
  }

  ouvrir(conversationId: string, taille: TailleTerminal): ResultatOuvertureTerminal {
    let fabrique: FabriquePty
    try {
      fabrique = this.fabrique ??= (this.deps.chargerFabrique ?? chargerNodePty)()
      this.raisonIndisponible = undefined
    } catch (erreur) {
      // Pas de mémoire de l'échec : le paquet posé par une mise à jour se chargera à l'essai suivant.
      this.raisonIndisponible = `Terminal indisponible : ${messageDe(erreur)}`
      this.emettreEtat(conversationId)
      return { ok: false, raison: this.raisonIndisponible }
    }

    const dossier = this.deps.dossierDuFil(conversationId)
    // Mesuré le 2026-10-31 : sur un dossier invalide, le système ne lève rien, le shell sort aussitôt
    // en code 267 sans une ligne. On le dit avant, sinon le panneau montrerait un terminal mort.
    if (!estUnDossier(dossier)) {
      return { ok: false, raison: `Dossier de travail introuvable : ${dossier}` }
    }

    const { fichier, args } = shellParDefaut()
    let pty: PtyLocal
    try {
      pty = fabrique(fichier, args, {
        name: 'xterm-256color',
        cols: taille.colonnes,
        rows: taille.lignes,
        cwd: dossier,
        env: this.deps.environnement()
      })
    } catch (erreur) {
      return { ok: false, raison: `Ouverture du terminal impossible : ${messageDe(erreur)}` }
    }

    const numero = (this.numeros.get(conversationId) ?? 0) + 1
    this.numeros.set(conversationId, numero)
    const terminal: TerminalVivant = {
      id: randomUUID(),
      conversationId,
      numero,
      dossier,
      colonnes: taille.colonnes,
      lignes: taille.lignes,
      enCours: true,
      pty,
      abonnements: [],
      tampon: '',
      sequence: 0,
      usage: (this.usages += 1)
    }
    this.terminaux.set(terminal.id, terminal)
    terminal.abonnements.push(
      pty.onData((donnees) => this.recevoir(terminal, donnees)),
      pty.onExit(({ exitCode }) => this.surFin(terminal, exitCode))
    )
    this.emettreEtat(conversationId)
    const { terminaux } = this.etat(conversationId)
    return { ok: true, terminal: terminaux[terminaux.length - 1] }
  }

  ecrire(terminalId: string, donnees: string): void {
    const terminal = this.terminaux.get(terminalId)
    if (!terminal?.enCours) return
    terminal.usage = this.usages += 1
    terminal.pty.write(donnees)
  }

  redimensionner(terminalId: string, taille: TailleTerminal): void {
    const terminal = this.terminaux.get(terminalId)
    if (!terminal?.enCours) return
    if (terminal.colonnes === taille.colonnes && terminal.lignes === taille.lignes) return
    terminal.pty.resize(taille.colonnes, taille.lignes)
    terminal.colonnes = taille.colonnes
    terminal.lignes = taille.lignes
    this.emettreEtat(terminal.conversationId)
  }

  tampon(terminalId: string): TamponTerminal | null {
    const terminal = this.terminaux.get(terminalId)
    if (!terminal) return null
    return { terminalId, donnees: terminal.tampon, sequence: terminal.sequence }
  }

  /** Arrête CE terminal. Sans effet s'il n'existe plus. */
  fermer(terminalId: string): void {
    const terminal = this.terminaux.get(terminalId)
    if (!terminal) return
    this.arreter(terminal)
    this.emettreEtat(terminal.conversationId)
  }

  /** Le fil est supprimé : ses terminaux s'arrêtent, ses numéros repartent de 1. */
  fermerFil(conversationId: string): void {
    const duFil = this.duFil(conversationId)
    this.numeros.delete(conversationId)
    if (duFil.length === 0) return
    for (const terminal of duFil) this.arreter(terminal)
    this.emettreEtat(conversationId)
  }

  /**
   * Fermeture de l'app : tous nos terminaux, un par un. Rend le nombre de shells arrêtés. Rejouable :
   * `before-quit` repasse.
   */
  fermerTout(): number {
    let arretes = 0
    for (const terminal of [...this.terminaux.values()]) {
      if (this.arreter(terminal)) arretes += 1
    }
    return arretes
  }

  /**
   * La lecture de l'agent : le terminal `numero` de SON fil, ou celui dont l'utilisateur s'est servi
   * en dernier ; `null` s'il n'y en a pas. Le texte part chez le modèle : ce qui ressemble à un secret
   * est masqué (`redactSecrets`), l'affichage du panneau n'est pas concerné.
   */
  lire(
    conversationId: string,
    demande: { numero?: number; lignes: number }
  ): LectureTerminal | null {
    const duFil = this.duFil(conversationId)
    const terminal =
      demande.numero === undefined
        ? duFil.reduce<TerminalVivant | null>(
            (dernier, t) => (dernier === null || t.usage > dernier.usage ? t : dernier),
            null
          )
        : duFil.find((t) => t.numero === demande.numero)
    if (!terminal) return null

    const lignes = lignesDuTerminal(terminal.tampon, terminal)
    const rendues = lignes.slice(-demande.lignes)
    return {
      numero: terminal.numero,
      dossier: terminal.dossier,
      enCours: terminal.enCours,
      ...(terminal.codeSortie === undefined ? {} : { codeSortie: terminal.codeSortie }),
      texte: redactSecrets(rendues.join('\n')),
      lignesRendues: rendues.length,
      lignesTotales: lignes.length,
      autresTerminaux: duFil.filter((t) => t !== terminal).map((t) => t.numero)
    }
  }

  private duFil(conversationId: string): TerminalVivant[] {
    return [...this.terminaux.values()].filter((t) => t.conversationId === conversationId)
  }

  private recevoir(terminal: TerminalVivant, donnees: string): void {
    terminal.tampon = ajouterAuTampon(terminal.tampon, donnees)
    terminal.sequence += 1
    const morceau: DonneesTerminal = {
      terminalId: terminal.id,
      conversationId: terminal.conversationId,
      donnees,
      sequence: terminal.sequence
    }
    for (const rappel of this.ecouteursDonnees) rappel(morceau)
  }

  /**
   * Le shell s'est arrêté de lui-même : le terminal reste lisible, son tampon est à nous.
   *
   * Limite connue, mesurée le 2026-10-31 : son `conhost.exe` reste vivant jusqu'à la sortie de l'app.
   * `pty.kill` n'y peut rien : à la fin du shell, node-pty oublie sa console sans la fermer
   * (`conpty.cc`, `SetupExitCallback`), et `kill` ne la retrouve plus. On ne l'appelle donc pas : il
   * lancerait un processus auxiliaire pour rien.
   */
  private surFin(terminal: TerminalVivant, codeSortie: number): void {
    terminal.enCours = false
    terminal.codeSortie = codeSortie
    this.emettreEtat(terminal.conversationId)
  }

  /**
   * Retire UN terminal et arrête son shell s'il tourne encore, par SON processus : `pty.kill` vise son
   * pid et ce qui tourne dans sa console, jamais un nom, qui emporterait les PowerShell de l'utilisateur
   * et ceux des agents. Rend vrai s'il l'a arrêté. Un échec n'empêche pas d'arrêter les suivants : il
   * part au journal.
   */
  private arreter(terminal: TerminalVivant): boolean {
    this.terminaux.delete(terminal.id)
    for (const abonnement of terminal.abonnements) abonnement.dispose()
    if (!terminal.enCours) return false
    terminal.enCours = false
    try {
      terminal.pty.kill()
    } catch (erreur) {
      console.warn(`[terminal] arrêt du processus ${terminal.pty.pid} impossible :`, erreur)
    }
    return true
  }

  private emettreEtat(conversationId: string): void {
    if (this.ecouteursEtat.size === 0) return
    const etat = this.etat(conversationId)
    for (const rappel of this.ecouteursEtat) rappel(etat)
  }
}

/**
 * LE gestionnaire de l'app. Il vit ici, pas dans `ipc/terminal.ts` : `arret-avant-suppression.ts` doit
 * l'atteindre sans importer Electron, et les quatre chemins de suppression d'un fil passent par lui.
 */
let gestionnaireDeLApp: GestionnaireTerminal | null = null

export function poserGestionnaireTerminal(gestionnaire: GestionnaireTerminal | null): void {
  gestionnaireDeLApp = gestionnaire
}

export function gestionnaireTerminal(): GestionnaireTerminal | null {
  return gestionnaireDeLApp
}

/** Arrête les terminaux d'un fil supprimé. Ne charge rien : sans terminal ouvert, c'est sans effet. */
export function fermerTerminauxDuFil(conversationId: string): void {
  gestionnaireDeLApp?.fermerFil(conversationId)
}

/** Assez pour que les shells soient partis : 52 à 118 ms mesurées, sur un programme en cours aussi. */
export const DELAI_SORTIE_APRES_ARRET_MS = 150

/**
 * À appeler en tête de `before-quit`. Arrête nos terminaux ; s'il y en avait, rend vrai : la sortie est
 * retenue (`event.preventDefault`) et `quitter` repartira au tour suivant.
 *
 * Sortir d'Electron dans le même tour que les `pty.kill` le FIGE : mesuré le 2026-10-31 dans Electron
 * 44.5.1, deux terminaux, 2 sorties sur 3 passent `quit` et le processus ne se termine jamais, ce qui
 * garderait le verrou d'instance unique et empêcherait de rouvrir l'app. La cause est le processus
 * auxiliaire que chaque `kill` lance pour lister la console (`_getConsoleProcessList`) : sans lui, 4
 * sorties sur 4 sont nettes, et rendre la main ne serait-ce qu'à 0 ms suffit, 9 sur 9.
 */
export function fermerTerminauxAvantSortie(quitter: () => void): boolean {
  if ((gestionnaireDeLApp?.fermerTout() ?? 0) === 0) return false
  setTimeout(quitter, DELAI_SORTIE_APRES_ARRET_MS)
  return true
}
