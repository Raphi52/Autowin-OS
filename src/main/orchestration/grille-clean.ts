/**
 * LA GRILLE QUALITÉ DE CLEAN, LUE PAR LE CONTRÔLE FINAL (conv-1035, 2026-10-21).
 *
 * La consigne CLEAN (`phase-briefs.ts`, réflexe 5) note chaque ligne écrite par le run sur une
 * grille de critères et termine par `Grille : N ✅ · K ❌ restants · S sans objet`. Un « ❌ restant »
 * est un défaut que clean n'a pas le droit de corriger (il changerait un comportement). Tant
 * qu'aucun code ne lisait cette ligne, il ne bloquait que si le juge le remarquait en lisant. Ce
 * module en fait un fait opposable : `etatDeCloture` (`root-execution-contract.ts`) refuse la fin
 * verte tant que K > 0.
 *
 * Une grille absente ne bloque pas ici : le contrat demandé porte sur K > 0, et un run sans phase
 * clean (tâche triviale, phase nommée autre) n'a aucune grille à fournir.
 */

export interface GrilleClean {
  /** K : les ❌ que clean n'a pas corrigés. */
  restants: number
  /** Les critères marqués ❌ dans le tableau de la grille, quand il est lisible. */
  criteres: string[]
}

/** `Grille : 9 ✅ · 2 ❌ restants` — gras, accents graves et singulier tolérés ; des CHIFFRES exigés. */
const LIGNE_GRILLE = /Grille\s*:\s*(\d+)\s*✅[^\n]*?(\d+)\s*❌\s*restant/u

/** Les lignes `| Critère | ❌ … | preuve |` du tableau : la 2e cellule porte le verdict. */
function criteresEnDefaut(texte: string): string[] {
  const noms = texte
    .split('\n')
    .filter((ligne) => ligne.trim().startsWith('|'))
    .map((ligne) => ligne.split('|').map((cellule) => cellule.trim()))
    .filter(([, , verdict]) => !!verdict && verdict.includes('❌') && !/corrig/iu.test(verdict))
    .map(([, critere]) => critere.replace(/\*/g, '').trim())
    .filter(Boolean)
  return [...new Set(noms)]
}

/** La DERNIÈRE ligne de grille du texte : une grille refaite après correction remplace la première. */
export function lireGrilleClean(texte: string): GrilleClean | undefined {
  const derniere = texte
    .split('\n')
    .map((ligne) => LIGNE_GRILLE.exec(ligne))
    .filter((m): m is RegExpExecArray => m !== null)
    .pop()
  if (!derniere) return undefined
  const restants = Number(derniere[2])
  return { restants, criteres: restants > 0 ? criteresEnDefaut(texte) : [] }
}

/**
 * La grille qui fait foi pour la clôture : celle du DERNIER clean, s'il reste des ❌ — et seulement
 * quand une réparation peut les lever.
 *
 * Dans le pipeline, une réparation rejoue build PUIS clean (`orchestrator.ts`,
 * `phasesApresBuildDeReparation`) : c'est ce nouveau clean qui fait foi. Deux cas n'ont pas cette
 * issue, et bloquer y rendrait le refus impossible à lever :
 *  - un build joué APRÈS le dernier clean rend sa grille périmée (même portée que la garde
 *    « cadrage refusé », conv-710) ;
 *  - un clean joué SANS build avant lui (`/clean` nommé) : la réparation rejoue clean seul, qui n'a
 *    pas le droit de corriger un ❌ restant. En mode « jusqu'au vert » (conv-844), aucun refus répété
 *    n'arrête la boucle (`arretDeLaReparation`, gates/stopgate.ts) : elle paierait clean sans fin.
 *    Les ❌ restent alors écrits dans la sortie de clean, sous les yeux du juge et de l'utilisateur.
 */
export function grilleCleanEnDefaut(
  phases: readonly { phase: string; text?: string }[]
): GrilleClean | undefined {
  const indexClean = phases.map((p) => p.phase).lastIndexOf('clean')
  if (indexClean < 0) return undefined
  if (phases.slice(indexClean + 1).some((p) => p.phase === 'build')) return undefined
  if (!phases.slice(0, indexClean).some((p) => p.phase === 'build')) return undefined
  const grille = lireGrilleClean(phases[indexClean].text ?? '')
  return grille && grille.restants > 0 ? grille : undefined
}

/** Le libellé montré à l'utilisateur et à la réparation : NOMMER les critères, pas seulement compter. */
export function libelleGrilleEnDefaut(grille: GrilleClean): string {
  const s = grille.restants > 1 ? 's' : ''
  const noms = grille.criteres.length > 0 ? ` : ${grille.criteres.join(', ')}` : ''
  return `${grille.restants} défaut${s} restant${s} dans la grille qualité de clean${noms}`
}
