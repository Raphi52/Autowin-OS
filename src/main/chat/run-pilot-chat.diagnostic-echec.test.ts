import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeChatTurnFailure } from '../provider-failure-diagnosis'

/**
 * fix-ok: run-pilot-chat.ts rendait l'erreur brute (`e.message`) sans appeler
 * provider-failure-diagnosis — mesuré conv-5, tour d98b3e44-bc1c-4d37-8495-d64f4bea225a.
 * Entrée qui fait échouer ce test si le correctif est faux : le message réel REEL_CONV5
 * ci-dessous, rendu sans geste `→` par la version 9291acd1^ (rouge vérifié le 2026-09-23).
 *
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

  it('le bloc d’erreur du chat préserve les sauts de ligne du geste (contrat CSS)', () => {
    // Le geste est ajouté sur SA ligne (`\n→ …`) ; sans `white-space: pre-line`, le rendu HTML
    // l'aplatit en espace et le conseil se noie dans l'incident. Même sort pour les messages de
    // fan-out (`describeFanoutFailure`), multi-lignes à dessein.
    const css = readFileSync(
      join(__dirname, '..', '..', 'renderer', 'src', 'components', 'ChatView.css'),
      'utf8'
    )
    const bloc = /\.msg-error-message\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(bloc).toContain('white-space: pre-line')
  })

  it('le chemin du chat direct appelle bien le diagnostic (contrat de source)', () => {
    // Même idiome que `chat-ipc-contract.test.ts` : la source du tour de chat doit passer par
    // `describeChatTurnFailure` dans son retour d'échec, sinon on retombe sur l'erreur brute.
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    expect(source).toContain('describeChatTurnFailure({')
    expect(source).not.toMatch(/error:\s*e instanceof Error \? e\.message : String\(e\)/)
  })
})
