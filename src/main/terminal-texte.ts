/**
 * LA SORTIE D'UN TERMINAL EN TEXTE LISIBLE — ce que `terminal_lire` rend à l'agent (conv-1362, lot 3/3).
 *
 * Retirer les séquences (`shared/ansi.ts`) ne suffit pas ici. Un vrai terminal Windows ne produit pas
 * un flux de lignes : il REPEINT un écran. Capture du 2026-10-31 (PowerShell 5.1, 80 colonnes) :
 *  - `<ESC>[20;1HPS D:\…>` saute à la ligne 20 sans aucun saut de ligne : dépouillée, l'invite se colle
 *    à la fin de la sortie (« ansi.test.ts        PS D:\…> ») ;
 *  - `<ESC>[1;16H> ` repeint le « > » de l'invite à chaque frappe : dépouillée, « > > » ;
 *  - `cls` efface par `<ESC>[K` et `<ESC>[3J` : dépouillé, tout le texte effacé reste lisible.
 * L'agent lirait donc autre chose que ce que l'utilisateur voit. On rejoue le tampon sur un petit
 * écran virtuel, à la taille du terminal, et on lit l'écran.
 *
 * Limites connues, assumées : un caractère large compte pour une case, et l'écran alternatif (vim) se
 * rejoue sur l'écran normal. Une sortie ancienne, écrite avant un redimensionnement, est rejouée à la
 * largeur actuelle. Aucun caractère de contrôle ne sort d'ici : c'est le seul engagement ferme.
 */
import type { TailleTerminal } from '../shared/terminal'

const BS = 0x08
const TAB = 0x09
const LF = 0x0a
const VT = 0x0b
const FF = 0x0c
const CR = 0x0d
const ESC = 0x1b
const SUPPR = 0x7f
const CSI_8_BITS = 0x9b
const BEL = 0x07
const ANTISLASH = 0x5c
const CAN = 0x18
const SUB = 0x1a
const LARGEUR_TAB = 8
/** Rangées gardées au moins hors de l'écran : plus que ce que `terminal_lire` rend (2 000 lignes). */
const HISTORIQUE_MAX = 5_000

/** Une rangée de l'écran. `suite` : elle prolonge la précédente, coupée par la largeur du terminal. */
interface Rangee {
  cases: string[]
  suite: boolean
}

/** L'écran virtuel : toutes les rangées écrites, dont la dernière fenêtre est la partie visible. */
class Ecran {
  private readonly rangees: Rangee[] = []
  /** Indice dans `rangees` de la première rangée visible. */
  private origine = 0
  private ligne = 0
  private colonne = 0
  /** La dernière colonne vient d'être écrite : le retour à la ligne attend le prochain caractère. */
  private retourEnAttente = false
  private curseurGarde = { ligne: 0, colonne: 0 }

  constructor(
    private readonly largeur: number,
    private readonly hauteur: number
  ) {}

  private rangee(ligne = this.ligne): Rangee {
    const indice = this.origine + ligne
    while (this.rangees.length <= indice) this.rangees.push({ cases: [], suite: false })
    return this.rangees[indice]
  }

  private descendre(): void {
    if (this.ligne >= this.hauteur - 1) this.defilerVersLeHaut(1)
    else this.ligne += 1
  }

  ecrire(caractere: string): void {
    if (this.retourEnAttente) {
      this.retourEnAttente = false
      this.colonne = 0
      this.descendre()
      this.rangee().suite = true
    }
    const { cases } = this.rangee()
    while (cases.length < this.colonne) cases.push(' ')
    cases[this.colonne] = caractere
    if (this.colonne >= this.largeur - 1) this.retourEnAttente = true
    else this.colonne += 1
  }

  sautDeLigne(): void {
    this.retourEnAttente = false
    this.descendre()
  }

  retourChariot(): void {
    this.retourEnAttente = false
    this.colonne = 0
  }

  reculer(): void {
    this.retourEnAttente = false
    this.colonne = Math.max(0, this.colonne - 1)
  }

  tabulation(): void {
    this.retourEnAttente = false
    const suivante = (Math.floor(this.colonne / LARGEUR_TAB) + 1) * LARGEUR_TAB
    this.colonne = Math.min(this.largeur - 1, suivante)
  }

  placer(ligne: number, colonne: number): void {
    this.retourEnAttente = false
    this.ligne = Math.min(this.hauteur - 1, Math.max(0, ligne))
    this.colonne = Math.min(this.largeur - 1, Math.max(0, colonne))
  }

  deplacer(lignes: number, colonnes: number): void {
    this.placer(this.ligne + lignes, this.colonne + colonnes)
  }

  allerColonne(colonne: number): void {
    this.placer(this.ligne, colonne)
  }

  allerLigne(ligne: number): void {
    this.placer(ligne, this.colonne)
  }

  /** Ligne suivante ou précédente, colonne 1. */
  deplacerLigne(lignes: number): void {
    this.placer(this.ligne + lignes, 0)
  }

  garderCurseur(): void {
    this.curseurGarde = { ligne: this.ligne, colonne: this.colonne }
  }

  rendreCurseur(): void {
    this.placer(this.curseurGarde.ligne, this.curseurGarde.colonne)
  }

  /** EL : 0 = du curseur à la fin de la ligne, 1 = du début au curseur, 2 = toute la ligne. */
  effacerLigne(mode: number): void {
    const rangee = this.rangee()
    if (mode === 2) {
      rangee.cases = []
      rangee.suite = false
    } else if (mode === 1) {
      const fin = Math.min(this.colonne + 1, rangee.cases.length)
      rangee.cases.fill(' ', 0, fin)
    } else if (rangee.cases.length > this.colonne) {
      rangee.cases.length = this.colonne
    }
  }

  private viderRangee(ligne: number): void {
    const rangee = this.rangee(ligne)
    rangee.cases = []
    rangee.suite = false
  }

  /** ED : 0 = du curseur à la fin, 1 = du début au curseur, 2 = tout l'écran, 3 = l'historique. */
  effacerEcran(mode: number): void {
    if (mode === 3) {
      this.rangees.splice(0, this.origine)
      this.origine = 0
    } else if (mode === 2) {
      for (let l = 0; l < this.hauteur; l += 1) this.viderRangee(l)
    } else if (mode === 1) {
      for (let l = 0; l < this.ligne; l += 1) this.viderRangee(l)
      this.effacerLigne(1)
    } else {
      this.effacerLigne(0)
      for (let l = this.ligne + 1; l < this.hauteur; l += 1) this.viderRangee(l)
    }
  }

  /** ECH : remplace `nombre` cases par des blancs, sans bouger le curseur ni décaler la suite. */
  effacerCases(nombre: number): void {
    const { cases } = this.rangee()
    const fin = Math.min(this.colonne + nombre, cases.length)
    if (this.colonne < fin) cases.fill(' ', this.colonne, fin)
  }

  /** ICH : décale la fin de la ligne vers la droite. */
  insererCases(nombre: number): void {
    const { cases } = this.rangee()
    if (this.colonne < cases.length) {
      const blancs = new Array<string>(Math.min(nombre, this.largeur)).fill(' ')
      cases.splice(this.colonne, 0, ...blancs)
      if (cases.length > this.largeur) cases.length = this.largeur
    }
  }

  /** DCH : retire des cases, la fin de la ligne se décale vers la gauche. */
  retirerCases(nombre: number): void {
    this.rangee().cases.splice(this.colonne, nombre)
  }

  /** IL / DL : insère ou retire des rangées dans la partie visible, sous le curseur. */
  insererRangees(nombre: number): void {
    this.rangee(this.hauteur - 1)
    const debut = this.origine + this.ligne
    const borne = Math.min(nombre, this.hauteur - this.ligne)
    const neuves = Array.from({ length: borne }, () => ({ cases: [], suite: false }))
    this.rangees.splice(debut, 0, ...neuves)
    this.rangees.splice(this.origine + this.hauteur, borne)
  }

  retirerRangees(nombre: number): void {
    this.rangee(this.hauteur - 1)
    const debut = this.origine + this.ligne
    const borne = Math.min(nombre, this.hauteur - this.ligne)
    this.rangees.splice(debut, borne)
    this.rangee(this.hauteur - 1)
  }

  /**
   * SU : la partie visible monte, les rangées qui sortent en haut passent dans l'historique. Le compte
   * et l'historique sont bornés : un `<ESC>[999999999S` dans la sortie d'un programme épuisait la
   * mémoire du processus entier (code 134, test « sortie hostile »).
   */
  defilerVersLeHaut(nombre: number): void {
    this.origine += Math.min(nombre, this.hauteur)
    this.rangee(this.hauteur - 1)
    if (this.origine >= HISTORIQUE_MAX * 2) {
      this.rangees.splice(0, HISTORIQUE_MAX)
      this.origine -= HISTORIQUE_MAX
    }
  }

  reinitialiser(): void {
    this.rangees.length = 0
    this.origine = 0
    this.placer(0, 0)
  }

  /** Les lignes logiques : une ligne coupée par la largeur redevient une seule ligne. */
  lignes(): string[] {
    const lignes: string[] = []
    for (const rangee of this.rangees) {
      const texte = rangee.cases.join('').trimEnd()
      if (rangee.suite && lignes.length > 0) lignes[lignes.length - 1] += texte
      else lignes.push(texte)
    }
    while (lignes.length > 0 && lignes[lignes.length - 1] === '') lignes.pop()
    return lignes
  }
}

function joueCsi(ecran: Ecran, privee: boolean, parametres: string, finale: string): void {
  // `?25l`, `?1004h`… : des modes, aucun n'écrit à l'écran.
  if (privee) return
  const valeurs = parametres.split(';').map((p) => Number.parseInt(p, 10))
  const brut = (rang: number, defaut: number): number => {
    const valeur = valeurs[rang]
    return Number.isNaN(valeur) || valeur === undefined ? defaut : valeur
  }
  /** Compte d'un déplacement : 0 et absent valent 1. */
  const compte = (rang = 0): number => Math.max(1, brut(rang, 1))
  switch (finale) {
    case 'A':
      return ecran.deplacer(-compte(), 0)
    case 'B':
    case 'e':
      return ecran.deplacer(compte(), 0)
    case 'C':
    case 'a':
      return ecran.deplacer(0, compte())
    case 'D':
      return ecran.deplacer(0, -compte())
    case 'E':
      return ecran.deplacerLigne(compte())
    case 'F':
      return ecran.deplacerLigne(-compte())
    case 'G':
    case '`':
      return ecran.allerColonne(compte() - 1)
    case 'd':
      return ecran.allerLigne(compte() - 1)
    case 'H':
    case 'f':
      return ecran.placer(compte(0) - 1, compte(1) - 1)
    case 'J':
      return ecran.effacerEcran(brut(0, 0))
    case 'K':
      return ecran.effacerLigne(brut(0, 0))
    case 'X':
      return ecran.effacerCases(compte())
    case '@':
      return ecran.insererCases(compte())
    case 'P':
      return ecran.retirerCases(compte())
    case 'L':
      return ecran.insererRangees(compte())
    case 'M':
      return ecran.retirerRangees(compte())
    case 'S':
      return ecran.defilerVersLeHaut(compte())
    case 's':
      return ecran.garderCurseur()
    case 'u':
      return ecran.rendreCurseur()
    default:
      // Couleurs (`m`) et le reste : rien à montrer dans un texte.
      return
  }
}

/** Joue un CSI dont les paramètres commencent à `debut` ; rend l'indice qui suit la séquence. */
function lireCsi(ecran: Ecran, brut: string, debut: number): number {
  let i = debut
  while (i < brut.length) {
    const code = brut.charCodeAt(i)
    // Octet final : de `@` à `~`. Avant lui, paramètres (0x30-0x3F) et intermédiaires (0x20-0x2F).
    if (code >= 0x40 && code <= 0x7e) {
      const corps = brut.slice(debut, i)
      const privee = /^[<=>?]/.test(corps)
      joueCsi(ecran, privee, corps.replace(/[^0-9;]/g, ''), brut[i])
      return i + 1
    }
    if (code < 0x20 || code > 0x3f) return i
    i += 1
  }
  return i
}

/** Saute une chaîne OSC, DCS, APC, PM ou SOS : jusqu'à BEL, ou ST (`<ESC>\`). */
function sauterChaine(brut: string, debut: number): number {
  for (let i = debut; i < brut.length; i += 1) {
    const code = brut.charCodeAt(i)
    if (code === BEL || code === CAN || code === SUB) return i + 1
    if (code === ESC) return brut.charCodeAt(i + 1) === ANTISLASH ? i + 2 : i
  }
  return brut.length
}

/** Joue la séquence dont le `<ESC>` est en `debut` ; rend l'indice qui la suit. */
function lireEchappement(ecran: Ecran, brut: string, debut: number): number {
  const suivant = brut[debut + 1]
  if (suivant === undefined) return brut.length
  switch (suivant) {
    case '[':
      return lireCsi(ecran, brut, debut + 2)
    case ']':
    case 'P':
    case 'X':
    case '^':
    case '_':
      return sauterChaine(brut, debut + 2)
    case '7':
      ecran.garderCurseur()
      return debut + 2
    case '8':
      ecran.rendreCurseur()
      return debut + 2
    case 'c':
      ecran.reinitialiser()
      return debut + 2
    case 'D':
      ecran.sautDeLigne()
      return debut + 2
    case 'E':
      ecran.retourChariot()
      ecran.sautDeLigne()
      return debut + 2
    case 'M':
      ecran.deplacer(-1, 0)
      return debut + 2
  }
  // Désignation de jeu de caractères et cousines : intermédiaires puis un octet final.
  let i = debut + 1
  while (i < brut.length) {
    const code = brut.charCodeAt(i)
    if (code < 0x20 || code > 0x2f) break
    i += 1
  }
  return Math.min(i + 1, brut.length)
}

/**
 * Le texte d'une sortie brute, tel qu'il s'affiche dans un terminal de cette taille, ligne par ligne.
 * Rendu sans aucune séquence ni caractère de contrôle, historique compris.
 */
export function lignesDuTerminal(brut: string, taille: TailleTerminal): string[] {
  const ecran = new Ecran(Math.max(1, taille.colonnes), Math.max(1, taille.lignes))
  let i = 0
  while (i < brut.length) {
    const code = brut.charCodeAt(i)
    if (code === ESC) {
      i = lireEchappement(ecran, brut, i)
    } else if (code === CSI_8_BITS) {
      i = lireCsi(ecran, brut, i + 1)
    } else if (code === LF || code === VT || code === FF) {
      ecran.sautDeLigne()
      i += 1
    } else if (code === CR) {
      ecran.retourChariot()
      i += 1
    } else if (code === BS) {
      ecran.reculer()
      i += 1
    } else if (code === TAB) {
      ecran.tabulation()
      i += 1
    } else if (code < 0x20 || (code >= SUPPR && code < 0xa0)) {
      i += 1
    } else {
      const caractere = String.fromCodePoint(brut.codePointAt(i) ?? code)
      ecran.ecrire(caractere)
      i += caractere.length
    }
  }
  return ecran.lignes()
}
