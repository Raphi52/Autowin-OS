import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * UN SEUL message « Reprise du fil » PAR CHANTIER (conv-913, 2026-10-13).
 *
 * Le câblage vit dans `index.ts`, qu'on ne peut pas démarrer sous test (Electron) : on épingle le
 * site d'appel réel. Le comportement est prouvé par `conversations.reprise-du-chantier.test.ts`
 * (un message par chantier, survit au disque) et `journal-replay.test.ts` (fusion sans perte).
 */
const source = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')

describe('index.ts — le récapitulatif de reprise met à jour le message du chantier', () => {
  const i = source.indexOf('const message = recapMessage(recap, produitEncore)')
  const site = source.slice(i, i + 900)

  it('le site d’appel existe', () => {
    expect(i).toBeGreaterThan(0)
  })

  it('passe par le message DU CHANTIER, fusionné, au lieu d’ajouter une bulle', () => {
    expect(site).toContain(
      'os.conversations.noterRepriseDuChantier(conversationId, resumableRun.runId'
    )
    expect(site).toContain('fusionnerRepriseDuFil(precedent, message, heure)')
    expect(site).not.toContain(
      "os.conversations.append(conversationId, { role: 'assistant', content: message })"
    )
  })
})
