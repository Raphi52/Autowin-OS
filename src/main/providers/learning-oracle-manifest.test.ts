import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTrustedLearningOracles } from './learning-oracle-manifest'

describe('manifest des oracles d’apprentissage', () => {
  it('charge une couverture explicitement déclarée par le projet', () => {
    const root = mkdtempSync(join(tmpdir(), 'learning-oracle-'))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'verify.ps1'), 'exit 0')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        autowin: {
          learningOracles: [{ command: 'npm test', covers: ['src/**'], attests: ['verify.ps1'] }]
        }
      })
    )

    expect(loadTrustedLearningOracles(root)).toEqual([
      expect.objectContaining({
        command: 'npm test',
        covers: ['src/**'],
        attestedFiles: ['verify.ps1'],
        attestation: expect.any(String)
      })
    ])
  })

  it('refuse les couvertures qui sortent du workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'learning-oracle-'))
    writeFileSync(join(root, 'verify.ps1'), 'exit 0')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        autowin: {
          learningOracles: [{ command: 'npm test', covers: ['../secret'], attests: ['verify.ps1'] }]
        }
      })
    )
    expect(loadTrustedLearningOracles(root)).toEqual([])
  })

  it('déclare un oracle réel pour le chantier outcome-learning d’Autowin', () => {
    expect(loadTrustedLearningOracles(process.cwd())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command:
            'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-brain-outcome-writeback.ps1',
          covers: expect.arrayContaining(['src/main/outcome-learning-policy.ts']),
          attestedFiles: expect.arrayContaining(['scripts/verify-brain-outcome-writeback.ps1'])
        })
      ])
    )
  })
})
