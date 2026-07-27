import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createConvRun,
  closeConvRun,
  listConvRuns,
  saveConvRunTrace,
  loadConvRunTrace
} from './conv-runs'
import type { OrchestrationStep } from '../orchestrator'

const root = mkdtempSync(join(tmpdir(), 'aos-convruns-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('conv-runs — RUN.md par conversation (format autowin)', () => {
  it('createConvRun écrit un RUN open parseable, rattaché à la conversation', () => {
    const p = createConvRun('conv-9', 'Vérifier les écarts de facturation', root, () => 1000)
    const md = readFileSync(p, 'utf8')
    expect(md).toMatch(/^status: open/m)
    expect(md).toMatch(/^session: conv-9/m)
    expect(md).toContain('Vérifier les écarts de facturation')
    const runs = listConvRuns('conv-9', [], root)
    expect(runs).toHaveLength(1)
    expect(runs[0].summary.status).toBe('open')
    expect(runs[0].summary.dodTotal).toBe(1)
  })

  it('closeConvRun green coche le DoD + statut green ; red laisse le DoD ouvert', () => {
    const g = createConvRun('conv-9', 'tâche verte', root, () => 2000)
    closeConvRun(g, true, 'Juge: validé.')
    const green = listConvRuns('conv-9', [], root).find((r) => r.path === g)!
    expect(green.summary.status).toBe('green')
    expect(green.summary.dodChecked).toBe(1)

    const r = createConvRun('conv-9', 'tâche rouge', root, () => 3000)
    closeConvRun(r, false, 'Gate BLOQUÉ: défaut.')
    const red = listConvRuns('conv-9', [], root).find((x) => x.path === r)!
    expect(red.summary.status).toBe('red')
    expect(readFileSync(r, 'utf8')).toContain('Gate BLOQUÉ')
  })

  it('réutilise le même RUN quand la même tâche est relancée', () => {
    const a = createConvRun('conv-9', 'même tâche', root, () => 4000)
    closeConvRun(a, true, 'Premier verdict.')
    const b = createConvRun('conv-9', 'même tâche', root, () => 5000)
    expect(a).toBe(b)
    expect(listConvRuns('conv-9', [], root).filter((r) => r.path === a)).toHaveLength(1)
    expect(readFileSync(b, 'utf8')).toMatch(/^status: open/m)
    expect(readFileSync(b, 'utf8')).toContain('Orchestration relancée')
  })

  it('réouvre un RUN rouge sans créer de doublon lors de la relance', () => {
    const a = createConvRun('conv-relance', 'tâche interrompue', root, () => 8000)
    closeConvRun(a, false, 'Orchestration en échec.')

    const b = createConvRun('conv-relance', 'tâche interrompue', root, () => 9000)

    expect(b).toBe(a)
    expect(listConvRuns('conv-relance', [], root)).toHaveLength(1)
    expect(readFileSync(b, 'utf8')).toMatch(/^status: open/m)
  })

  it('saveConvRunTrace/loadConvRunTrace : le fil des sous-agents est persisté et relu', () => {
    const p = createConvRun('conv-T', 'tâche avec trace', root, () => 7000)
    const steps: OrchestrationStep[] = [
      { step: 'exec', provider: 'claude', role: 'subagent', text: 'sortie du sous-agent' },
      { step: 'judge', provider: 'codex', role: 'judge', text: 'VALIDE', detail: 'validé' },
      { step: 'gate', detail: 'clôture autorisée' }
    ]
    saveConvRunTrace(p, steps)
    const back = loadConvRunTrace(p)
    expect(back).not.toBeNull()
    expect(back!).toHaveLength(3)
    expect(back![0]).toMatchObject({ step: 'exec', text: 'sortie du sous-agent' })
    expect(back![1].detail).toBe('validé')
    // run sans trace → null
    const noTrace = createConvRun('conv-T', 'sans trace', root, () => 7500)
    expect(loadConvRunTrace(noTrace)).toBeNull()
  })

  it('scope strict par conversation + fusion des runs attachés', () => {
    createConvRun('conv-A', 'tâche de A', root, () => 6000)
    // un RUN.md « Claude Code » externe attaché à B
    const extDir = join(root, '..', 'ext-session', 'sujet-externe-workspace')
    mkdirSync(extDir, { recursive: true })
    const ext = join(extDir, 'RUN.md')
    writeFileSync(ext, 'status: green\n\n## Besoin\nexterne\n', 'utf8')

    const a = listConvRuns('conv-A', [], root)
    expect(a.every((r) => r.session === 'conv-A')).toBe(true)
    const b = listConvRuns('conv-B', [ext], root)
    expect(b).toHaveLength(1)
    expect(b[0].session).toBe('attaché')
    expect(b[0].summary.status).toBe('green')
    // chemin attaché disparu → ignoré sans crash
    expect(listConvRuns('conv-B', [join(root, 'nexiste', 'RUN.md')], root)).toHaveLength(0)
  })
})
