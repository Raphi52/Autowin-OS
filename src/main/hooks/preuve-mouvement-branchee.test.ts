import { describe, expect, it } from 'vitest'
import { creerPreuveMouvementHandler } from './default-gate-hooks'

/**
 * MEME DEFAUT, MEME CAUSE, AUTRE HOOK : `requireMotionProof` n'etait passe par aucun appelant de
 * production (`grep -rn requireMotionProof src/main` => sa seule definition). Il ne pouvait donc
 * refuser aucun vert. Le premier correctif de cette passe a branche la preuve VISUELLE ; celui-ci
 * branche la preuve de MOUVEMENT, qu'une capture fixe ne donne jamais.
 */
const DIFF_ANIME = [
  '+++ b/src/renderer/src/components/HomeView.css',
  '+.jarvis__bascule { animation: jarvis-pulse 1.2s infinite; }'
].join('\n')

const preuve = (cmd: string, ok = true) => ({
  type: 'command_execution',
  kind: 'verification' as const,
  status: 'done',
  ok,
  summary: 'capture',
  command: cmd
})

describe('preuve de mouvement : le hook est branché sur le vrai diff', () => {
  const handler = creerPreuveMouvementHandler(() => DIFF_ANIME)

  it('animation ajoutée sans mesure de mouvement : clôture refusée', async () => {
    const r = await handler({ event: 'pre-green', task: 'build', cwd: '/w', requireProof: true })
    expect(r.block).toBe(true)
    expect(r.reason).toContain('HomeView.css')
  })

  it('une capture FIXE ne suffit pas', async () => {
    const r = await handler({
      event: 'pre-green',
      task: 'build',
      cwd: '/w',
      requireProof: true,
      evidence: [preuve('node scripts/ui-capture.mjs --view chat --out p.png')]
    })
    expect(r.block).toBe(true)
  })

  it('une mesure --motion rendue ok débloque', async () => {
    const r = await handler({
      event: 'pre-green',
      task: 'build',
      cwd: '/w',
      requireProof: true,
      evidence: [preuve('node scripts/ui-capture.mjs --view chat --motion .jarvis --out p.png')]
    })
    expect(r.block).toBeFalsy()
  })

  it('tâche non mutante, dossier inconnu ou diff sans animation : inchangé', async () => {
    expect((await handler({ event: 'pre-green', task: 'q', cwd: '/w' })).block).toBeFalsy()
    const h = creerPreuveMouvementHandler(() => '+++ b/src/main/orchestrator.ts\n+const a = 1')
    expect(
      (await h({ event: 'pre-green', task: 'build', cwd: '/w', requireProof: true })).block
    ).toBeFalsy()
  })
})
