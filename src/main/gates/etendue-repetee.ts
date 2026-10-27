import type { ModelQuestion } from '../model-questions'
import { objectionsDuJuge } from '../objections-juge'

/**
 * OBJECTION D'ÉTENDUE RÉPÉTÉE EN MODE JUSQU'AU VERT → PAUSE ET QUESTION (conv-1149, 2026-10-25).
 *
 * Mesure sur conv-1146 (run-ec2036c0932d-1, `activity/conv-1146.jsonl`) : le juge a refusé quatre
 * fois de suite « Ta demande n'est pas remplie. Tu as écrit « full anglais » », et chaque refus
 * relançait une réparation qui traduisait de nouveaux écrans (réparations 4, 8 et 11 : 33 $, 22 $,
 * 16 $). En mode jusqu'au vert (conv-844), ni le plafond ni l'arrêt sur refus répété ne mordent
 * (`arretDeLaReparation`, stopgate.ts) : rien n'arrêtait la boucle. Or livrer TOUT ou PAR ÉTAPES est
 * un choix de l'utilisateur, pas du juge ni du build.
 *
 * Ce module DÉCIDE et MET EN FORME ; la boucle de réparation (`orchestrator.ts`) pose la question
 * par la fenêtre de question de l'app et attend la réponse — le run est en pause pendant ce temps.
 */

/**
 * Ajouté au prompt du juge du PIPELINE seulement (`orchestrator.ts`), comme
 * `CONTRAT_QUESTIONS_AU_BUILD` : la consigne de `phase-briefs.ts` est plafonnée à 3 000 caractères,
 * et seule la boucle de réparation du pipeline relit ce préfixe.
 */
export const CONTRAT_ETENDUE =
  "Une objection MAJEUR ou MINEUR qui dit qu'une PARTIE de la demande n'est pas faite (son étendue, pas un défaut de ce qui est livré) commence par « ÉTENDUE — »."

const PREFIXE_ETENDUE = /^\**\s*[ÉE]TENDUE\b/i

/** La première objection BLOQUANTE du verdict marquée « ÉTENDUE », ou `undefined`. */
export function objectionDEtendue(texteDuJuge: string): string | undefined {
  return objectionsDuJuge(texteDuJuge ?? '').find((objection) => PREFIXE_ETENDUE.test(objection))
}

/**
 * Deux verdicts du juge D'AFFILÉE portent une objection d'étendue : la même lacune revient, la
 * réparation ne la comble pas d'elle-même. Hors jusqu'au vert, la boucle a déjà ses arrêts. Une seule
 * question par run : la réponse vaut pour la suite.
 */
export function doitDemanderLEtendue(etat: {
  jusquAuVert: boolean
  dejaTranchee: boolean
  courante?: string
  precedente?: string
}): boolean {
  return etat.jusquAuVert && !etat.dejaTranchee && Boolean(etat.courante && etat.precedente)
}

export const OPTION_CONTINUER = 'Continuer les réparations jusqu’à couvrir toute la demande'
export const OPTION_ARRETER =
  'Arrêter les réparations ici (le travail fait reste dans sa copie, non publié)'

export function questionDEtendue(objection: string): ModelQuestion {
  return {
    text:
      `Le juge refuse encore pour la même raison : une partie de ta demande n'est pas faite.\n« ${objection} »\n` +
      'Chaque réparation coûte un build complet et un nouveau juge. Tu peux aussi écrire ce que tu veux ' +
      'couvrir dans ce run : ce sera la consigne des réparations suivantes.',
    options: [OPTION_CONTINUER, OPTION_ARRETER],
    reason: 'material-ambiguity'
  }
}

/** Réponse rendue par la fenêtre de question quand on la ferme sans répondre (`window.ts`). */
const FENETRE_FERMEE = 'attend pour l’instant'

export type IssueEtendue =
  { kind: 'continuer' } | { kind: 'consigne'; texte: string } | { kind: 'arreter'; motif: string }

/**
 * Sans réponse (aucune fenêtre, fenêtre fermée), on ARRÊTE : relancer une réparation est
 * justement ce que l'utilisateur ne veut plus subir sans avoir tranché. Le run reste reprenable.
 */
export function issueDeLaReponse(reponse: string | undefined): IssueEtendue {
  const texte = (reponse ?? '').trim()
  if (texte === OPTION_CONTINUER) return { kind: 'continuer' }
  if (texte === OPTION_ARRETER)
    return {
      kind: 'arreter',
      motif:
        'Réparation arrêtée sur ta réponse : le juge refuse encore pour l’étendue de la demande. Le travail fait reste dans sa copie, non publié.'
    }
  if (!texte || texte === FENETRE_FERMEE)
    return {
      kind: 'arreter',
      motif:
        'Réparation arrêtée : le juge refuse encore pour l’étendue de la demande, et la question posée est restée sans réponse. Le run reste reprenable.'
    }
  return { kind: 'consigne', texte }
}
