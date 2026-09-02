/**
 * MODE AUTO du chat — renvoyer tout seul la suite proposée en fin de tour, jusqu'à ce que l'agent
 * dise qu'il ne reste RIEN à faire.
 *
 * Cadrage utilisateur (2026-09-02) : l'interrupteur vit dans la barre de gauche et reste ACTIF
 * jusqu'à désactivation — pas de plafond de tours, pas de remise à zéro au changement de fil.
 *
 * Chaque tour coûte de l'argent réel. Toute la décision vit donc ICI, pure et testable, plutôt que
 * noyée dans la vue : ce qui décide d'envoyer un tour payant doit pouvoir être lu d'un coup.
 *
 * Les garde-fous qui restent :
 * 1. ARRÊT SUR « RIEN » — la condition demandée. Elle se teste sur la rubrique « 👉 Recommandé »,
 *    JAMAIS sur le texte qui part dans le champ. Les deux diffèrent : le champ reçoit en priorité
 *    la ligne `AUTOWIN_PROMPT_V1`, et un modèle qui écrit « Recommandé — rien » PUIS un prompt
 *    quand même ferait tourner la boucle pour toujours si on testait le mauvais texte.
 * 2. UN TOUR TRAITÉ UNE SEULE FOIS — la décision porte une signature du tour ; le même tour ne peut
 *    pas déclencher deux envois, même si la vue se redessine dix fois.
 * 3. ANTI-BOUCLE — la même suite proposée deux fois d'affilée arrête tout.
 */
import type { Msg, AsstMsg } from './chat-view-types'
import type { ChatPart } from './chat-view-model'
import { extrairePromptSuivant } from '../../../shared/prompt-suivant'
import { extractRecommendation } from './Markdown'

/** Texte brut (avec la ligne technique du prompt) du DERNIER message de l'agent. */
export function texteDernierAssistant(fil: readonly Msg[]): string | null {
  const dernier = [...fil].reverse().find((m) => m.role === 'assistant') as AsstMsg | undefined
  if (!dernier) return null
  return (dernier.parts ?? [])
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

/**
 * Signature du tour courant. Deux redessins du MÊME tour la partagent ; un tour de plus la change.
 * Volontairement bâtie sur la longueur du fil et du texte : aucun identifiant n'est garanti présent
 * sur un message encore en cours de réception.
 */
export function signatureTour(fil: readonly Msg[]): string | null {
  const texte = texteDernierAssistant(fil)
  if (texte === null) return null
  return `${fil.length}::${texte.length}`
}

/**
 * « rien » comme MOT, pas comme morceau de mot : « Recommandé — rien » arrête, « rien à signaler »
 * aussi, mais « rienvoyer » (faute de frappe) ou « terrain » ne doivent pas arrêter la boucle.
 */
export function recommandationDitRien(recommandation: string | null): boolean {
  if (!recommandation) return false
  const nu = recommandation.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /(^|[^\p{L}\p{N}])rien([^\p{L}\p{N}]|$)/u.test(nu)
}

export type RaisonArret =
  | 'inactif'
  | 'tour-en-cours'
  | 'deja-traite'
  | 'aucune-reponse'
  | 'brouillon'
  | 'recommandation-rien'
  | 'aucun-prompt'
  | 'prompt-identique'

export interface EntreeDecisionAuto {
  /** Le mode auto est-il armé ? */
  actif: boolean
  /** Un tour est en cours : on attend, on n'envoie pas. */
  occupe: boolean
  fil: readonly Msg[]
  /** Signature du dernier tour déjà traité par le mode auto (null = aucun). */
  dernierTourTraite: string | null
  /** Texte du dernier prompt envoyé automatiquement (anti-boucle). */
  dernierPromptEnvoye: string | null
  /** L'utilisateur a du texte dans le champ : on ne lui vole pas son tour, on PATIENTE. */
  brouillonPresent: boolean
}

export type DecisionAuto =
  | { action: 'envoyer'; texte: string; signature: string }
  | { action: 'attendre'; raison: RaisonArret }
  | { action: 'arreter'; raison: RaisonArret; message: string }

/**
 * SEUL « rien » ÉTEINT le mode. C'est la condition demandée, et la seule.
 *
 * DÉFAUT VÉCU le 2026-09-02 : « quand je change de conversation ça enlève le mode auto ». En
 * arrivant dans un autre fil, la boucle lisait sa DERNIÈRE réponse — souvent ancienne et sans
 * suite proposée — et s'éteignait comme si le travail était fini. Une absence de suite n'est pas
 * une fin : c'est juste « rien à envoyer sur CE tour ». On patiente, l'interrupteur reste allumé.
 */
const MESSAGES_ARRET: Record<string, string> = {
  'recommandation-rien': 'Mode auto terminé : plus rien de recommandé.'
}

/** La SEULE porte qui autorise un envoi automatique. Tout le reste de la vue s'y plie. */
export function deciderRelanceAuto(entree: EntreeDecisionAuto): DecisionAuto {
  if (!entree.actif) return { action: 'attendre', raison: 'inactif' }
  if (entree.occupe) return { action: 'attendre', raison: 'tour-en-cours' }
  const signature = signatureTour(entree.fil)
  if (signature === null) return { action: 'attendre', raison: 'aucune-reponse' }
  if (signature === entree.dernierTourTraite) return { action: 'attendre', raison: 'deja-traite' }
  // Le mode reste ARMÉ pendant que l'utilisateur écrit : on patiente, on ne se coupe pas.
  if (entree.brouillonPresent) return { action: 'attendre', raison: 'brouillon' }
  const texteReponse = texteDernierAssistant(entree.fil) ?? ''
  // Garde-fou 1 : la condition d'arrêt se lit sur la rubrique, pas sur le prompt.
  if (recommandationDitRien(extractRecommendation(texteReponse)))
    return {
      action: 'arreter',
      raison: 'recommandation-rien',
      message: MESSAGES_ARRET['recommandation-rien']
    }
  const texte = extrairePromptSuivant(texteReponse) ?? extractRecommendation(texteReponse)
  // Pas de suite proposée : on ne fabrique rien et on ne s'éteint pas — on attend le tour suivant.
  if (!texte) return { action: 'attendre', raison: 'aucun-prompt' }
  // La même suite deux fois d'affilée = boucle : on ne la renvoie pas, sans couper l'interrupteur.
  if (entree.dernierPromptEnvoye && texte.trim() === entree.dernierPromptEnvoye.trim())
    return { action: 'attendre', raison: 'prompt-identique' }
  return { action: 'envoyer', texte, signature }
}
