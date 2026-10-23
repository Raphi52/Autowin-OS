import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ORCHESTRATION_BUDGET } from './orchestration-budget'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur conv-1397. Un tour de chat a été coupé sur « Budget d'appels
 * provider atteint (6) » APRÈS cinq éditions réussies, juste avant sa vérification : le travail est
 * resté à moitié posé et la demande de l'utilisateur perdue.
 *
 * Le `6` était écrit en dur dans `os.ts`, hérité de l'époque où un tour de chat valait UN appel
 * provider. Un tour agentique en consomme un PAR ÉTAPE : ce plafond comptait des coups, pas de la
 * dépense — et il tuait au milieu au lieu de refuser au départ.
 *
 * Le plafond est un plafond FIXE (`maxChatProviderCalls`), volontairement large. Il était aussi
 * réglable dans Settings > Budget jusqu'au retrait de ce réglage (conv-1119, 2026-10-23).
 */

describe('plafond d’appels d’un tour de chat', () => {
  // 2026-09-12 : porté hors d'atteinte sur demande de l'utilisateur — aucun tour ne doit plus
  // mourir sur un compteur d'étapes, quelle que soit sa longueur.
  it('est hors d’atteinte par défaut — un tour ne meurt plus sur un compteur d’étapes', () => {
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).toBe(50_000)
  })

  it('reste très au-dessus du 6 qui coupait les tours', () => {
    // L'assertion qui porte le sens : c'est la valeur mesurée comme trop basse, pas un nombre rond.
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).toBeGreaterThan(6)
  })

  it('est distinct du plafond d’orchestration — un run et un tour ne se comptent pas pareil', () => {
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).not.toBe(
      DEFAULT_ORCHESTRATION_BUDGET.maxProviderCalls
    )
  })
})

describe('le tour de chat consomme bien ce plafond, pas une constante', () => {
  it('`os.ts` ne rabote plus le plafond du chat à une valeur câblée', () => {
    // Contrat sur le source : la garantie vit dans une methode qui exige tout l'OS pour tourner.
    // C'est la forme EXACTE qui a cause le defaut — la reintroduire recouperait les tours.
    const source = new TextDecoder().decode(readFileSync(join(__dirname, 'os.ts')))
    expect(source).not.toMatch(/Math\.min\(settings\.maxProviderCalls,\s*6\)/)
    expect(source).toMatch(/settings\.maxChatProviderCalls/)
  })
})
