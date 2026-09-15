/**
 * LES OBJECTIONS DU JUGE NE SE PERDENT PAS DANS UN VERT.
 *
 * Le brief du juge (`phase-briefs.ts`) impose une section `OBJECTIONS:` APRÈS le verdict, et
 * « - aucune » quand il n'y en a pas. Jusqu'ici, seule la première ligne (`VALIDE` / `DEFAUT:`)
 * était lue : un juge qui validait EN LISTANT des écarts concrets fermait le run en vert, et ces
 * écarts n'étaient jamais corrigés — l'utilisateur récupérait un livrable dont les défauts étaient
 * écrits noir sur blanc dans la trace.
 *
 * Ce lecteur extrait ces objections pour que la boucle de réparation B5 (déjà en place) s'en
 * saisisse comme de n'importe quel refus : corriger, puis rejuger.
 *
 * fix-ok: conv-539 tour 24e29815-0cbd-4310-8cda-93207e237015 — juge « VALIDE SCORE 68 » avec objections
 * jamais remises a la reparation ; puis « Aucune capture... » jete comme liste vide (e8da1596, a1243dbe).
 */
const ENTETE_OBJECTIONS = /^\s*objections?\s*:/i
/** Une section suivante du contrat du juge (SCORE:, VERDICT:, …) ferme la liste. */
const AUTRE_SECTION = /^\s*[A-ZÉÈÀ_ ]{3,}\s*:/
const PUCE = /^\s*(?:[-*•]|\d+[.)])\s+/
/** « aucune », « aucun », « rien à signaler », « n/a », « néant » — la forme contractuelle du vide. */
// Ligne ENTIÈRE seulement : « Aucune capture du mode sombre » est une objection (conv-539).
const VIDE =
  /^(aucune?(\s+(objections?|ecarts?|defauts?|reserves?))?|rien(\s+a\s+signaler)?|neant|n\/?a|non|ras)\s*[.!]?$/

function normaliser(ligne: string): string {
  return ligne
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Les objections CONCRÈTES d'un texte de verdict, section `OBJECTIONS:` seulement.
 * Rend `[]` quand il n'y a pas de section, qu'elle est vide, ou qu'elle dit « aucune ».
 */
export function objectionsDuJuge(text: string): string[] {
  const lignes = (text ?? '').split(/\r?\n/)
  const objections: string[] = []
  let dansLaSection = false
  for (const ligne of lignes) {
    if (ENTETE_OBJECTIONS.test(ligne)) {
      dansLaSection = true
      // Forme en ligne : « OBJECTIONS: aucune » ou « OBJECTIONS: X ».
      const reste = ligne.replace(ENTETE_OBJECTIONS, '').trim()
      if (reste && !VIDE.test(normaliser(reste))) objections.push(reste)
      continue
    }
    if (!dansLaSection) continue
    if (!ligne.trim()) continue
    if (!PUCE.test(ligne) && AUTRE_SECTION.test(ligne)) {
      dansLaSection = false
      continue
    }
    if (!PUCE.test(ligne)) continue
    const contenu = ligne.replace(PUCE, '').trim()
    if (!contenu) continue
    if (VIDE.test(normaliser(contenu))) continue
    objections.push(contenu)
  }
  return objections
}

/**
 * Un verdict d'approbation QUI PORTE des objections n'est pas une clôture : il devient un refus
 * lisible, avec ses objections en raisons, pour que la réparation reparte dessus.
 */
/**
 * La DoD que le contrôle final reçoit d'un verdict : UNE case par objection, libellée.
 *
 * Mesuré conv-539, tour 24e29815-0cbd-4310-8cda-93207e237015 : le juge rendait « VALIDE / SCORE 70 /
 * OBJECTIONS: … » (donc rouge), mais le contrôle recevait une case muette. Ses motifs restaient
 * « Échec déjà déclaré ; Promis mais pas fait : 1 point(s) » : le build de réparation (08:45:37) a
 * lu ces motifs comme « mes propres réserves » et n'a rien changé, puis l'arrêt « même refus 2 fois »
 * a coupé alors que les objections, elles, avaient changé (score 70 → 68). Nommer chaque objection
 * les met dans le refus : la réparation les voit, et un refus n'est « figé » que si elles le sont.
 */
export function dodDuVerdict(
  ok: boolean,
  text: string
): Array<{ checked: boolean; hasContent: true; label?: string }> {
  if (ok) return [{ checked: true, hasContent: true }]
  const objections = objectionsDuJuge(text).slice(0, 8)
  if (objections.length === 0) return [{ checked: false, hasContent: true }]
  return objections.map((o) => ({
    checked: false,
    hasContent: true as const,
    label: `Objection du juge : ${o.length > 300 ? `${o.slice(0, 300)}…` : o}`
  }))
}

export function verdictAvecObjectionsPortees(text: string): string {
  const objections = objectionsDuJuge(text)
  if (objections.length === 0) return text
  if (/\bDEFAUT\s*:/i.test(text)) return text
  return `DEFAUT: objections du juge non levées (${objections.length})\n${text}`
}
