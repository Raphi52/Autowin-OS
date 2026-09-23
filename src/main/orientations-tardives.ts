/**
 * UNE QUESTION POSEE PENDANT UN /skill NE SE PERD PAS (conv-798, 2026-09-23).
 *
 * Saisie `ts 1790162150940` (voie orientation), envoyee pendant le tour
 * bf63ebf4-1324-493f-a4fa-32c5bd8b453a (/kaizen) : elle a ete videe de la file sans reponse. Le seul
 * temoin etait un avis generique colle A LA FIN d'un long compte-rendu, sans citer la question —
 * l'utilisateur a conclu « tu ne m'as jamais répondu ». L'avis cite donc chaque orientation mot pour
 * mot et se place EN TETE ; le compte-rendu etant rejoue au modele au tour suivant, celui-ci la voit.
 */
export function avisOrientationsTardives(orientations: readonly string[]): string | undefined {
  const textes = orientations.map((o) => o.trim()).filter(Boolean)
  if (!textes.length) return undefined
  const citees = textes.map((t) => `> ${t.replace(/\n/g, '\n> ')}`).join('\n')
  return `⚠️ Question(s) envoyée(s) pendant ce travail, PAS ENCORE TRAITÉE(S) (aucun second travail relancé) :\n${citees}\nÀ traiter en premier au prochain tour.`
}

export function avecAvisEnTete(compteRendu: string, avis: string | undefined): string {
  return avis ? `${avis}\n\n${compteRendu}` : compteRendu
}
