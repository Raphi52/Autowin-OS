/**
 * UN TRAVAIL ARRETE NE DOIT PAS TUER LA CHAINE AUTOMATIQUE.
 *
 * Mesure conv-597, tour `ac411810-571a-4a7c-ae59-86be8c15e759` (saisie ts 1789564941442 :
 * « yavais pas de preprompt le mode auto a pas pu continuer ») : l'orchestration finit
 * `gateBlocked: true`, le texte affiche commence par « ⛔ Workflow ARRETE au controle final » et
 * ne porte AUCUNE ligne « 👉 Recommande » — celle-ci n'etait poussee que dans la branche
 * `delivered`. Or `deciderRelanceAuto` (chat-auto-mode.ts) lit exactement cette rubrique comme
 * repli de prompt : sans elle, il rend `aucun-prompt` et le mode auto s'arrete precisement quand
 * l'utilisateur en a le plus besoin — sur un echec, a 10,90 $ deja depenses.
 */
import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'
import { extractRecommendation } from '../renderer/src/components/markdown-recommandation'

describe('cloture d une orchestration NON livree', () => {
  it('rend une suite lisible par le mode auto quand le gate a bloque', () => {
    const texte = formatOrchestrationOutcome(true, {
      valid: false,
      gateBlocked: true,
      status: 'failed',
      result: 'travail interrompu'
    } as never)
    expect(texte).toContain('⛔ Workflow ARRÊTÉ au contrôle final')
    const suite = extractRecommendation(texte)
    expect(suite).toBeTruthy()
    expect(String(suite).length).toBeGreaterThan(20)
  })

  it('ne fabrique aucune suite quand le travail est livre et termine', () => {
    const texte = formatOrchestrationOutcome(true, {
      valid: true,
      gateBlocked: false,
      status: 'green',
      delivered: true,
      result: 'ok'
    } as never)
    expect(texte).not.toContain('reprendre le travail arrêté')
  })
})
