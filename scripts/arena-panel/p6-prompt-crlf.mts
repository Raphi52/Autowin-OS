// Panel arena tour 2, tâche P6 — retirerLignePromptSuivant laisse « \r\n » en fin de texte quand la réponse est en CRLF.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p6-prompt-crlf.mts
import assert from 'node:assert/strict'
import { retirerLignePromptSuivant as r } from '../../src/shared/prompt-suivant'
assert.equal(r('a\r\nAUTOWIN_PROMPT_V1: fais x\r\n'), 'a')           // CRLF : même rendu que LF
assert.equal(r('a\r\nAUTOWIN_PROMPT_V1: fais x'), 'a')
assert.equal(r('a\nAUTOWIN_PROMPT_V1: fais x'), 'a')                 // existant inchangé
assert.equal(r('a\r\nb'), 'a\r\nb')                                  // sans ligne : texte intact
assert.equal(r('```\nAUTOWIN_PROMPT_V1: x\n```'), '```\nAUTOWIN_PROMPT_V1: x\n```') // dans un bloc de code : intact
console.log('P6 OK')
