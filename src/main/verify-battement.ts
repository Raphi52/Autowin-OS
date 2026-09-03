/**
 * LE SIGNE DE VIE D'UNE VERIFICATION EN COURS.
 *
 * DEFAUT VECU le 2026-08-25 (conv-1400). Un tour a lance `verify`, qui rejoue la suite unitaire.
 * Elle a tourne dix minutes puis a ete coupee au plafond. Pendant tout ce temps le fil n'affichait
 * que « 1 action en cours » — pas une ligne de plus. L'utilisateur a demande « ca me met une action
 * en cours mais je le vois rien faire » : rien, a l'ecran, ne distinguait une suite qui TRAVAILLE
 * d'une suite BLOQUEE sur un test qui ne rend jamais la main, ni d'une app plantee.
 *
 * Ce module ne fait qu'une chose, et il la fait sans IPC ni horloge : transformer le tampon deja
 * collecte + le temps ecoulé en UNE ligne. C'est ce decouplage qui le rend testable — le defaut
 * d'origine vivait justement dans du code impossible a observer autrement qu'en attendant 600 s.
 */

import { sansSequencesAnsi } from '../shared/ansi'

/** Au-dela, la ligne deformerait le fil ; elle doit rester une ligne, pas un paragraphe. */
const LARGEUR_MAX = 140

/** Temps ecoulé en francais court : « 45 s », « 1 min », « 3 min 20 s ». */
function dureeCourte(ms: number): string {
  const secondes = Math.max(0, Math.round(ms / 1000))
  if (secondes < 60) return `${secondes} s`
  const minutes = Math.floor(secondes / 60)
  const reste = secondes % 60
  return reste === 0 ? `${minutes} min` : `${minutes} min ${reste} s`
}

/**
 * La derniere ligne UTILE du tampon.
 *
 * Les retours chariot sont des separateurs a part entiere : vitest repeint sa ligne d'avancement
 * avec `\r` plutot qu'avec `\n`, donc un decoupage sur les seuls sauts de ligne rendrait plusieurs
 * etats concatenes — « Tests 10/900Tests 411/900Tests 412/900 », illisible.
 */
function derniereLigneUtile(sortie: string): string | undefined {
  /*
   * DEPOUILLER D'ABORD, MESURER ENSUITE.
   *
   * DEFAUT VECU le 2026-08-25 (conv-1404) : le fil affichait « 9 min 27 s · <ESC>[33m<ESC>[2m … ».
   * Deux degats et non un : les codes salissent la ligne, ET ils sont COMPTES dans la largeur max,
   * donc le texte utile etait coupe bien avant sa vraie longueur. Depouiller avant le decoupage
   * traite les deux d'un coup — et une ligne qui ne contenait QUE des codes redevient vide, donc
   * elle ne peut plus voler la place de la derniere ligne reellement utile.
   */
  const lignes = sansSequencesAnsi(sortie)
    .split(/[\r\n]+/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0)
  return lignes.length > 0 ? lignes[lignes.length - 1] : undefined
}

/**
 * UNE ligne repondant a la seule question posee devant l'ecran : « ca avance, depuis quand ? ».
 *
 * Sans sortie, le temps ecoulé suffit — il prouve deja que le processus vit, ce que l'absence
 * totale de signal ne faisait pas.
 */
export function battementDeVerification(sortie: string, ecouleMs: number): string {
  const duree = dureeCourte(ecouleMs)
  const ligne = derniereLigneUtile(sortie) ?? 'démarrage…'
  return bornerLigneDeVie(`${duree} · ${ligne}`)
}

/**
 * LA BORNE COMMUNE A TOUTE LIGNE DE VIE, quelle que soit sa source.
 *
 * Elle existe parce qu'il y en a desormais DEUX : la sortie d'une verification, et la note
 * d'activite d'une orchestration (« Bash en cours — 2 min 30 s »). Les deux atterrissent au meme
 * endroit du fil et doivent donc obeir aux memes regles — depouiller les codes de terminal AVANT de
 * mesurer la largeur, puis tenir sur une ligne. Deux bornes divergentes auraient produit deux
 * apparences pour un meme role.
 */
export function bornerLigneDeVie(texte: string): string {
  const propre = sansSequencesAnsi(texte).replace(/\s+/g, ' ').trim()
  if (propre.length <= LARGEUR_MAX) return propre
  return `${propre.slice(0, LARGEUR_MAX - 1)}…`
}

/**
 * CADENCE du battement. Assez court pour que l'attente reste vivante a l'oeil, assez espace pour ne
 * pas inonder le fil : une suite de dix minutes produit ~120 lignes remplacees, pas 120 lignes
 * empilees (le reducteur REMPLACE, il n'accumule pas).
 */
export const VERIFY_BATTEMENT_MS = 5_000
