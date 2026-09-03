import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  recoverUnpricedCallsUsage,
  sessionIdFromArgv,
  type RecoveredCallUsage
} from './cli-usage-recovery'
import {
  applyRecoveredUsage,
  costSamplesFrom,
  summarizeCostSamples,
  type PromptCallRecord
} from './prompt-observability'

/**
 * « 7,00 $ + non exposé » — ce que l'utilisateur a sous les yeux quand un appel meurt sans que le
 * CLI ait eu le temps d'émettre son event `result` (tué par le watchdog). Le montant manquant n'est
 * PAS perdu : le CLI a écrit chaque message assistant, avec son `usage`, dans
 * `~/.claude/projects/<projet>/<session>.jsonl`. Ce test verrouille la récupération de ces valeurs.
 *
 * Mesure de terrain (2026-09-03, conv-1, session b5f40533) qui a servi d'oracle : sur un appel
 * DÉJÀ tarifé par le CLI (2,2687 $), la même fenêtre lue dans le transcript rend exactement
 * `inputTokens` = 3 006 418 et `outputTokens` = 16 371 — les deux chiffres du journal, au token.
 */

/** Ligne assistant telle que le CLI l'écrit (forme relue sur un transcript réel). */
const ligne = (
  ts: string,
  requestId: string,
  usage: Record<string, number>,
  model = 'claude-opus-5'
): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    requestId,
    isSidechain: false,
    message: { model, usage }
  })

const USAGE_A = {
  input_tokens: 4,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  output_tokens: 100
}
const USAGE_B = {
  input_tokens: 2,
  cache_read_input_tokens: 500,
  cache_creation_input_tokens: 0,
  output_tokens: 60
}

/**
 * FENÊTRE : le transcript est un journal de SESSION, pas d'appel. Il contient donc le travail des
 * appels voisins — dont ceux que le provider a déjà tarifés. Les lignes `req-avant` et `req-apres`
 * sont l'entrée qui doit faire ÉCHOUER ce test si la récupération lisait le fichier entier
 * (999 999 et 888 888 tokens de sortie : impossibles à confondre avec un total juste).
 *
 * DOUBLON : `req-a` est écrit TROIS fois (partiels de streaming). C'est l'entrée qui doit faire
 * échouer ce test si la récupération sommait les lignes au lieu de dédoublonner par `requestId` —
 * observé sur le transcript réel, où 140 lignes assistant ne portent que 79 requêtes distinctes.
 */
function transcriptRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-cli-usage-'))
  const projet = join(root, 'C--Sources-AutoWinOS')
  mkdirSync(projet, { recursive: true })
  writeFileSync(
    join(projet, 'sess-1.jsonl'),
    [
      ligne('2026-09-02T10:00:00.000Z', 'req-avant', { ...USAGE_A, output_tokens: 999999 }),
      ligne('2026-09-02T12:00:00.000Z', 'req-a', USAGE_A),
      ligne('2026-09-02T12:00:01.000Z', 'req-a', USAGE_A),
      ligne('2026-09-02T12:00:02.000Z', 'req-a', USAGE_A),
      JSON.stringify({ type: 'user', timestamp: '2026-09-02T12:00:03.000Z', message: {} }),
      ligne('2026-09-02T12:01:00.000Z', 'req-b', USAGE_B),
      ligne('2026-09-02T13:00:00.000Z', 'req-apres', { ...USAGE_A, output_tokens: 888888 }),
      'pas du json'
    ].join('\n') + '\n',
    'utf8'
  )
  return root
}

const appelTue = (overrides: Partial<PromptCallRecord> = {}): PromptCallRecord =>
  ({
    id: 'call-tue',
    ts: '2026-09-02T12:05:00.000Z',
    conversationId: 'conv-1',
    turnId: 't1',
    iteration: 0,
    actor: 'orchestrator',
    provider: 'claude',
    model: 'opus',
    transport: 'claude CLI spawn argv',
    boundary: 'b',
    limitation: 'l',
    messages: [],
    options: { argv: ['-p', '--resume', 'sess-1', '--model', 'opus'] },
    response: '',
    status: 'failed',
    error: 'claude CLI fige (aucune sortie) - tue par le watchdog',
    durationMs: 600_000,
    ...overrides
  }) as PromptCallRecord

describe('session du CLI dans les arguments', () => {
  it('lit --resume et --session-id, et ne devine rien sans eux', () => {
    expect(sessionIdFromArgv(['-p', '--resume', 'abc'])).toBe('abc')
    expect(sessionIdFromArgv(['--session-id', 'def', '-p'])).toBe('def')
    expect(sessionIdFromArgv(['-p', '--model', 'opus'])).toBeUndefined()
    expect(sessionIdFromArgv(undefined)).toBeUndefined()
    // Un drapeau en fin de tableau n'a pas de valeur : ne pas rendre `undefined` casserait le lookup.
    expect(sessionIdFromArgv(['--resume'])).toBeUndefined()
  })
})

describe('récupération des tokens auprès du CLI', () => {
  it('additionne les requêtes de la fenêtre, chacune UNE fois', () => {
    const root = transcriptRoot()
    const recupere = recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [root] })
    const usage = recupere.get('call-tue') as RecoveredCallUsage

    expect(usage).toBeDefined()
    expect(usage.requests).toBe(2)
    // input TOTAL, cache inclus (invariant de `Usage`) : (4+1000+200) + (2+500+0)
    expect(usage.inputTokens).toBe(1706)
    expect(usage.outputTokens).toBe(160)
    expect(usage.cacheReadTokens).toBe(1500)
    expect(usage.cacheCreationTokens).toBe(200)
    expect(usage.model).toBe('claude-opus-5')
    // Tarif public opus : 6 frais + 200 écrits (1,25x) + 1500 relus (0,1x) + 160 sortis.
    expect(usage.estimatedUsd).toBeCloseTo(
      (6 * 5 + 200 * 5 * 1.25 + 1500 * 5 * 0.1 + 160 * 25) / 1_000_000,
      9
    )
  })

  it("borne la fenêtre à l'appel PRÉCÉDENT quand la durée mesurée est absurde", () => {
    const root = transcriptRoot()
    // Vécu sur conv-1 : le watchdog a écrit `durationMs` = 32 940 076 ms (9 h). Sans borne, la
    // fenêtre remonte avant un appel DÉJÀ tarifé et récupère ses tokens une seconde fois.
    const precedent = appelTue({
      id: 'call-tarife',
      ts: '2026-09-02T11:00:00.000Z',
      status: 'completed',
      usage: { inputTokens: 1204, outputTokens: 999999, costUsd: 1.5 }
    })
    const recupere = recoverUnpricedCallsUsage([precedent, appelTue({ durationMs: 32_940_076 })], {
      projectsRoots: [root]
    })

    expect(recupere.has('call-tarife')).toBe(false)
    // `req-avant` (10:00) est AVANT la fin de l'appel tarifé (11:00) : il reste hors fenêtre.
    expect(recupere.get('call-tue')?.outputTokens).toBe(160)
  })

  it('ne rend rien quand le transcript est absent — jamais un montant inventé', () => {
    const vide = mkdtempSync(join(tmpdir(), 'autowin-cli-usage-vide-'))
    expect(recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [vide] }).size).toBe(0)
  })

  it("ignore l'appel qui porte DÉJÀ un coût du provider", () => {
    const root = transcriptRoot()
    const tarife = appelTue({
      id: 'call-ok',
      status: 'completed',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.42 }
    })
    expect(recoverUnpricedCallsUsage([tarife], { projectsRoots: [root] }).size).toBe(0)
  })
})

describe('le total ne dit plus « non exposé » quand la valeur est récupérable', () => {
  it("porte les tokens récupérés et leur estimation sur la ligne de l'acteur", () => {
    const root = transcriptRoot()
    const appels = [appelTue()]
    const recupere = recoverUnpricedCallsUsage(appels, { projectsRoots: [root] })
    const rows = summarizeCostSamples(
      applyRecoveredUsage(costSamplesFrom(appels), recupere),
      'actor'
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'orchestrator',
      calls: 1,
      inputTokens: 1706,
      outputTokens: 160,
      unpricedCalls: 1,
      estimatedCalls: 1
    })
    expect(rows[0].estimatedUsd).toBeCloseTo(recupere.get('call-tue')!.estimatedUsd!, 9)
  })
})
