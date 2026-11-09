import { estUneDemandeDAction, estUneQuestionSansAction } from '../chat/grow-au-debut'
import { invokedSkillId, skillNommeeSansBarre } from '../skills/skill-pipeline'

/**
 * UNE COPIE DE FIL N'A DE SENS QUE POUR UNE DEMANDE QUI ÉCRIT DANS LE CODE DU DÉPÔT.
 *
 * Elle sert à isoler ce qu'un fil écrit, pour que son travail ne se mélange pas à celui des autres.
 * Une demande qui n'écrit rien dans le code n'a rien à isoler, et la copie lui coûte quand même une
 * annonce dans le fil, un dossier sur le disque et le déplacement de la session du modèle.
 *
 * Le critère d'avant était « question ou pas », et tout message commençant par `/` comptait comme
 * une demande qui écrit : `/git` recevait donc une copie. Pour lui c'est pire qu'inutile : son sujet
 * est l'arbre principal du dépôt, ses remises de côté, ses copies et ses branches ; dans une copie,
 * il voit un arbre propre et rien à publier.
 *
 * Ne décide que de l'ouverture d'une copie NEUVE : un fil déjà dans sa copie la garde.
 */

/** Skills dont le sujet est le dépôt partagé lui-même : dans une copie, leur travail serait faux. */
const SKILLS_DU_DEPOT_PARTAGE = new Set(['git', 'maj', 'gc'])

/**
 * Skills qui lisent, ou qui écrivent hors du code du dépôt (Brain, données de l'app). Elles ne
 * reçoivent une copie que si le message demande en plus une action (« /scout X puis corrige »).
 * Une skill absente des deux listes reçoit sa copie : dans le doute, on isole.
 */
const SKILLS_SANS_ECRITURE_DANS_LE_CODE = new Set([
  'check',
  'curate',
  'doctor',
  'glean',
  'grill',
  'judge',
  'learn',
  'look',
  'mise-en-forme',
  'rendement',
  'residus',
  'scout',
  'skill-doctor',
  'steal',
  'think'
])

/** La skill appelée en tête du message, avec ou sans barre (même lecture que le message du tour). */
function skillEnTete(demande: string): string | undefined {
  return invokedSkillId(demande) ?? skillNommeeSansBarre(demande)
}

/** Vrai quand la demande n'écrira pas dans le code du dépôt : le fil n'a pas besoin de copie neuve. */
export function demandeSansEcritureDansLeDepot(
  demande: string | undefined,
  skill: string | undefined = skillEnTete(demande ?? '')
): boolean {
  const nom = skill?.trim().toLowerCase()
  if (nom && SKILLS_DU_DEPOT_PARTAGE.has(nom)) return true
  if (nom && SKILLS_SANS_ECRITURE_DANS_LE_CODE.has(nom)) return !estUneDemandeDAction(demande, nom)
  return estUneQuestionSansAction(demande)
}
