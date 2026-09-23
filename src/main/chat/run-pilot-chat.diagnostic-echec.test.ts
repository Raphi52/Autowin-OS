import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeChatTurnFailure } from '../provider-failure-diagnosis'

/**
 * UN TOUR DE CHAT QUI ÉCHOUE DOIT CONSEILLER UN GESTE, pas seulement citer l'incident.
 *
 * Mesuré conv-5, promptCall du tour `d98b3e44-bc1c-4d37-8495-d64f4bea225a` (2026-09-23T09:41:45Z) :
 * le tour a échoué sur « Claude a interrompu l'appel : The model's tool call could not be parsed
 * (retry also failed) », 0,0956 USD payés, message assistant VIDE — et l'écran n'affichait que
 * l'erreur brute. `provider-failure-diagnosis.ts` savait pourtant classer cette panne
 * (`malformed-tool-call`, ajouté après conv-737) et conseiller le geste ; il n'était appelé que par
 * l'orchestrateur et le watchdog, jamais par le chemin du chat direct (`run-pilot-chat.ts`).
 */
const REEL_CONV5 =
  "Claude a interrompu l'appel : The model's tool call could not be parsed (retry also failed)."

describe('échec du tour de chat direct (conv-5, tour d98b3e44-bc1c-4d37-8495-d64f4bea225a)', () => {
  it("garde le message d'origine INTACT en tête et ajoute le geste de réparation", () => {
    const rendu = describeChatTurnFailure({ provider: 'claude', message: REEL_CONV5 })
    // Inclusion stricte du message brut : la reprise surcharge (`estSurchargeFournisseur`) et la
    // détection de session expirée lisent l'erreur par inclusion — le préfixe ne doit pas bouger.
    expect(rendu.startsWith(REEL_CONV5)).toBe(true)
    expect(rendu).toMatch(/→ .*illisible/)
  })

  it('rend le message inchangé quand aucun geste honnête n’existe (kind other)', () => {
    const brut = 'défaillance inconnue du fournisseur'
    expect(describeChatTurnFailure({ provider: 'claude', message: brut })).toBe(brut)
  })

  it('le chemin du chat direct appelle bien le diagnostic (contrat de source)', () => {
    // Même idiome que `chat-ipc-contract.test.ts` : la source du tour de chat doit passer par
    // `describeChatTurnFailure` dans son retour d'échec, sinon on retombe sur l'erreur brute.
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    expect(source).toContain('describeChatTurnFailure({')
    expect(source).not.toMatch(/error:\s*e instanceof Error \? e\.message : String\(e\)/)
  })
})
