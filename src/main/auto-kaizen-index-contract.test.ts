import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('branchement runtime Auto-Kaizen', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  it('observe les erreurs structurées du chat et de l’orchestration', () => {
    expect(source).toContain('incidentFromPilotEvent({')
    expect(source).toContain("e.type === 'orchestrate-step'")
    expect(source).toContain("e.type === 'orchestrate-end'")
    expect(source).toContain('reportAutoKaizen({')
  })

  it('transforme la perte du replay et chaque diagnostic exploitable en incident', () => {
    expect(source).toContain('const recap = summarizeJournal(lignes)')
    expect(source).toContain('journal-replay-loss:')
    expect(source).toContain('for (const diagnostic of recap.diagnostics)')
    expect(source).toContain('journal-diagnostic:')
  })

  it('reprend périodiquement les transitions persistées', () => {
    expect(source).toContain("'auto-kaizen-incidents.json'")
    expect(source).toContain('autoKaizenSupervisor.resumePending()')
    expect(source).toContain('autoKaizenResumeTimer.unref()')
  })

  it('hérite strictement de l’autorité de la conversation source', () => {
    expect(source).toContain('authorityMode: inheritAutoKaizenAuthority(source?.authorityMode)')
    expect(source).not.toContain("authorityMode: 'auto',\n          autoKaizen: link")
  })
})
