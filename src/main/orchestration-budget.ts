export interface OrchestrationBudgetSettings {
  /** Maximum cumulative orchestration cost in USD. `null` deliberately disables the cost cap. */
  maxUsd: number | null
  /** Hard ceiling shared by every orchestration entrypoint. */
  maxProviderCalls: number
  /**
   * Plafond d'appels d'UN TOUR DE CHAT, distinct du plafond d'orchestration.
   *
   * Mesuré le 2026-08-25 sur conv-1397 : un tour a été coupé sur « Budget d'appels provider atteint
   * (6) » APRÈS cinq éditions réussies, juste avant sa vérification — travail à moitié posé, demande
   * perdue. Ce 6 était écrit en dur dans `os.ts`, hérité de l'époque où un tour de chat valait UN
   * appel. Un tour agentique en consomme un PAR ÉTAPE : le plafond comptait des étapes, pas de la
   * dépense.
   *
   * Volontairement très large : un tour ne doit pas mourir sur un compteur d'étapes.
   */
  maxChatProviderCalls: number
  /** Input + output tokens. Works even when a provider exposes no USD cost. */
  maxTotalTokens: number
}

/*
 * DECISION UTILISATEUR DU 2026-09-12 : plus aucun plafond PAR DEFAUT ne coupe un travail en cours.
 * Ces valeurs sont hors d'atteinte d'un usage reel.
 *
 * DECISION UTILISATEUR DU 2026-10-23 (conv-1119 : « enleve budget dans settings, ca sert a rien
 * cette feature ») : le reglage n'existe plus. Ces plafonds sont les SEULS appliques — plus d'ecran
 * pour les changer, et le fichier `orchestration-budget.json` deja ecrit sur un poste n'est plus lu :
 * le garder lu aurait laisse un plafond cache (24 appels par run sur le poste de dev) que plus
 * personne ne pouvait voir ni modifier.
 */
export const DEFAULT_ORCHESTRATION_BUDGET: Readonly<OrchestrationBudgetSettings> = Object.freeze({
  maxUsd: null,
  maxProviderCalls: 20_000,
  maxChatProviderCalls: 50_000,
  maxTotalTokens: 1_000_000_000
})
