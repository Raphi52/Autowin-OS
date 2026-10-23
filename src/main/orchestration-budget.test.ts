import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ORCHESTRATION_BUDGET } from './orchestration-budget'

const source = (fichier: string): string =>
  new TextDecoder().decode(readFileSync(join(__dirname, fichier)))

describe('plafonds d’orchestration', () => {
  it('sont hors d’atteinte d’un usage réel, sans plafond de coût', () => {
    expect(DEFAULT_ORCHESTRATION_BUDGET).toEqual({
      maxUsd: null,
      maxProviderCalls: 20_000,
      maxChatProviderCalls: 50_000,
      maxTotalTokens: 1_000_000_000
    })
  })

  /*
   * RÉGLAGE RETIRÉ le 2026-10-23 (conv-1119 : « enlève budget dans settings, ça sert à rien cette
   * feature »). Le fichier `orchestration-budget.json` déjà écrit sur ce poste portait
   * `maxProviderCalls: 24` — posé par l'ancien script `maximize-budget`. Retirer l'écran sans
   * cesser de LIRE ce fichier aurait laissé une coupure à 24 appels par run que plus personne ne
   * peut voir ni changer. Le contrat : plus aucun point d'entrée ne relit ce fichier.
   */
  it.each(['os.ts', 'index.ts'])('%s ne relit plus le réglage enregistré', (fichier) => {
    const code = source(fichier)
    expect(code).not.toContain('orchestration-budget.json')
    expect(code).not.toMatch(/loadOrchestrationBudget|saveOrchestrationBudget/)
  })
})
