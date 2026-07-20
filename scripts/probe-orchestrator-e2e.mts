import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AuthoritySas } from '../src/main/authority/sas'
import { CostAggregator } from '../src/main/dashboards/cost'
import { Orchestrator } from '../src/main/orchestrator'
import { CodexAdapter } from '../src/main/providers/codex'
import { ProviderRegistry } from '../src/main/providers/registry'
import { RoleModelConfig } from '../src/main/roles'
import { TrustLedger } from '../src/main/trust/ledger'

const workspace = resolve(process.cwd())
const proof = join(
  workspace,
  'Audit',
  'workspaces',
  '019f79e9-caf2-7531-92f5-73caaa98a327',
  'orchestration-tool-executor-workspace',
  `orchestrator-e2e-proof-${randomUUID()}.txt`
)
rmSync(proof, { force: true })
const registry = new ProviderRegistry().register(new CodexAdapter())
const roles = new RoleModelConfig({
  subagent: { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' },
  judge: { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' }
})
const orchestrator = new Orchestrator({
  registry,
  roles,
  cost: new CostAggregator(),
  trust: new TrustLedger(),
  authority: new AuthoritySas(),
  executionWorkspace: workspace
})
const result = await orchestrator.run(
  `Crée avec un outil le fichier ${proof} contenant exactement ORCHESTRATOR_E2E_OK. Ensuite exécute impérativement une commande node -e qui lit ce fichier, compare exactement son contenu et termine avec exit code 0 seulement s'il est correct. Rapporte précisément ce chemin et ce contenu comme preuve.`
)
if (!existsSync(proof)) throw new Error(`Preuve E2E absente: ${proof}`)
const proofContent = readFileSync(proof, 'utf8').trim()
if (proofContent !== 'ORCHESTRATOR_E2E_OK') throw new Error('Preuve E2E invalide')
if (!result.valid || result.gateBlocked) throw new Error(`Gate E2E rouge: ${result.gateReasons.join('; ')}`)
const execTransport = result.trace.find((step) => step.step === 'exec')?.prompt?.transport
const judgeTransport = result.trace.find((step) => step.step === 'judge')?.prompt?.transport
const evidence = result.trace.find((step) => step.step === 'exec')?.evidence ?? []
if (!execTransport?.includes('danger-full-access')) throw new Error('Transport exécuteur non prouvé')
if (!judgeTransport?.includes('read-only')) throw new Error('Transport juge read-only non prouvé')
if (!evidence.some((item) => item.kind === 'mutation' && item.ok))
  throw new Error('Preuve de mutation réussie absente')
if (!evidence.some((item) => item.kind === 'verification' && item.ok))
  throw new Error('Preuve de vérification réussie absente')
rmSync(proof, { force: true })
console.log(
  JSON.stringify({
    ok: true,
    proof,
    proofContent,
    execTransport,
    judgeTransport,
    evidence: evidence.map(({ kind, ok, status }) => ({ kind, ok, status })),
    verdict: result.trace.find((step) => step.step === 'judge')?.text
  })
)
