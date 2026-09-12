import { describe, expect, it } from 'vitest'
import { createDefaultHookBus, creerPreuveVisuelleHandler } from './default-gate-hooks'

/**
 * LE HOOK DE PREUVE VISUELLE EXISTAIT, MAIS AUCUN APPELANT DE PRODUCTION NE L'ALLUMAIT.
 *
 * Mesure (conv-512, tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`, appel modèle iteration 1) : un run
 * de construction modifie `src/renderer/src/components/ModelActivityLogPane.tsx` et son `.css`, se
 * clôture VERT, et l'agent écrit lui-même « je ne l'ai pas observé à l'écran — aucune capture,
 * aucun verdict visuel de ma part ». `requireVisualProofForFrontDiff` (gates/hooks.ts) aurait
 * refusé ce vert : il n'était passé par AUCUN site hors tests (`grep requireVisualProof src/main`).
 * L'exigence n'existait qu'en prose (pipeline-discipline.ts) — une prose ne refuse rien.
 */
const capture = (ok: boolean) => ({
  type: 'command_execution',
  kind: 'verification' as const,
  status: 'done',
  ok,
  summary: 'capture',
  command: 'node scripts/ui-capture.mjs --view chat --out p.png'
})

describe('preuve visuelle : le hook est branché sur le vrai état du dépôt', () => {
  const handler = creerPreuveVisuelleHandler(() => [
    'src/renderer/src/components/ModelActivityLogPane.tsx',
    'src/renderer/src/components/ModelActivityLogPane.css'
  ])

  it('rendu modifié sans capture lue : la clôture est refusée, les fichiers sont NOMMÉS', async () => {
    const r = await handler({
      event: 'pre-green',
      task: 'build: pistes par source',
      cwd: '/w',
      requireProof: true,
      evidence: []
    })
    expect(r.block).toBe(true)
    expect(r.reason).toContain('ModelActivityLogPane.tsx')
  })

  it('une capture réellement rendue 0 débloque', async () => {
    const r = await handler({
      event: 'pre-green',
      task: 'build',
      cwd: '/w',
      requireProof: true,
      evidence: [capture(true)]
    })
    expect(r.block).toBeFalsy()
  })

  it('une capture en échec ne compte pas', async () => {
    const r = await handler({
      event: 'pre-green',
      task: 'build',
      cwd: '/w',
      requireProof: true,
      evidence: [capture(false)]
    })
    expect(r.block).toBe(true)
  })

  it('tâche non mutante ou dossier inconnu : comportement inchangé', async () => {
    expect((await handler({ event: 'pre-green', task: 'q', cwd: '/w' })).block).toBeFalsy()
    expect((await handler({ event: 'pre-green', task: 'q', requireProof: true })).block).toBeFalsy()
  })

  it('aucun fichier de rendu touché : rien à exiger', async () => {
    const h = creerPreuveVisuelleHandler(() => ['src/main/orchestrator.ts'])
    expect(
      (await h({ event: 'pre-green', task: 'build', cwd: '/w', requireProof: true })).block
    ).toBeFalsy()
  })

  it('le bus par défaut le porte réellement', () => {
    expect(createDefaultHookBus().count('pre-green')).toBeGreaterThanOrEqual(4)
  })
})
