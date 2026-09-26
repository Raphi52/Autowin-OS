import { describe, expect, it } from 'vitest'
import { etatDeCloture } from './root-execution-contract'

/*
 * Meme defaut que `cibles-dossier`, mais au SITE D'APPEL reel du gate (`orchestrator.ts:4770`) :
 * conv-470, tour 52fbe05f-0086-4806-8f07-c8762e8caa35, saisie ts=1789192601300
 * (« /kaizen j'ai rien en preprompt »). La demande ne nomme aucun fichier ; le dossier de preuve
 * joint recopie « Ancrage : src/main/model-quotas.ts:62 » d'un message anterieur. Le gate a ferme
 * ROUGE trois fois de suite sur « Cible nommee ... src/main/model-quotas.ts » alors que le travail
 * etait juste. Tester `ciblesNommees` seule ne garantit pas la cloture : c'est ici que ca bloque.
 */
describe('etatDeCloture ignore les ancrages du dossier de preuve joint', () => {
  const task = [
    "/kaizen j'ai rien en preprompt",
    '',
    '=== DOSSIER DE PREUVE AUTOWIN OS ===',
    '{"messages":[{"content":"Ancrage : src/main/model-quotas.ts:62 (2026-09-11)"}]}',
    '=== FIN DU DOSSIER ==='
  ].join('\n')

  const phases = [
    {
      phase: 'build',
      text: 'correction appliquee',
      executionEvidence: [
        { kind: 'mutation', ok: true, paths: ['src/main/chat-auto-mode.ts'] } as never
      ]
    }
  ]

  it('ferme VERT quand le travail mute un autre fichier que l ancrage recopie', () => {
    const cloture = etatDeCloture(task, phases, true, true)
    expect(cloture.dod.filter((c) => /Cible nommee/i.test(c.label))).toEqual([])
    expect(cloture.status).toBe('green')
  })
})
