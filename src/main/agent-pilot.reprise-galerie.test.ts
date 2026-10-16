import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { recoverCompletedChatProviderCall } from './runs/chat-provider-recovery'
import { writeSurvivableExit } from './runs/stdout-journal'
import { separationEntreBlocsTexte } from '../shared/collage-blocs-texte'

/**
 * REPRISE APRES REDEMARRAGE : LA GALERIE NE DOIT PAS DISPARAITRE.
 *
 * MESURE le 2026-10-16 sur `conv-1002`, tour 9296f09c-6986-41f9-8b6d-f4c2b2a9c2bc (« 2 », tour 3
 * d'un /draft). L'app a redemarre pendant l'appel. L'appel recupere (promptCall du 14:52:08.897Z)
 * portait « …le pilotage.Contrôle à 0. Je relis les 6 onglets.Voici le tour 3 : … ```html-render » :
 * les blocs de texte du CLI recolles SANS separateur. Le direct, lui, les avait separes par
 * `separationEntreBlocsTexte` (« …le pilotage.\n\nContrôle à 0. »). Le prefixe deja affiche ne
 * prefixait donc plus le texte recupere, `consumeStreamedPrefix` tombait dans sa branche « aucun
 * recouvrement » et n'emettait RIEN : le journal du tour ne porte que `0:0:ordered:2` (le bilan), la
 * galerie (premier bloc de texte) n'a jamais atteint le fil. L'utilisateur : « je vois pas de
 * preview au tour precedent pour faire mon choix ».
 */
const BLOCS = [
  "Tu gardes l'**Antenne + moniteurs**. Tour 3 : je resserre sur cette direction.",
  'Contrôle à 0. Je relis les 6 onglets.',
  'Voici le tour 3 : **6 variantes**.\n\n```html-render\n<div class="g">galerie</div>\n```'
]

/** Ce que le direct avait affiche avant la mort du main : les deux premiers blocs, separes. */
function prefixeDiffuseEnDirect(): string {
  let texte = ''
  for (const bloc of BLOCS.slice(0, 2)) texte += separationEntreBlocsTexte(texte, bloc) + bloc
  return texte
}

let root = ''
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

/** Journal du relais tel que le CLI Claude l'ecrit : un message assistant par bloc de texte. */
function journalClaude(): string {
  root = mkdtempSync(join(tmpdir(), 'autowin-reprise-galerie-'))
  const journalPath = join(root, 'provider.stdout.jsonl')
  writeFileSync(
    journalPath,
    [
      ...BLOCS.map((text, index) =>
        JSON.stringify({
          type: 'assistant',
          message: { id: `msg-${index}`, content: [{ type: 'text', text }] }
        })
      ),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: BLOCS[BLOCS.length - 1],
        session_id: 'session-recovered',
        total_cost_usd: 0.1,
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 }
      })
    ].join('\n') + '\n',
    'utf8'
  )
  writeSurvivableExit(journalPath, 0)
  return journalPath
}

async function reprendre(result: SendResult, streamedPrefix: string): Promise<PilotEvent[]> {
  const adapter: ProviderAdapter = {
    id: 'claude',
    auth: async () => true,
    async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
      yield* [] as StreamChunk[]
      return { text: 'Un NOUVEL appel provider.', provider: 'claude', systemInjected: true }
    }
  }
  const events: PilotEvent[] = []
  await new AgentPilot(
    new ProviderRegistry().register(adapter),
    new RoleModelConfig({ orchestrator: { provider: 'claude', model: 'fixture-model' } }),
    {
      catalog: () => [],
      snapshot: () => ({}),
      snapshotForPrompt: async () => ({}),
      exec: vi.fn()
    } as never
  ).chat(
    [{ role: 'user', content: '2' }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-reprise-galerie',
    undefined,
    undefined,
    undefined,
    'turn-reprise-galerie',
    undefined,
    { iteration: 0, attempt: 0, streamId: '0:0', streamedPrefix, result }
  )
  return events
}

describe('reprise de tour — la galerie recuperee atteint le fil', () => {
  it('recolle les blocs du journal comme le direct (meme separateur)', () => {
    let direct = ''
    for (const bloc of BLOCS) direct += separationEntreBlocsTexte(direct, bloc) + bloc
    expect(recoverCompletedChatProviderCall('claude', journalClaude())?.text).toBe(direct)
  })

  it('emet le bloc html-render recupere apres le prefixe deja affiche', async () => {
    const recupere = recoverCompletedChatProviderCall('claude', journalClaude())
    expect(recupere).toBeDefined()
    const events = await reprendre(recupere as SendResult, prefixeDiffuseEnDirect())
    const affiche = events.flatMap((event) => (event.kind === 'delta' ? [event.text] : [])).join('')
    expect(affiche).toContain('```html-render')
    // Rien de deja affiche n'est reemis : le prefixe direct n'apparait pas une seconde fois.
    expect(affiche).not.toContain('Je relis les 6 onglets.')
  })
})
