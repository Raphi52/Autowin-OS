/**
 * Probe DoD Activité-par-conversation :
 *  (1) une orchestration lancée depuis conv A journalise SES étapes (exec/juge/gate) dans conv A,
 *  (2) chaque étape porte un coût en tokens,
 *  (3) conv B (autre) reste vide → scoping strict.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutowinOS } from '../src/main/os'
import { AppCommandBus } from '../src/main/commands'
import { loadConvActivity } from '../src/main/activity/conv-activity'

const os = new AutowinOS()
const fakeAppData = mkdtempSync(join(tmpdir(), 'aos-probe-act-'))
process.env.APPDATA = fakeAppData
os.setRole('subagent', { provider: 'claude' })
os.setRole('judge', { provider: 'claude' })
const bus = new AppCommandBus(os, () => {})

const a = os.conversations.create({ title: 'Conv A', category: 'claude', provider: 'claude' })
const b = os.conversations.create({ title: 'Conv B', category: 'claude', provider: 'claude' })

bus.activeConversationId = a.id
const r = await bus.exec('orchestrate', { task: 'Réponds exactement: OK' })
if (!r.ok) {
  console.error('[orchestrate ÉCHEC]', r.error)
  process.exit(1)
}

const actA = loadConvActivity(a.id)
const actB = loadConvActivity(b.id)
console.log('[conv A étapes]', actA.map((e) => `${e.kind}:${(e.inputTokens ?? 0) + (e.outputTokens ?? 0)}tok`).join(' '))
console.log('[conv B étapes]', actB.length)
const withTokens = actA.filter((e) => (e.inputTokens ?? 0) + (e.outputTokens ?? 0) > 0)
console.log('[étapes avec tokens]', withTokens.length, '/', actA.length)
console.log('[coût total conv A]', actA.reduce((s, e) => s + (e.costUsd ?? 0), 0).toFixed(4), '$')

const scopeOk = actA.length >= 2 && actB.length === 0
const tokensOk = withTokens.length >= 1
console.log('[verdict]', scopeOk && tokensOk ? 'OK — scopé conv + tokens/étape' : 'ÉCHEC')
rmSync(fakeAppData, { recursive: true, force: true })
process.exit(scopeOk && tokensOk ? 0 : 1)
