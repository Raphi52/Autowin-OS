/**
 * Probe DoD workflows-par-conversation : orchestration lancée depuis une conversation
 * → RUN.md créé dans le dossier de la conv → clos selon le gate → listé pour CETTE conv
 * seulement ; attach_run fusionne un RUN externe. Chemin de code réel (bus + os), sans GUI.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutowinOS } from '../src/main/os'
import { AppCommandBus } from '../src/main/commands'

// AutowinOS construit SES adaptateurs (claude.exe résolu via le VRAI %APPDATA%) →
// on isole APPDATA APRÈS la construction ; conv-runs/roles y écrivent alors en temp.
const os = new AutowinOS()
const fakeAppData = mkdtempSync(join(tmpdir(), 'aos-probe-appdata-'))
process.env.APPDATA = fakeAppData
os.setRole('subagent', { provider: 'claude' })
os.setRole('judge', { provider: 'claude' })
const bus = new AppCommandBus(os, () => {})

// 1. une conversation + contexte actif
const conv = os.conversations.create({
  title: 'Probe workflows',
  category: 'claude',
  provider: 'claude'
})
bus.activeConversationId = conv.id

// 2. orchestration réelle → doit créer + clore un RUN dans runs/<convId>/
const r = await bus.exec('orchestrate', { task: 'Réponds exactement: OK' })
if (!r.ok) {
  console.error('[orchestrate ÉCHEC]', r.error)
  process.exit(1)
}
const data = r.data as { valid: boolean; gateBlocked: boolean; runPath?: string }
console.log(
  '[orchestrate]',
  JSON.stringify({ valid: data.valid, gateBlocked: data.gateBlocked, runPath: !!data.runPath })
)
const runOk = !!data.runPath && existsSync(data.runPath)
const md = runOk ? readFileSync(data.runPath!, 'utf8') : ''
const statusLine = md.split('\n')[0]
console.log('[RUN.md]', runOk ? `créé, ${statusLine}` : 'ABSENT')

// 3. scope : listé pour cette conv, PAS pour une autre
const mine = await bus.exec('get_state', {}) // sanity
const { listConvRuns } = await import('../src/main/runs/conv-runs')
const own = listConvRuns(conv.id, [])
const other = listConvRuns('conv-inexistante', [])
console.log(`[scope] conv=${own.length} autre=${other.length}`)

// 4. attach_run d'un RUN externe
const extDir = join(fakeAppData, 'ext', 'sujet-x-workspace')
mkdirSync(extDir, { recursive: true })
const ext = join(extDir, 'RUN.md')
writeFileSync(ext, 'status: green\n\n## Besoin\nexterne\n', 'utf8')
const att = await bus.exec('attach_run', { path: ext })
console.log('[attach]', JSON.stringify(att.ok ? att.data : att.error))
const merged = listConvRuns(conv.id, os.conversations.get(conv.id)?.runPaths ?? [])
console.log(
  `[merged] ${merged.length} runs (dont attaché: ${merged.some((x) => x.session === 'attaché')})`
)

const statusClosed = /^status: (green|red)$/m.test(md)
const verdict =
  runOk && statusClosed && own.length === 1 && other.length === 0 && att.ok && merged.length === 2
console.log('[verdict]', verdict ? 'OK' : 'ÉCHEC')
rmSync(fakeAppData, { recursive: true, force: true })
process.exit(verdict ? 0 : 1)
