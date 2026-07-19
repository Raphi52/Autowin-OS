/**
 * Probe DoD live-subagents : une orchestration lancée depuis une conversation
 *  (1) DIFFUSE les étapes en temps réel (start → exec → judge → gate → end),
 *  (2) persiste le FIL des sous-agents (trace.json) relisible avec le contenu.
 * Chemin de code réel (bus + os), sans GUI.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutowinOS } from '../src/main/os'
import { AppCommandBus, type AppEvent } from '../src/main/commands'
import { loadConvRunTrace } from '../src/main/runs/conv-runs'

const os = new AutowinOS()
const fakeAppData = mkdtempSync(join(tmpdir(), 'aos-probe-live-'))
process.env.APPDATA = fakeAppData
os.setRole('subagent', { provider: 'claude' })
os.setRole('judge', { provider: 'claude' })

const events: AppEvent[] = []
const bus = new AppCommandBus(os, (e) => events.push(e))

const conv = os.conversations.create({
  title: 'Probe live',
  category: 'claude',
  provider: 'claude'
})
bus.activeConversationId = conv.id

const r = await bus.exec('orchestrate', { task: 'Réponds exactement: OK' })
if (!r.ok) {
  console.error('[orchestrate ÉCHEC]', r.error)
  process.exit(1)
}

const kinds = events.map((e) => e.type)
console.log('[events]', JSON.stringify(kinds))
const start = events.find((e) => e.type === 'orchestrate-start')
const stepEvents = events.filter((e) => e.type === 'orchestrate-step') as Array<
  Extract<AppEvent, { type: 'orchestrate-step' }>
>
const end = events.find((e) => e.type === 'orchestrate-end') as
  Extract<AppEvent, { type: 'orchestrate-end' }> | undefined
const stepNames = stepEvents.map((e) => e.step.step)
console.log('[live steps]', JSON.stringify(stepNames), '→ end status:', end?.status)

const runPath = (r.data as { runPath?: string }).runPath
const trace = runPath ? loadConvRunTrace(runPath) : null
console.log('[trace]', trace ? `${trace.length} étapes` : 'ABSENTE')
const execStep = trace?.find((s) => s.step === 'exec')
const judgeStep = trace?.find((s) => s.step === 'judge')
console.log('[exec texte]', execStep?.text ? `"${execStep.text.slice(0, 60)}"` : 'VIDE')
console.log('[juge]', judgeStep?.text ? `"${judgeStep.text.slice(0, 60)}"` : 'VIDE')

const liveOk =
  !!start &&
  stepNames.includes('exec') &&
  stepNames.includes('judge') &&
  stepNames.includes('gate') &&
  !!end
const traceOk = !!trace && trace.length >= 2 && !!execStep?.text && !!judgeStep?.text
console.log('[verdict]', liveOk && traceOk ? 'OK — live + trace sous-agents' : 'ÉCHEC')
rmSync(fakeAppData, { recursive: true, force: true })
process.exit(liveOk && traceOk ? 0 : 1)
