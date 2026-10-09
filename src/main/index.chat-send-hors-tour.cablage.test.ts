import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CÂBLAGE de `chat_send` vers une AUTRE conversation (closure locale de index.ts, que l'exécution ne
 * peut pas atteindre). L'isolement lui-même — un `run` lancé par `runOutsideCurrent` ouvre son propre
 * devis — est prouvé par execution-supervisor.test.ts (« isole un reveil de fond… »).
 *
 * Mesure du 2026-10-05 (/maintenance du 06/10, conv-38) : conv-53 envoie la demande à conv-93,
 * `chat_send` répond `envoye: true`, puis le tour de conv-93 est annulé 5 s plus tard sur « Budget de
 * concurrence atteint (1) » (causal-trace/conv-53.jsonl:378-379, conv-93.jsonl:1). Le tour cible
 * héritait du devis du tour APPELANT, dont l'appel était déjà actif. L'utilisateur a dû renvoyer la
 * demande à la main 34 min plus tard.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const debut = source.indexOf('bus.lancerDansConversation = ')
const bloc = source.slice(debut, source.indexOf('const taskDispatcher', debut))

describe('chat_send vers une autre conversation — câblage hors du tour appelant', () => {
  it('trouve le lanceur dans index.ts', () => {
    expect(debut).toBeGreaterThan(-1)
    expect(bloc).toContain('scheduledChatRuntime.runPrompt(')
  })

  it('lance le tour cible HORS du devis du tour appelant (runOutsideCurrent)', () => {
    expect(bloc).toMatch(
      /executionSupervisor\.runOutsideCurrent\(\s*\(\)\s*=>\s*scheduledChatRuntime\.runPrompt\(/
    )
  })
})
