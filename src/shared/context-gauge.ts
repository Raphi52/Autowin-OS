import { splitInputTokens } from './cost-estimate'
import type { TokenUsage } from './token-usage'

/**
 * LA JAUGE DE CONTEXTE — ce que le fil OCCUPE, et non ce qu'il a coute.
 *
 * Autowin comptait le cout du contexte jusqu'au detail cache-read / cache-creation / fresh, le
 * remontait au ledger et a Observatory, et ne disait NULLE PART ce que la fenetre portait. Un fil
 * pouvait s'approcher de la saturation sans qu'un seul ecran ne l'indique, et la seule reponse a
 * la saturation etait une troncature brute des quarante derniers messages, muette
 * (`chat-turn-messages.ts:62`). Une depense observee, jamais un etat gouverne.
 *
 * NUMERATEUR : `inputTokens` du DERNIER tour -- exactement ce que le modele vient de recevoir, donc
 * l'occupation reelle. Surtout PAS la somme des tours : le prefixe est renvoye a chaque appel, une
 * somme le compterait autant de fois qu'il y a eu de tours et rendrait une jauge absurde.
 *
 * DENOMINATEUR : la fenetre du modele servi. C'est la seule donnee qui manquait -- et la seule
 * qu'on ne peut pas calculer, seulement COPIER de sa source.
 */

/** Une fenetre de contexte declaree, avec la source qui l'etablit. */
export interface ContextWindow {
  /** Motif cherche dans l'identifiant de modele, en minuscules. */
  readonly match: string
  /** Provider qui sert ce modele : un identifiant tiers n'herite pas d'une fenetre Anthropic. */
  readonly provider: string
  readonly tokens: number
  /** D'ou vient ce nombre. Une fenetre sans source n'a rien a faire dans cette table. */
  readonly source: string
}

/**
 * LES FENETRES CONNUES — et rien d'autre.
 *
 * Meme discipline que `MODEL_RATES` dans `cost-estimate.ts`, pour la meme raison : « un montant
 * invente est pire qu'un montant absent ». Aucune fenetre non-Anthropic n'est declaree ici tant
 * qu'aucune source citable ne l'etablit dans ce depot ; un modele absent de cette table rend une
 * jauge ABSENTE, jamais un pourcentage calcule sur une taille supposee.
 *
 * La variante longue fenetre de Sonnet n'est deliberement pas declaree : elle depend d'un en-tete
 * de beta que ce depot n'envoie pas, et supposer 1 M la ou le modele en sert 200 k afficherait
 * 12 % pour un fil en realite sature.
 */
export const CONTEXT_WINDOWS: readonly ContextWindow[] = [
  { match: 'opus', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'sonnet', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'haiku', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'fable', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' }
]

/** Palier de remplissage. Nomme ICI, pour que la vue peigne sans avoir a decider. */
export type ContextGaugeLevel = 'ok' | 'tendu' | 'critique'

export interface ContextGauge {
  /** Tokens reellement envoyes au dernier tour — NON borne, le depassement reste lisible. */
  readonly used: number
  readonly limit: number
  /** Part occupee, bornee a 1 : une barre ne depasse pas son cadre, le fait reste dans `used`. */
  readonly ratio: number
  readonly level: ContextGaugeLevel
  /** Part relue du cache : ce contexte occupe la fenetre sans avoir ete repaye. */
  readonly cacheRead: number
  /** Part payee plein tarif a ce tour. */
  readonly fresh: number
}

/** Au-dela, le fil est TENDU : il reste de la place, elle ne durera pas. */
const SEUIL_TENDU = 0.6
/** Au-dela, CRITIQUE : la prochaine reponse longue peut ne plus tenir. */
const SEUIL_CRITIQUE = 0.85

export function contextWindowFor(
  model: string | undefined,
  provider?: string
): ContextWindow | undefined {
  if (!model) return undefined
  const cle = model.toLowerCase()
  const servi = provider?.toLowerCase()
  return CONTEXT_WINDOWS.find(
    (fenetre) =>
      cle.includes(fenetre.match) && (servi === undefined || servi.includes(fenetre.provider))
  )
}

/**
 * La jauge, ou `undefined` quand on ne SAIT pas.
 *
 * Deux absences distinctes, toutes deux rendues `undefined` plutot que 0 % : fenetre inconnue, et
 * entree non mesuree. Une jauge a zero se lit « ce fil est vide » — une affirmation, la ou la
 * verite est « on l'ignore ».
 */
export function contextGauge(usage: TokenUsage): ContextGauge | undefined {
  const fenetre = contextWindowFor(usage.model, usage.provider)
  if (!fenetre) return undefined
  const used = usage.inputTokens
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return undefined
  const ratio = Math.min(1, used / fenetre.tokens)
  const { fresh, cacheRead } = splitInputTokens(usage)
  return {
    used,
    limit: fenetre.tokens,
    ratio,
    level: ratio >= SEUIL_CRITIQUE ? 'critique' : ratio >= SEUIL_TENDU ? 'tendu' : 'ok',
    cacheRead,
    fresh
  }
}
