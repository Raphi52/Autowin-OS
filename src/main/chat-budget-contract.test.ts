import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import type { OrchestrationStep } from './orchestrator'

/**
 * BUDGET D'UN TOUR DE CHAT.
 *
 * Le circuit-breaker de coût ne protegeait que les runs orchestres. Mesure du 2026-07-28 : un seul
 * tour a coute 2,109 $ (40 iterations d'outils) sans qu'aucune borne n'existe cote chat, dans une
 * session facturee 26,65 $/h. Ces assertions garantissent que le tour de chat est borne ET coupe.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const chatRunner = source.slice(
  source.indexOf('const runPilotChat'),
  source.indexOf("ipcMain.handle('os:pilotChat'")
)

describe('tour de chat — budget applique', () => {
  it('instancie un breaker dans le runner partagé du tour de chat', () => {
    expect(chatRunner).toContain('new CostCircuitBreaker(')
    expect(chatRunner).toContain('AUTOWIN_CHAT_USD_CAP')
  })

  it('compte CHAQUE appel du tour (et pas seulement le total final)', () => {
    expect(chatRunner).toContain('chatBreaker.observe(')
    expect(chatRunner).toMatch(/prompt-call.*callUsage|callUsage[\s\S]{0,200}chatBreaker\.observe/)
  })

  it('COUPE reellement le tour au depassement (abort, pas un simple log)', () => {
    const tripBlock = chatRunner.slice(chatRunner.indexOf('chatBreaker.observe('))
    expect(tripBlock).toContain('controller.abort(')
  })

  it('a un plafond par DEFAUT (une variable d’env absente ne desarme pas la garde)', () => {
    // Le defaut doit etre un nombre positif : sans lui, un poste sans env serait sans protection.
    expect(chatRunner).toMatch(/maxUsd:[\s\S]{0,120}:\s*\d+(\.\d+)?/)
    expect(chatRunner).toMatch(/maxTokens:[\s\S]{0,160}:\s*1_500_000/)
    expect(chatRunner).toMatch(/maxCalls:[\s\S]{0,120}:\s*6/)
  })

  it('place tout le tour dans le supervisor avant le premier appel provider', () => {
    expect(chatRunner).toContain('os.runChatTurn(')
  })
})

describe('breaker — comportement sur des usages de CHAT reels', () => {
  const step = (costUsd: number): OrchestrationStep =>
    ({ step: 'exec', detail: 'chat', costUsd, tokens: 1000 }) as OrchestrationStep

  it('laisse passer un tour normal (mesure post-correctif : ~0,05 $)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 2 })
    expect(breaker.observe(step(0.05))).toBeNull()
    expect(breaker.observe(step(0.05))).toBeNull()
    expect(breaker.hasTripped).toBe(false)
  })

  it('coupe le tour a 40 iterations qui derapent (cas mesure a 2,109 $)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 2 })
    let trippedAt = 0
    for (let i = 1; i <= 40; i++) {
      if (breaker.observe(step(0.0527)) && !trippedAt) trippedAt = i
    }
    expect(trippedAt).toBeGreaterThan(0)
    expect(trippedAt).toBeLessThan(40) // coupe AVANT la fin, pas en post-mortem
  })

  it('ne trip qu’une fois (pas de coupure en boucle pendant la propagation de l’abort)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 0.1 })
    expect(breaker.observe(step(0.5))).not.toBeNull()
    expect(breaker.observe(step(0.5))).toBeNull()
  })
})
