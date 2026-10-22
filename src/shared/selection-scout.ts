/**
 * UNE DEMANDE QUI VIENT D'UNE SÉLECTION DE CANDIDATS SCOUT — reconnue à son en-tête.
 *
 * L'en-tête est écrit par le panneau des candidats (`redigerPromptWorkflowSelection` et
 * `redigerPromptCorrectionDirecte`, src/renderer/src/components/veille-candidats-message.ts). Deux
 * lecteurs côté processus principal en dépendent : la mémoire du scout, qui note les pistes prises
 * (`scout-memoire.ts`), et le choix des étapes du run, qui ne rejoue pas un scout déjà fait
 * (`task-regime.ts`, `selection-sans-scout.ts`). Source unique depuis le 2026-10-22 (conv-1080).
 *
 * Le « T » est facultatif : la demande de conv-890 est arrivée en « raite ENSEMBLE… », collée sans
 * sa première lettre. Le `/build` facultatif est la correction DIRECTE : le routeur le recolle
 * devant l'en-tête (« /build Traite ce candidat… »).
 */
export const ENTETE_SELECTION_SCOUT =
  /(?:^|\n)\s*(?:\/build\s+)?(?:t[âa]che\s*:\s*)?t?raite\s+(?:ensemble\s+ces\s+\d+\s+candidats|ce\s+candidat)\s+issus?\s+du\s+scout/iu

/** Vrai si la demande est une sélection de candidats envoyée depuis le panneau d'un scout. */
export function estSelectionDeScout(texte: string | undefined): boolean {
  return ENTETE_SELECTION_SCOUT.test(texte ?? '')
}

/** La place d'un lot dans une sélection découpée (le 1er lot est le numéro 1). */
export interface RangDuLot {
  numero: number
  total: number
}

/**
 * LES LOTS D'UNE SÉLECTION (conv-1080, 2026-10-22). Le panneau découpe une sélection en lots de quelques
 * pistes, lancés l'un après l'autre : sur 49 runs de sélection, 16 avaient été coupés par la limite de
 * session du modèle, avec 6 pistes en moyenne — un run coupé à la 5ᵉ piste ne livrait rien.
 *
 * La ligne est ÉCRITE par le panneau et LUE par la mémoire du scout : le lot 2 ne doit pas défaire
 * les pistes prises par le lot 1 (`noterChoixScout`). Un seul endroit pour les deux, comme l'en-tête.
 */
export function ligneDuLot(lot: RangDuLot): string {
  return `Lot ${lot.numero} sur ${lot.total} de la sélection : les autres pistes partent dans leurs propres lots, l’un après l’autre — ne les traite pas ici.`
}

const LIGNE_DU_LOT = /(?:^|\n)\s*Lot\s+(\d+)\s+sur\s+(\d+)\s+de\s+la\s+s[ée]lection\b/iu

/** Le lot que porte une demande ; `null` pour une sélection d'un seul tenant ou une demande libre. */
export function lotDeLaSelection(texte: string | undefined): RangDuLot | null {
  const trouve = LIGNE_DU_LOT.exec(texte ?? '')
  if (!trouve) return null
  const numero = Number(trouve[1])
  const total = Number(trouve[2])
  return numero >= 1 && total >= numero ? { numero, total } : null
}

/**
 * La voie d'une sélection, lue sur son message : le `/build` en tête est la correction DIRECTE
 * (`redigerPromptCorrectionDirecte`), son absence le workflow complet. `null` hors sélection.
 */
export function voieDeLaSelection(texte: string | undefined): 'directe' | 'complete' | null {
  if (!estSelectionDeScout(texte)) return null
  // `/build` collé devant l'en-tête, pas n'importe où : une piste peut CITER « /build » dans son texte.
  return /(?:^|\n)\s*\/build\s+(?:t[âa]che\s*:\s*)?t?raite\s/iu.test(texte ?? '')
    ? 'directe'
    : 'complete'
}
