/**
 * COMMENT un provider est facturé — et donc ce qu'un montant VEUT DIRE sur cet écran.
 *
 * Défaut cadré le 2026-08-18. L'utilisateur voit « coût non exposé » partout et « coût 122k tokens ·
 * tarif non exposé » sur ses clôtures. Cause : la table de tarifs ne portait que des modèles
 * Anthropic, alors que son exécuteur principal est `GPT-5.6-Sol`. Mais la réparation évidente —
 * ajouter un tarif $/MTok pour gpt-5.6 — aurait été FAUSSE, et c'est tout l'objet de ce module.
 *
 * Vérifié par lecture des adaptateurs : ni `codex.ts` ni `claude.ts` ne porte de chemin clé-API
 * (aucun `OPENAI_API_KEY`, aucun `ANTHROPIC_API_KEY`). Les deux exécuteurs passent par leur CLI, donc
 * par un ABONNEMENT — OAuth ChatGPT pour l'un (`codex-auth.ts`), Claude Code pour l'autre. Sur un
 * forfait, un appel n'a pas de coût marginal : il consomme du quota.
 *
 * Conséquence qui dépasse le symptôme signalé : **aucun montant affiché par cette application n'est
 * une dépense réelle**, pas même côté Anthropic. Le `total_cost_usd` que remonte le CLI Claude
 * (`claude.ts:974-977`) est l'équivalent API qu'il calcule, pas un débit. Le libellé historique
 * « 3.50 $ connus » présentait donc un équivalent comme un montant facturé.
 *
 * Ce module ne calcule aucun prix. Il répond à une seule question — « ce montant, l'utilisateur le
 * paie-t-il à l'appel ? » — pour que les surfaces nomment ce qu'elles montrent au lieu de laisser
 * croire à un débit.
 */

/** Comment la consommation d'un provider se paie. */
export type BillingModel =
  /**
   * Forfait : l'appel ne coûte rien à la marge, il consomme du quota. Un montant reste calculable
   * au tarif public, mais c'est un ÉQUIVALENT — jamais une dépense.
   */
  | 'subscription'
  /** À l'usage : le montant est un débit réel. Aucun provider de cette application n'est ici. */
  | 'per-token'
  /** Contrat inconnu : on ne présume rien, et surtout pas un débit. */
  | 'unknown'

/**
 * Providers dont le contrat est ÉTABLI par lecture du code, pas supposé.
 *
 * La clé est le provider, pas le modèle : `gpt-5.6-sol` facturé à l'usage via l'API OpenAI serait
 * `per-token`, mais cette application ne l'atteint que par l'abonnement. Le jour où un chemin
 * clé-API existe, c'est ICI que la distinction se fait — et le test de non-régression qui garde
 * `codex` et `claude` en `subscription` devra être mis à jour EN MÊME TEMPS que ce chemin.
 */
const BILLING_BY_PROVIDER: Readonly<Record<string, BillingModel>> = {
  // OAuth ChatGPT uniquement (`codex-auth.ts`) — aucun `OPENAI_API_KEY` dans l'adaptateur.
  codex: 'subscription',
  // CLI `claude` uniquement — aucun `ANTHROPIC_API_KEY` dans l'adaptateur.
  claude: 'subscription'
}

/**
 * Le modèle de facturation d'un provider. `unknown` par défaut : un provider qu'on n'a pas vérifié
 * ne se voit pas attribuer un contrat par optimisme.
 */
export function billingModelOf(provider: string | undefined): BillingModel {
  if (!provider) return 'unknown'
  return BILLING_BY_PROVIDER[provider.toLowerCase()] ?? 'unknown'
}

/** Cette consommation est-elle couverte par un forfait déjà payé ? */
export function isSubscriptionBilled(provider: string | undefined): boolean {
  return billingModelOf(provider) === 'subscription'
}
