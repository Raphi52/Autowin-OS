import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CodexAdapter } from '../src/main/providers/codex'

const workspace = resolve(process.cwd())
const proof = join(
  workspace,
  'Audit',
  'workspaces',
  '019f79e9-caf2-7531-92f5-73caaa98a327',
  'orchestration-tool-executor-workspace',
  `executor-proof-${randomUUID()}.txt`
)
rmSync(proof, { force: true })
const adapter = new CodexAdapter()
const generator = adapter.send(
  [
    {
      role: 'user',
      content: `Utilise impérativement un outil fichier ou terminal pour créer ${proof} avec exactement EXECUTOR_OK, puis réponds exactement EXECUTOR_OK.`
    }
  ],
  {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    execution: { cwd: workspace, sandbox: 'workspace-write' }
  }
)
let result = await generator.next()
while (!result.done) result = await generator.next()
if (!existsSync(proof)) throw new Error(`Preuve absente: ${proof}`)
if (readFileSync(proof, 'utf8').trim() !== 'EXECUTOR_OK')
  throw new Error('Contenu de preuve invalide')
if (!result.value.text.includes('EXECUTOR_OK')) throw new Error('Réponse finale invalide')
const proofContent = readFileSync(proof, 'utf8').trim()
rmSync(proof, { force: true })
console.log(JSON.stringify({ ok: true, proof, proofContent, response: result.value.text.trim() }))
