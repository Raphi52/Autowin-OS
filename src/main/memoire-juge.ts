/**
 * LA MEMOIRE DU JUGE ENTRE DEUX PASSAGES DE REPARATION.
 *
 * Constat conv-35 (2026-09-30) : 109 passages, dont ~107 APRES que les juges avaient valide. Deux
 * causes lues dans le code :
 *   1. chaque juge repartait de zero — son prompt ne contenait jamais le verdict precedent, il
 *      relisait partiellement et relevait d'AUTRES details a chaque tour ;
 *   2. en mode « jusqu'au vert » (conv-844), une reserve MINEUR bloque et plus rien n'arrete un
 *      refus qui se repete : les memes reserves revenaient sans fin.
 * Ce module donne au juge ses objections precedentes (1) et reconnait, PAR DU CODE, un VALIDE dont
 * les seules reserves MINEUR sont revenues identiques (2). Une reserve NOUVELLE relance toujours.
 */
import { objectionsDuJuge, verdictPanelValide } from './objections-juge'

/** Borne du rappel : le prompt du juge ne grossit que de quelques objections. */
const MAX_OBJECTIONS_RAPPELEES = 12
const MAX_CARACTERES_PAR_OBJECTION = 300

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[`*_"«»“”'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function premiereLigneValide(text: string): boolean {
  const premiere = (text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  return /^\W*valide\b/i.test(premiere.trim())
}

/**
 * Les reserves d'un verdict QUAND ce sont les seules choses qui bloquent : verdict VALIDE, au moins
 * une puce MINEUR, aucune puce MAJEUR ni puce non etiquetee. Sinon `null` (on ne touche a rien).
 * Rendues normalisees et triees, pour comparer deux verdicts.
 */
export function reservesMineuresSeules(text: string): string[] | null {
  if (!premiereLigneValide(text)) return null
  const bloquantes = objectionsDuJuge(text)
  if (bloquantes.length === 0) return null
  // Meme lecteur, MINEUR rendu non bloquant : s'il ne reste rien, tout ce qui bloquait etait MINEUR.
  const sansMineur = text.replace(/^(\s*(?:[-*•]|\d+[.)])\s+\**\s*)MINEUR(\s*\**\s*:)/gim, '$1OK$2')
  if (objectionsDuJuge(sansMineur).length > 0) return null
  return [...new Set(bloquantes.map(normaliser))].sort()
}

/** Deux verdicts portent-ils EXACTEMENT les memes reserves mineures (et rien d'autre) ? */
export function memesReservesMineures(courant: string, precedent: string): boolean {
  const a = reservesMineuresSeules(courant)
  const b = reservesMineuresSeules(precedent)
  if (!a || !b || a.length !== b.length) return false
  return a.every((r, i) => r === b[i])
}

/** Motif d'arret nomme, les reserves restent dans le verdict rendu. */
export const MOTIF_RESERVES_MINEURES_FIGEES =
  'Réparation interrompue : le juge a validé et rendu exactement les mêmes réserves mineures deux passages de suite — la réparation ne les fait plus bouger. Elles restent listées dans le verdict ci-dessous.'

/**
 * Le rappel injecte dans le prompt du juge a partir du 2e passage. Vide au premier passage.
 * Le juge doit statuer sur CHAQUE objection precedente et lister TOUS les ecarts en une fois.
 */
export function noteVerdictPrecedentPourJuge(verdictPrecedent: string): string {
  const texte = (verdictPrecedent ?? '').trim()
  if (!texte) return ''
  const objections = objectionsDuJuge(texte).slice(0, MAX_OBJECTIONS_RAPPELEES)
  const liste = objections.length
    ? objections
        .map((o) => `- ${o.length > MAX_CARACTERES_PAR_OBJECTION ? `${o.slice(0, MAX_CARACTERES_PAR_OBJECTION)}…` : o}`)
        .join('\n')
    : '- (le verdict précédent ne listait aucune objection lisible)'
  return (
    `VERDICT PRÉCÉDENT — ce livrable sort d'une réparation. Objections du juge précédent :\n${liste}\n` +
    `Pour CHAQUE objection ci-dessus, dis dans OBJECTIONS si elle est corrigée (OK: …) ou non (même gravité, même formulation). ` +
    `Puis liste en UNE FOIS TOUS les autres écarts que tu constates : un écart passé sous silence ce tour-ci et relevé au suivant coûte une réparation entière.\n`
  )
}

/**
 * Le verdict a MEMORISER pour un panel de juges (objection du juge, reparation 1 de conv-36).
 * Un membre qui valide en listant des ecarts vote DEFAUT : le texte agrege commence alors par
 * « DEFAUT: quorum non atteint … » et `reservesMineuresSeules` ne le reconnaitrait jamais. On
 * reconstruit donc, a partir des textes BRUTS des membres, le verdict qu'ils ont reellement rendu :
 * tous VALIDE → un VALIDE portant l'union de leurs puces (gravite conservee). Sinon le texte agrege.
 */
export function verdictPanelPourMemoire(textesDesMembres: string[], texteAgrege: string): string {
  const textes = (textesDesMembres ?? []).filter((t) => t && t.trim())
  if (textes.length === 0 || !textes.every(premiereLigneValide)) return texteAgrege
  return verdictPanelValide(textes.map((text) => ({ text, ok: true })))
}

/** Decision d'arret du passage courant : jamais au 1er passage, jamais sans verdict precedent. */
// fix-ok: conv-35 — la boucle juge-réparation relançait un passage quand le juge rendait VALIDE avec les MÊMES réserves MINEUR (107 passages sur 109 après validation) ; arrêt décidé par le code, jamais par le juge
export function reservesMineuresFigees(attempt: number, courant: string, precedent: string): boolean {
  return attempt > 0 && precedent.trim() !== '' && memesReservesMineures(courant, precedent)
}
