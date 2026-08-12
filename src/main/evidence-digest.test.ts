import { describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from './providers/types'
import {
  EVIDENCE_MAX_ITEMS,
  clampAggregateForJudge,
  clampMiddle,
  evidenceForJudge,
  serializeEvidenceForJudge
} from './evidence-digest'

/**
 * Fixture calquée sur le run réel conv-1102 (vue Worktrees, 11/08) : des `stdout` massifs
 * (fichiers lus en entier), des tableaux d'empreintes SHA-256, et les mêmes chemins absolus
 * répétés dans `path` et `paths`.
 */
const sha = (seed: number): string => seed.toString(16).padStart(64, 'a')

const mutation = (index: number): ExecutionEvidence => ({
  type: 'file_change',
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: `Écriture de WorktreeActivityView.tsx (${index})`,
  path: `/c/Amitel/Autowin OS/.autowin-data/worktrees/agent__run-19747a1e4bd4-1/src/file-${index}.tsx`,
  paths: [`/c/Amitel/Autowin OS/.autowin-data/worktrees/agent__run-19747a1e4bd4-1/src/file-${index}.tsx`],
  diff: Array.from({ length: 400 }, (_, line) => `+  const value${line} = ${line}`).join('\n'),
  writtenLineFingerprints: Array.from({ length: 120 }, (_, i) => sha(index * 1000 + i)),
  pathFingerprints: { [`src/file-${index}.tsx`]: sha(index) },
  pathBaseFingerprints: { [`src/file-${index}.tsx`]: null },
  pathGenerationMarkers: { [`src/file-${index}.tsx`]: `gen-${index}` }
})

const verification: ExecutionEvidence = {
  type: 'command_execution',
  kind: 'verification',
  status: 'completed',
  ok: true,
  summary: 'Suite ciblée verte',
  command: 'npx vitest run src/renderer/src/components/WorktreeActivityView.test.tsx',
  exitCode: 0,
  stdout: `${'stdout de remplissage sans valeur de verdict\n'.repeat(2_000)}Tests  103 passed (103)`
}

describe('evidence-digest', () => {
  it('conserve les deux bords du texte coupé', () => {
    const clamped = clampMiddle('DEBUT' + 'x'.repeat(5_000) + 'FIN', 10, 10)
    expect(clamped.startsWith('DEBUT')).toBe(true)
    expect(clamped.endsWith('FIN')).toBe(true)
    expect(clamped).toContain('caractères omis')
    expect(clamped.length).toBeLessThan(200)
  })

  it('garde ce qui fonde un verdict et jette la charge d’affichage', () => {
    const digest = evidenceForJudge(mutation(1))
    expect(digest.summary).toContain('WorktreeActivityView')
    expect(digest.kind).toBe('mutation')
    expect(digest.ok).toBe(true)
    // Les empreintes et générations n'ont aucun pouvoir de verdict pour un juge LLM.
    const serialized = JSON.stringify(digest)
    expect(serialized).not.toMatch(/[0-9a-f]{64}/)
    expect(serialized).not.toContain('pathGenerationMarkers')
    // Le diff intégral part, son volume reste.
    expect(digest.diffLines).toBe(400)
    expect(serialized).not.toContain('const value399')
  })

  it('préserve le verdict d’une vérification malgré un stdout massif', () => {
    const digest = evidenceForJudge(verification)
    expect(digest.exitCode).toBe(0)
    expect(digest.command).toContain('vitest')
    // La ligne de résultat vit en QUEUE du stdout : la perdre rendrait la preuve inutilisable.
    expect(digest.stdout).toContain('Tests  103 passed (103)')
    expect(digest.stdout!.length).toBeLessThan(2_000)
  })

  it('ne répète pas le même chemin absolu dans path et paths', () => {
    const serialized = JSON.stringify(evidenceForJudge(mutation(2)))
    const occurrences = serialized.split('/src/file-2.tsx').length - 1
    expect(occurrences).toBe(1)
  })

  it('réduit d’au moins 95 % un lot de preuves réaliste', () => {
    const evidence = [...Array.from({ length: 12 }, (_, i) => mutation(i)), verification]
    const avant = JSON.stringify(evidence).length
    const apres = serializeEvidenceForJudge(evidence).length
    expect(avant).toBeGreaterThan(150_000)
    expect(apres / avant).toBeLessThan(0.05)
  })

  it('borne le nombre de preuves en gardant les mutations et vérifications', () => {
    const inspections: ExecutionEvidence[] = Array.from({ length: 200 }, (_, i) => ({
      type: 'file_read',
      kind: 'inspection',
      status: 'completed',
      ok: true,
      summary: `lecture ${i}`
    }))
    const serialized = serializeEvidenceForJudge([...inspections, verification, mutation(9)])
    const parsed = JSON.parse(serialized.split('\n')[0])
    expect(parsed).toHaveLength(EVIDENCE_MAX_ITEMS)
    expect(parsed[0].kind).toBe('mutation')
    expect(parsed.some((item: { kind: string }) => item.kind === 'verification')).toBe(true)
    expect(serialized).toContain('preuves de moindre portée omises')
  })

  it('borne le livrable agrégé en gardant sa substance et ses preuves', () => {
    // Calqué sur conv-101 : 1,54 M de caractères transmis au juge pour 6,36 $ sur un seul appel.
    const livrable = `## Ce qui a changé\nP0-1 corrigé\n${'redite sans valeur\n'.repeat(80_000)}## Preuves\nexit 0, 103 passed`
    expect(livrable.length).toBeGreaterThan(1_000_000)
    const borne = clampAggregateForJudge(livrable)
    expect(borne.length).toBeLessThan(70_000)
    expect(borne).toContain('## Ce qui a changé')
    expect(borne).toContain('P0-1 corrigé')
    expect(borne).toContain('exit 0, 103 passed')
    expect(borne).toContain('caractères omis')
  })

  it('laisse intact un livrable de taille normale', () => {
    const livrable = `## Ce qui a changé\n${'ligne utile\n'.repeat(200)}## Preuves\nexit 0`
    expect(clampAggregateForJudge(livrable)).toBe(livrable)
    expect(clampAggregateForJudge(undefined)).toBe('')
  })

  it('rend un tableau vide lisible', () => {
    expect(serializeEvidenceForJudge(undefined)).toBe('[]')
    expect(serializeEvidenceForJudge([])).toBe('[]')
  })
})
