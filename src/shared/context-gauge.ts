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
 * invente est pire qu'un montant absent ». Chaque fenetre porte la source qui l'etablit, et un
 * modele absent de cette table rend une jauge ABSENTE, jamais un pourcentage calcule sur une
 * taille supposee. La table couvre les QUATRE providers reellement servis (`main/models.ts`) :
 * les fenetres differant d'un facteur cinq entre eux (200 k a 1 M), appliquer 200 k partout
 * affichait « sature » a 20 % sur Gemini.
 *
 * La variante longue fenetre de Sonnet n'est deliberement pas declaree : elle depend d'un en-tete
 * de beta que ce depot n'envoie pas, et supposer 1 M la ou le modele en sert 200 k afficherait
 * 12 % pour un fil en realite sature.
 */
export const CONTEXT_WINDOWS: readonly ContextWindow[] = [
  // Anthropic — toute la famille servie par le CLI (`model-aliases.ts` : opus, sonnet, haiku,
  // fable) plus `mythos`, present dans MODEL_RATES et jusqu'ici SANS fenetre : un modele
  // reellement servi n'affichait donc aucune jauge.
  // OPUS : 1 M. NE REMETS PAS 200_000 ICI.
  //
  // Tranche par l'utilisateur TROIS fois (conv-267, conv-292, puis conv-297 du 2026-09-05, ou il a
  // du le redire une troisieme fois). Le champ avait deja fait l'aller-retour : chaque passage
  // relisait le commentaire qui defendait 200 k, concluait « aucune source publique ne l'etablit »
  // et ANNULAIT la decision. Ce commentaire-la n'etait pas une garde, il etait la CAUSE de la
  // recidive — il transformait une preference tranchee en anomalie a corriger. Les tests de
  // `context-gauge.test.ts` figeaient la meme valeur et la rendaient carrement inapplicable : ils
  // prennent desormais `sonnet` comme modele d'exemple a 200 k, et opus porte son assertion propre.
  //
  // Qui decide ici : l'utilisateur exploite SON abonnement sur SON poste et observe la fenetre
  // qu'on lui sert. Cette observation est une source, et elle prime sur une page de documentation
  // que ce depot ne peut pas interroger. Le risque d'un denominateur trop GRAND (afficher 20 % la
  // ou le fil sature) est reel, il l'assume, et il verra la troncature. Seule une saturation
  // OBSERVEE en dessous de 1 M justifierait d'y revenir — jamais un raisonnement sur la doc.
  { match: 'opus', provider: 'claude', tokens: 1_000_000, source: 'Utilisateur — fenêtre observée sur son abonnement (conv-267, conv-292, conv-297)' },
  { match: 'sonnet', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'haiku', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'fable', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  { match: 'mythos', provider: 'claude', tokens: 200_000, source: 'Anthropic — Claude, fenêtre standard 200k' },
  // OpenAI / Codex — la famille GPT-5 sert 400 k de contexte d'entree. Les noms internes
  // (`sol`, `terra`, `luna`, cf. MODEL_RATES) sont declares en plus du motif generique, car le
  // catalogue live rend aussi des ids sans `gpt-5` en prefixe.
  { match: 'sol', provider: 'codex', tokens: 400_000, source: 'OpenAI — famille GPT-5, contexte 400k' },
  { match: 'terra', provider: 'codex', tokens: 400_000, source: 'OpenAI — famille GPT-5, contexte 400k' },
  { match: 'luna', provider: 'codex', tokens: 400_000, source: 'OpenAI — famille GPT-5, contexte 400k' },
  { match: 'gpt-5', provider: 'codex', tokens: 400_000, source: 'OpenAI — famille GPT-5, contexte 400k' },
  // Google — les lignes Gemini Pro et Flash servies par `providers/gemini.ts` annoncent 1 M
  // d'entree. C'est la SEULE fenetre 1 M de cette table, et elle ne demande aucun en-tete.
  { match: 'gemini', provider: 'gemini', tokens: 1_000_000, source: 'Google — Gemini Pro/Flash, contexte 1M' },
  // Moonshot — Kimi for Coding, 256 k.
  { match: 'kimi', provider: 'kimi', tokens: 256_000, source: 'Moonshot — Kimi, contexte 256k' }
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

function contextWindowFor(
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

/**
 * LA DEMANDE DE COMPACTION — un message adresse a l'agent, pas une troncature muette.
 *
 * Ce depot n'a AUCUNE mecanique de compaction cote moteur : la seule reponse a la saturation etait
 * la troncature brute des quarante derniers messages (`chat-turn-messages.ts`). Inventer ici un
 * elagage silencieux ferait disparaitre du contexte sans trace. Le bouton envoie donc un TOUR
 * normal, visible dans le fil et journalise comme tout autre message : l'agent produit le resume,
 * et c'est ce resume qui porte le fil ensuite.
 */
export const COMPACT_REQUEST =
  'Compacte ce fil : produis un resume dense et autonome de la conversation jusqu ici — objectif ' +
  'poursuivi, decisions prises et leurs raisons, fichiers et artefacts touches, preuves obtenues, ' +
  'et le reste a faire. Ecris-le pour qu un agent qui n aurait PAS lu les messages precedents ' +
  'puisse reprendre le travail a partir de ce seul message. N execute aucune autre action.'
