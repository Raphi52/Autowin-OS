import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConversationStore } from './store/conversations'

/**
 * Bouton « Reprendre » invisible : le handler IPC `os:orchestrate` lance la pipeline mais ne persiste
 * RIEN dans la conversation (il n'émet que le ledger + `orchestrate:step`, canal qu'aucun composant du
 * renderer n'écoute). Rien ne survit donc à un rechargement, et un échec est jeté par le `void` côté
 * renderer.
 *
 * Ce fichier prouve deux choses :
 *  1. CONTRAT (fonctionnel, sur le vrai store) : la séquence beginTurn → command/result → done|failed
 *     produit bien un tour VISIBLE et rechargeable — c'est la cible.
 *  2. CÂBLAGE (structurel, sur la source réelle du handler) : `os:orchestrate` exécute effectivement
 *     cette séquence. Ces assertions sont ROUGES avant le fix, faute d'un accès importable au handler
 *     (src/main/index.ts déclenche l'app Electron) — même technique que
 *     `agent-pilot.turn-contract.test.ts`.
 */

const clock = (start = 1000): (() => number) => {
  let t = start
  return () => t++
}

/** Corps du handler `os:orchestrate` uniquement — jamais celui du voisin `os:pilotChat`. */
function orchestrateHandlerSource(): string {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const start = source.indexOf("ipcMain.handle('os:orchestrate'")
  expect(start, "handler os:orchestrate introuvable").toBeGreaterThan(-1)
  const next = source.indexOf('ipcMain.handle(', start + 20)
  return source.slice(start, next > -1 ? next : undefined)
}

describe('os:orchestrate — persistance du tour dans la conversation', () => {
  it('contrat : une étape puis une clôture donnent un tour visible et rechargeable', () => {
    const store = new ConversationStore(clock())
    const conv = store.create({ title: 'Reprise', category: 'native', provider: 'codex' })
    const turnId = 'turn-orch-1'

    store.beginTurn(
      conv.id,
      { content: 'Reprendre la tâche' },
      { turnId, runtime: { provider: 'codex', model: 'gpt-test' } }
    )
    store.applyTurnEvent(conv.id, turnId, {
      kind: 'command',
      actionId: `${turnId}:scout:0`,
      name: 'scout'
    })
    store.applyTurnEvent(conv.id, turnId, {
      kind: 'result',
      actionId: `${turnId}:scout:0`,
      name: 'scout',
      ok: true,
      data: { text: 'candidats' }
    })
    const after = store.applyTurnEvent(conv.id, turnId, { kind: 'done' })

    const user = after.messages.find((m) => m.role === 'user')
    const assistant = after.messages.find((m) => m.role === 'assistant' && m.turnId === turnId)
    expect(user?.content).toBe('Reprendre la tâche')
    expect(assistant).toBeTruthy()
    expect(assistant?.status).toBe('completed')
    expect(JSON.stringify(assistant?.parts ?? [])).toContain('scout')
  })

  it("contrat : un échec de pipeline produit un tour d'erreur visible", () => {
    const store = new ConversationStore(clock())
    const conv = store.create({ title: 'Reprise', category: 'native', provider: 'codex' })
    const turnId = 'turn-orch-2'

    store.beginTurn(conv.id, { content: 'Reprendre' }, { turnId })
    const after = store.applyTurnEvent(conv.id, turnId, { kind: 'failed', error: 'Run annulé' })

    const assistant = after.messages.find((m) => m.role === 'assistant' && m.turnId === turnId)
    expect(assistant?.status).toBe('failed')
    expect(assistant?.error).toBe('Run annulé')
  })

  it('câblage : le handler ouvre le tour avant toute étape, sous garde de conversation réelle', () => {
    const handler = orchestrateHandlerSource()
    expect(handler).toContain('os.conversations.beginTurn(')
    expect(handler).toMatch(/conversationId !== '__autonomous__'/)
    expect(handler).toMatch(/os\.conversations\.get\(conversationId\)/)
    // le turnId déjà généré est réutilisé, pas un second
    expect(handler.match(/randomUUID\(\)/g) ?? []).toHaveLength(1)
    expect(handler).toMatch(/beginTurn\([\s\S]*?turnId/)
  })

  it('câblage : chaque étape de pipeline est persistée dans le tour', () => {
    const handler = orchestrateHandlerSource()
    const applyCalls = handler.match(/os\.conversations\.applyTurnEvent\(/g) ?? []
    expect(applyCalls.length).toBeGreaterThanOrEqual(2)
    expect(handler).toMatch(/kind: 'command'/)
    expect(handler).toMatch(/kind: 'result'/)
  })

  it('câblage : la clôture et l’échec/annulation sont persistés (erreur visible dans le fil)', () => {
    const handler = orchestrateHandlerSource()
    expect(handler).toMatch(/kind: 'done'/)
    expect(handler).toMatch(/kind: '(failed|cancelled)'/)
    // le bloc catch ne se contente plus de retourner {ok:false}
    const catchBlock = handler.slice(handler.indexOf('} catch ('))
    expect(catchBlock).toMatch(/applyTurnEvent/)
  })
})
