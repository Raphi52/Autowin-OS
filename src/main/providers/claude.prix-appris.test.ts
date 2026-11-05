import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptCallRecord } from '../activity/prompt-observability'

/**
 * PREUVE SUR LE CHEMIN RÉEL DE L'ADAPTATEUR : le prix que le CLI facture à une réponse complète
 * (`modelUsage[<modèle>].costUSD`) doit être retenu par l'adaptateur Claude, et servir ensuite à
 * tarifer un appel coupé. Les tests de `activity/cli-usage-recovery.test.ts` prouvent la lecture et
 * l'estimation ; ils ne prouvent pas que l'adaptateur appelle `enregistrerTarifsCli` (conv-1602).
 */
const spawnCapture = vi.hoisted(() => ({ stdoutLines: [] as string[] }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const line of spawnCapture.stdoutLines.splice(0)) {
        stdout.emit('data', Buffer.from(`${line}\n`))
      }
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

/**
 * Ligne `result` RÉELLE, copiée telle quelle de
 * `.autowin-data/autowin-os/run-stdout/c55319db-076c-4201-b8b7-bd8b98515a11.stdout.jsonl` (05/11) :
 * `claude-haiku-5-5` facturé 0,00093225 $ par le CLI. Le modèle y est renommé
 * `claude-haiku-6-adaptateur` : un modèle que la grille range dans la famille `haiku` (1 $ / 5 $),
 * donc 10× trop cher. C'est l'entrée qui fait échouer ce test si l'adaptateur n'enregistre rien.
 */
const RESULTAT_REEL =
  '{"duration_api_ms":4531,"stop_reason":"end_turn","session_id":"359a9232-e4c1-41d9-b6d0-a7511872587a","total_cost_usd":0.00093225,"usage":{"input_tokens":2,"cache_creation_input_tokens":2923,"cache_read_input_tokens":13095,"output_tokens":433,"output_tokens_details":{"thinking_tokens":420},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":2923,"ephemeral_5m_input_tokens":0},"inference_geo":"global","iterations":[{"input_tokens":2,"output_tokens":433,"cache_read_input_tokens":13095,"cache_creation_input_tokens":2923,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2923},"type":"message"}],"speed":"standard","fallback_credit":null},"modelUsage":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":433,"cacheReadInputTokens":13095,"cacheCreationInputTokens":2923,"webSearchRequests":0,"costUSD":0.00093225,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":420,"cacheCreationEphemeral5mInputTokens":0,"cacheCreationEphemeral1hInputTokens":2923,"canonicalModel":"claude-haiku-5-5","provider":"firstParty","costBasis":"list"}},"permission_denials":[],"terminal_reason":"completed","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"safety_stops":0,"is_error":false,"num_turns":1,"subtype":"success","api_error_status":null,"result":"WORKFLOW: exploration","ttft_ms":4747,"type":"result","duration_ms":4776,"uuid":"cca20699-d8ed-4877-9f42-ad7173ad2d79","ttft_stream_ms":1407,"time_to_request_ms":247,"first_content_frame_ms":1408,"queued_turn_count":0,"result_index":0,"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":433,"cacheReadInputTokens":13095,"cacheCreationInputTokens":2923,"webSearchRequests":0,"costUSD":0.00093225,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":420,"cacheCreationEphemeral5mInputTokens":0,"cacheCreationEphemeral1hInputTokens":2923,"canonicalModel":"claude-haiku-5-5","provider":"firstParty","costBasis":"list"}},"credential_expires_at":"2026-11-10T07:39:36.560Z"}'

const MODELE = 'claude-haiku-6-adaptateur'

/** Transcript d'un appel coupé : une requête aux tokens exacts de la ligne réelle. */
function transcriptDeLAppelCoupe(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-prix-appris-adaptateur-'))
  const projet = join(root, 'D--AutoWinOS')
  mkdirSync(projet, { recursive: true })
  writeFileSync(
    join(projet, 'sess-coupee.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-05T12:00:00.000Z',
      requestId: 'req-coupee',
      message: {
        model: MODELE,
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 13095,
          cache_creation_input_tokens: 2923,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2923 },
          output_tokens: 433
        }
      }
    }) + '\n',
    'utf8'
  )
  return root
}

const appelCoupe = {
  id: 'call-coupe',
  ts: '2026-11-05T12:05:00.000Z',
  conversationId: 'conv-1602',
  turnId: 't1',
  iteration: 0,
  actor: 'orchestrator',
  provider: 'claude',
  model: 'haiku',
  transport: 'claude CLI spawn argv',
  boundary: 'b',
  limitation: 'l',
  messages: [],
  options: { argv: ['-p', '--resume', 'sess-coupee'] },
  response: '',
  status: 'failed',
  error: 'claude CLI fige (aucune sortie) - tue par le watchdog',
  durationMs: 600_000
} as unknown as PromptCallRecord

describe('adaptateur Claude — le prix facturé par le CLI tarife les appels coupés', () => {
  beforeEach(() => {
    process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  })

  it('retient le costUSD de la réponse complète et s’en sert pour l’appel coupé', async () => {
    const { recoverUnpricedCallsUsage } = await import('../activity/cli-usage-recovery')
    const root = transcriptDeLAppelCoupe()
    const estimer = (): number | undefined =>
      recoverUnpricedCallsUsage([appelCoupe], { projectsRoots: [root] }).get('call-coupe')
        ?.estimatedUsd
    // Avant toute réponse : la grille (famille `haiku`, 1 $ / 5 $), 10× ce que le CLI facture.
    expect(estimer()).toBeCloseTo(0.0093225, 12)

    spawnCapture.stdoutLines = [
      JSON.stringify({ type: 'assistant', message: { model: MODELE, content: [] } }),
      RESULTAT_REEL.replaceAll('claude-haiku-5-5', MODELE)
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
      toolProfile: 'watchdog-read-only'
    })
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    // Après la réponse : le prix que le CLI a facturé, au token près.
    expect(estimer()).toBeCloseTo(0.00093225, 12)
  })
})
