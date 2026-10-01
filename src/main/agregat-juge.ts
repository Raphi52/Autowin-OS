import { OUTCOME_LESSON_MARKER } from './outcome-learning-proposal'

/**
 * Le texte AGRÉGÉ d'un run à plusieurs phases : celui que lit le juge, que `attestJudgeApprovedLearning`
 * atteste, et que `observeOutcomeLearning` relit pour enregistrer la leçon (`result` du run).
 *
 * Chaque bloc de phase est borné à `plafond` caractères (#3 : le prompt du juge ne grossit plus avec
 * le nombre de phases). La sortie intégrale reste dans `phaseOutputs` et la trace des sous-agents.
 *
 * LA LEÇON PROPOSÉE EST CELLE DE LA RÉPONSE LA PLUS RÉCENTE QUI EN PORTE UNE.
 *
 * fix-ok: run-85d8e7f57af2-1 (conv-892, 2026-10-01) — cinq réponses de build portaient une ligne
 * `AUTOWIN_LESSON_V1` (caractères 9 054, 10 011, 4 821, 8 363, 4 559 dans `phaseOutputs`). Deux
 * causes, mesurées sur `run-state/run-85d8e7f57af2-1.json` en rejouant `parseAttestedLearningProposal` :
 * (1) le brief place la leçon en DERNIÈRE ligne, et le plafond garde le DÉBUT de la réponse : trois
 * versions étaient coupées, dont la corrigée ; (2) les phases s'ajoutent sans jamais s'effacer : la
 * version fausse de la réparation 3 restait lisible, et la règle « une seule ligne » annulait tout dès
 * qu'une réparation proposait la version corrigée. Le juge, dont le VALIDE enregistre la ligne qu'il
 * voit, ne pouvait que refuser (réparations 4, 5) puis bloquer sur la perte (réparation 6) : aucune
 * réparation ne pouvait lever ce refus. D'où : seule la réponse la plus récente garde ses lignes de
 * leçon, hors du plafond ; les plus anciennes sont remplacées par une mention sans marqueur.
 * Deux lignes dans CETTE réponse restent ambiguës et ne sont pas départagées (aucune leçon).
 */
export interface SortieDePhase {
  phase: string
  text: string
}

export const MARQUE_TRONQUE = '\n…[tronqué — voir le fil des sous-agents]'
export const MENTION_LECON_REMPLACEE =
  '(proposition de leçon remplacée par celle d’une réponse plus récente)'

function estLigneDeLecon(ligne: string): boolean {
  return ligne.trimStart().startsWith(OUTCOME_LESSON_MARKER)
}

export function agregerPhasesPourLeJuge(sorties: SortieDePhase[], plafond: number): string {
  let derniere = -1
  sorties.forEach((p, i) => {
    if (p.text.split(/\r?\n/u).some(estLigneDeLecon)) derniere = i
  })
  return sorties
    .map((p, i) => {
      const lignes = p.text.split(/\r?\n/u)
      const lecons = lignes.filter(estLigneDeLecon)
      let texte = p.text
      let aRecoller: string[] = []
      if (lecons.length > 0) {
        if (i === derniere) {
          texte = lignes.filter((l) => !estLigneDeLecon(l)).join('\n')
          aRecoller = lecons
        } else {
          texte = lignes.map((l) => (estLigneDeLecon(l) ? MENTION_LECON_REMPLACEE : l)).join('\n')
        }
      }
      let body = texte.length > plafond ? `${texte.slice(0, plafond)}${MARQUE_TRONQUE}` : texte
      if (aRecoller.length > 0) body = `${body.replace(/\s+$/u, '')}\n${aRecoller.join('\n')}`
      return `[phase ${p.phase}]\n${body}`
    })
    .join('\n\n')
}
