import { describe, it, expect } from 'vitest'
import { structuredEvidenceFields } from './codex'

describe('structuredEvidenceFields', () => {
  it('command_execution → command + exitCode + stdout (sortie brute conservée)', () => {
    const f = structuredEvidenceFields({
      type: 'command_execution',
      command: 'npx vitest run',
      exit_code: 0,
      aggregated_output: 'Tests 12 passed\n'
    })
    expect(f.command).toBe('npx vitest run')
    expect(f.exitCode).toBe(0)
    expect(f.stdout).toBe('Tests 12 passed\n')
    expect(f.diff).toBeUndefined()
  })

  it('exit_code non nul est préservé (échec visible)', () => {
    const f = structuredEvidenceFields({ type: 'command_execution', command: 'npm run build', exit_code: 2 })
    expect(f.exitCode).toBe(2)
  })

  it('file_change → diff + path (objet stringifié, clés = chemins)', () => {
    const f = structuredEvidenceFields({
      type: 'file_change',
      changes: { 'src/a.ts': { added: 3 }, 'src/b.ts': { removed: 1 } }
    })
    expect(f.path).toBe('src/a.ts, src/b.ts')
    expect(f.diff).toContain('src/a.ts')
    expect(f.command).toBeUndefined()
  })

  it('file_change avec diff déjà en string → conservé tel quel', () => {
    const f = structuredEvidenceFields({ type: 'file_change', changes: '+ ligne ajoutée\n- ligne retirée' })
    expect(f.diff).toBe('+ ligne ajoutée\n- ligne retirée')
  })

  it('stdout borné à 20k (pas de payload géant)', () => {
    const big = 'x'.repeat(50_000)
    const f = structuredEvidenceFields({ type: 'command_execution', aggregated_output: big })
    expect(f.stdout?.length).toBe(20_000)
  })

  it('type inconnu → aucun champ structuré (rétrocompat)', () => {
    expect(structuredEvidenceFields({ type: 'reasoning' })).toEqual({})
  })
})
