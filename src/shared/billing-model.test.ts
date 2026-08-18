import { describe, expect, it } from 'vitest'
import { billingModelOf, isSubscriptionBilled } from './billing-model'
import { formatCostCoverage, formatCostEquivalent, resolveCostCoverage } from './cost-estimate'

/**
 * CE QUE MONTRE UN ÉCRAN DE COÛT quand rien n'est facturé à l'appel.
 *
 * Demande : « répare tous les moments où ça met coût non exposé et que ça galère à déterminer le
 * coût ». Cause lue : la table de tarifs ne portait que des modèles Anthropic alors que l'exécuteur
 * principal est `GPT-5.6-Sol`. Mais la réparation évidente — ajouter un tarif $/MTok — aurait affiché
 * un montant que l'utilisateur ne paie pas : ni `codex.ts` ni `claude.ts` ne porte de chemin clé-API,
 * les deux passent par un CLI sous abonnement.
 *
 * Choix utilisateur du 2026-08-18 (« les deux, quota d'abord ») : le volume consommé et son
 * appartenance au forfait tiennent la ligne principale, l'équivalent API passe en second et DIT
 * qu'il est conditionnel.
 */
describe('modèle de facturation — ce qu’un montant veut dire', () => {
  it('les deux exécuteurs de cette application sont au FORFAIT (vérifié par lecture)', () => {
    expect(billingModelOf('codex')).toBe('subscription')
    expect(billingModelOf('claude')).toBe('subscription')
    expect(isSubscriptionBilled('codex')).toBe(true)
  })

  it('un provider non vérifié n’hérite JAMAIS d’un contrat par optimisme', () => {
    expect(billingModelOf('mistral')).toBe('unknown')
    expect(billingModelOf(undefined)).toBe('unknown')
    // `unknown` n'est pas `subscription` : on ne déclare pas « inclus » ce qu'on ne connaît pas.
    expect(isSubscriptionBilled('mistral')).toBe(false)
  })
})

describe('surface de coût sous forfait — la demande du 2026-08-18', () => {
  /** L'usage réel signalé par l'utilisateur : 122k tokens sur GPT-5.6-Sol, zéro tour tarifé. */
  const usageCodex = {
    knownCostUsd: null,
    unpricedCalls: 2,
    totalTokens: 122_000,
    inputTokens: 110_000,
    outputTokens: 12_000,
    model: 'gpt-5.6-sol',
    provider: 'codex'
  }

  it('la ligne principale dit le VOLUME et le forfait, jamais un montant', () => {
    const coverage = resolveCostCoverage(usageCodex)
    const ligne = formatCostCoverage(coverage)

    expect(ligne).toContain('122k tokens')
    expect(ligne).toContain('inclus (abo)')
    // Le défaut d'origine et son voisin ont disparu de ce cas.
    expect(ligne).not.toContain('coût non exposé')
    expect(ligne).not.toContain('tarif non exposé')
    // CONTRÔLE de la DoD : aucun montant en dollars sur la ligne principale d'un forfait.
    expect(ligne).not.toMatch(/\d\s*\$/)
    // Les appels non chiffrés restent dits : on ne masque pas une incertitude en la réparant.
    expect(ligne).toContain('2 appels non chiffrés')
  })

  it('la ligne secondaire porte l’équivalent, et DIT qu’il est conditionnel', () => {
    const equivalent = formatCostEquivalent(resolveCostCoverage(usageCodex))
    // 110k × 5 $ + 12k × 30 $ par MTok = 0,55 + 0,36 = 0,91 $.
    expect(equivalent).toContain('0,91')
    expect(equivalent).toContain("si facturé à l'usage")
    // Jamais présenté comme une dépense : le conditionnel est dans le libellé, pas dans une note.
    expect(equivalent).not.toContain('connus')
  })

  it('le mot « connus » ne peut plus qualifier un montant de forfait', () => {
    // Anthropic remonte un `total_cost_usd` : c'est l'équivalent calculé par son CLI, pas un débit.
    const ligne = formatCostCoverage(
      resolveCostCoverage({
        knownCostUsd: 3.5,
        unpricedCalls: 0,
        totalTokens: 50_000,
        model: 'claude-opus-5',
        provider: 'claude'
      })
    )
    expect(ligne).not.toContain('connus')
    expect(ligne).toContain('inclus (abo)')
  })

  it('un provider AU TOKEN garderait bien son montant comme dépense', () => {
    // Entrée discriminante : même usage, provider hors forfait → le montant reprend la ligne
    // principale. Sans cette branche, on aurait remplacé un mensonge par un autre.
    const ligne = formatCostCoverage(
      resolveCostCoverage({
        knownCostUsd: 3.5,
        unpricedCalls: 0,
        totalTokens: 50_000,
        model: 'un-modele-facture',
        provider: 'un-provider-au-token'
      })
    )
    expect(ligne).toContain('3,50')
    expect(ligne).not.toContain('inclus (abo)')
  })

  it('sans aucun montant calculable, l’équivalent est ABSENT — pas zéro', () => {
    const sansTarif = resolveCostCoverage({
      knownCostUsd: null,
      unpricedCalls: 1,
      totalTokens: 9_000,
      inputTokens: 9_000,
      model: 'mistral-large',
      provider: 'codex'
    })
    expect(formatCostEquivalent(sansTarif)).toBeUndefined()
    // La ligne principale reste vraie : le volume est mesuré, le forfait est connu.
    expect(formatCostCoverage(sansTarif)).toContain('9k tokens')
  })

  it('« coût non exposé » ne subsiste que si RIEN n’est connu', () => {
    // Ni montant, ni volume, ni contrat identifié : la dernière marche de la cascade est légitime.
    const rien = resolveCostCoverage({ knownCostUsd: null, unpricedCalls: 0 })
    expect(formatCostCoverage(rien)).toBe('coût non exposé')
  })
})
