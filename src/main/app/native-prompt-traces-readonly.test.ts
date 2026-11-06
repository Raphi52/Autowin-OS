import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

function handlerBody(source: string, channel: string, nextChannel?: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  // Borne de fin ROBUSTE : le canal suivant, quel qu'il soit. L'ancien repere
  // (`function rendererLocation`) a quitte `index.ts` pour `window.ts` le 2026-09-02 et
  // rendait ce contrat rouge sans qu'aucun cablage n'ait change.
  const end = nextChannel
    ? source.indexOf(`ipcMain.handle('${nextChannel}'`, start)
    : source.indexOf('ipcMain.handle(', start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Native prompt trace read contract', () => {
  it('keeps causal trace consultation read-only, without a legacy migration at startup', () => {
    const source = sourceProcessPrincipal()
    const body = handlerBody(source, 'os:causalTrace')

    expect(body).not.toContain('causalTrace.append')
    expect(body).not.toContain('causalTrace.nextSequence')
    // La migration de démarrage est RETIRÉE (conv-359, 2026-10-19) : chaque appel de modèle est
    // écrit dans la trace au moment où il a lieu, avec le même identifiant (`run-pilot-chat.ts`,
    // `orchestration-observability.ts`) — 0 appel manquant sur 354 vérifiés. Elle ne rattrapait
    // plus rien et coûtait un `statSync` par conversation à chaque démarrage (9,1 s le 19/10).
    expect(source).not.toContain('migrateLegacyCausalTraces')
  })
})
