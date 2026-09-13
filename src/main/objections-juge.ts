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
 */
const ENTETE_OBJECTIONS = /^\s*objections?\s*:/i
/** Une section suivante du contrat du juge (SCORE:, VERDICT:, …) ferme la liste. */
const AUTRE_SECTION = /^\s*[A-ZÉÈÀ_ ]{3,}\s*:/
const PUCE = /^\s*(?:[-*•]|\d+[.)])\s+/
/** « aucune », « aucun », « rien à signaler », « n/a », « néant » — la forme contractuelle du vide. */
const VIDE = /^(aucune?|rien(\s+a\s+signaler)?|neant|n\/?a|non|ras)\b/

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
export function verdictAvecObjectionsPortees(text: string): string {
  const objections = objectionsDuJuge(text)
  if (objections.length === 0) return text
  if (/\bDEFAUT\s*:/i.test(text)) return text
  return `DEFAUT: objections du juge non levées (${objections.length})\n${text}`
}
