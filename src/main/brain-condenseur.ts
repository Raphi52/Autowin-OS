import { randomUUID } from 'node:crypto'
import type { BrainMemoryOutcome } from './brain-graph-command'
import type { CostSink } from './dashboards/cost'
import { noterAppelCourt, signalerPanneAppelCourt } from './petites-taches-trace'
import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'

/**
 * CONDENSEUR DES NOTES DU BRAIN (conv-1469, 2026-11-04).
 *
 * POURQUOI : `brain_read` versait la note ENTIÈRE dans le contexte du modèle principal. Mesure du
 * 22 au 30/10 (conv-1303) : 148 notes, 347 000 caractères, plus que tout le bloc des notes proches.
 * Demande de l'utilisateur : le fil ne doit recevoir qu'un MINIMUM d'information pertinente, après
 * un passage par le modèle des petites tâches (Haiku, réglage du Routeur).
 *
 * Règles : une note courte passe telle quelle (le condensé coûterait plus qu'il n'économise) ;
 * `entier: true` garde la note brute (il faut la lire en entier pour la remplacer via `remember`) ;
 * une panne du petit modèle rend la note entière, en le disant — jamais une note perdue.
 */

/** En dessous, la note passe telle quelle. */
export const SEUIL_CONDENSE = 1500

export const CONSIGNE_CONDENSEUR = [
  "Tu reçois une note d'une base de savoir et le BESOIN de l'agent qui la lit.",
  "Rends UNIQUEMENT ce qui sert ce besoin : faits, chiffres, chemins, décisions et leurs motifs, mots pour mot quand c'est technique.",
  'Puces courtes, au plus 12. Garde la date de la note si elle y figure.',
  "Rien d'inventé, aucun commentaire, aucune introduction.",
  'Si rien ne sert le besoin, réponds exactement : AUCUN_RAPPORT'
].join('\n')

export type Condenseur = (charge: string, conversationId?: string) => Promise<string>

export function condenseurDuBrain(deps: {
  registry: Pick<ProviderRegistry, 'send'>
  roles: Pick<RoleModelConfig, 'bindingDesPetitesTaches'>
  cost: CostSink
}): Condenseur {
  return async (charge, conversationId) => {
    const binding = deps.roles.bindingDesPetitesTaches()
    const reponse = await deps.registry
      .send(binding.provider, [{ role: 'user', content: charge }], {
        system: CONSIGNE_CONDENSEUR,
        systemBlocks: [{ name: 'condenseBrain', chars: CONSIGNE_CONDENSEUR.length }],
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        requestId: randomUUID()
      })
      .catch((error: unknown) => {
        signalerPanneAppelCourt('condenseBrain', error)
        throw error
      })
    const texte = (reponse.text ?? '').trim()
    noterAppelCourt(deps.cost, {
      appel: 'condenseBrain',
      binding,
      res: reponse,
      issue: texte.slice(0, 80),
      conversationId
    })
    return texte
  }
}

/** Applique le condensé à un résultat de `brain_read`. Ne jette jamais. */
export async function condenserLecture(
  lu: BrainMemoryOutcome,
  args: Record<string, unknown>,
  condenser: Condenseur | undefined,
  conversationId?: string
): Promise<BrainMemoryOutcome> {
  if (!condenser || lu.status !== 'found' || args.entier === true || args.entier === 'true') {
    return lu
  }
  if (lu.knowledge.length < SEUIL_CONDENSE) return lu
  const besoin =
    typeof args.besoin === 'string' && args.besoin.trim()
      ? args.besoin.trim().slice(0, 600)
      : "l'essentiel durable de la note"
  try {
    const texte = await condenser(`BESOIN : ${besoin}\n\nNOTE :\n${lu.knowledge}`, conversationId)
    if (!texte) throw new Error('réponse vide')
    if (texte === 'AUCUN_RAPPORT') {
      return {
        ...lu,
        knowledge: '',
        note: `note sans rapport avec le besoin (${lu.knowledge.length} car. non servis) — rouvre avec entier: true si tu en doutes`
      }
    }
    return {
      ...lu,
      knowledge: texte,
      note: `condensé par le modèle des petites tâches (${lu.knowledge.length} → ${texte.length} car.) — entier: true pour la note brute`
    }
  } catch (error) {
    return {
      ...lu,
      note: `condensé indisponible (${error instanceof Error ? error.message : String(error)}) : note entière`
    }
  }
}
