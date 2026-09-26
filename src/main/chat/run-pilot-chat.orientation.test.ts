import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * conv-844 (2026-09-24) : `orientationsDuTourPrecedent` (7459e8cd) lit le drapeau `orientation`
 * dans l'historique, mais le renderer n'envoie que { role, content, attachments } : le drapeau
 * n'arrivait jamais au pilote. `run-pilot-chat.ts` le relit dans le store. Contrat de SOURCE
 * (meme idiome que run-pilot-chat.diagnostic-echec.test.ts) : ne prouve pas le chemin de bout en bout.
 */
describe('le drapeau orientation atteint le pilote (conv-844)', () => {
  const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
  it('les consignes sont relues dans le store', () => {
    expect(source).toMatch(/stocke\.orientation/)
  })
  it("l'historique remis au pilote porte le drapeau", () => {
    expect(source).toMatch(/orientations\.has\(m\.content\) \? \{ orientation: true \}/)
  })
})
