/**
 * Probe DoD observatoire d'activité :
 *  1. perf : parse du PLUS GROS transcript réel < 3 s (streaming, pas de gel),
 *  2. contenu : tool calls + screenshots extraits,
 *  3. ledger : append d'un événement → relu.
 */
import { listSessions, parseSession } from '../src/main/activity/transcripts'
import { TraceLedger } from '../src/main/activity/ledger'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const sessions = listSessions(200)
console.log(`[probe] ${sessions.length} sessions trouvées`)
const biggest = [...sessions].sort((a, b) => b.sizeMb - a.sizeMb)[0]
console.log(`[probe] plus gros: ${biggest.project}/${biggest.id.slice(0, 8)} ${biggest.sizeMb} Mo`)

const t0 = Date.now()
const a = await parseSession(biggest)
const ms = Date.now() - t0
console.log(
  `[probe] parse ${ms} ms · ${a.turns.length} tours · ${a.totalToolCalls} tool calls · ${a.images.length} screenshots`
)
const topTools = Object.entries(a.toolCounts)
  .sort((x, y) => y[1] - x[1])
  .slice(0, 5)
console.log(`[probe] top tools: ${topTools.map(([t, n]) => `${t}=${n}`).join(' ')}`)

// cache : le 2e appel doit être quasi-instantané
const t1 = Date.now()
await parseSession(biggest)
const cacheMs = Date.now() - t1
console.log(`[probe] re-parse (cache): ${cacheMs} ms`)

// ledger roundtrip
const dir = mkdtempSync(join(tmpdir(), 'aos-probe-ledger-'))
const ledger = new TraceLedger(dir)
ledger.append({ source: 'bus', name: 'probe_command', detail: '{"probe":true}', ok: true })
const back = ledger.recent(5)
const ledgerOk = back.length === 1 && back[0].name === 'probe_command' && back[0].ok === true
console.log(`[probe] ledger roundtrip: ${ledgerOk ? 'OK' : 'ÉCHEC'}`)
rmSync(dir, { recursive: true, force: true })

const perfOk = ms < 3000
const contentOk = a.totalToolCalls > 0 && a.turns.length > 0
console.log(`[verdict] perf(<3s)=${perfOk} contenu=${contentOk} cache(<100ms)=${cacheMs < 100} ledger=${ledgerOk}`)
process.exit(perfOk && contentOk && ledgerOk ? 0 : 1)
