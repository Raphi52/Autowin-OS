// Panel arena tour 3, tâche P8 — un EXEMPLE de ligne AUTOWIN_PROMPT_V1 cité dans un bloc de code ~~~, ou dans un bloc
// ```` qui contient lui-même ```, est pris pour le vrai prompt suivant (et retiré du texte affiché).
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p8-prompt-dans-un-bloc.mts
import assert from 'node:assert/strict'
import { extrairePromptSuivant, retirerLignePromptSuivant } from '../../src/shared/prompt-suivant'
const x = (t: string) => (extrairePromptSuivant as (t: string) => string | null)(t)
const tilde = 'réponse\n~~~\nAUTOWIN_PROMPT_V1: exemple\n~~~'
const imbrique = 'réponse\n````md\n```\nAUTOWIN_PROMPT_V1: exemple\n````'
assert.equal(x(tilde), null)                                   // bloc ~~~ : un exemple, pas un prompt
assert.equal(retirerLignePromptSuivant(tilde), tilde)          // et le texte affiché garde l'exemple
assert.equal(x(imbrique), null)                                // ``` à l'intérieur d'un ```` ne ferme PAS le bloc
assert.equal(retirerLignePromptSuivant(imbrique), imbrique)
// Existant inchangé
assert.equal(x('a\nAUTOWIN_PROMPT_V1: fais x'), 'fais x')
assert.equal(x('```\nAUTOWIN_PROMPT_V1: ex\n```\nAUTOWIN_PROMPT_V1: vrai'), 'vrai') // après un bloc fermé : le vrai
assert.equal(x('~~~\nAUTOWIN_PROMPT_V1: ex\n~~~\nAUTOWIN_PROMPT_V1: vrai'), 'vrai')
assert.equal(retirerLignePromptSuivant('a\nAUTOWIN_PROMPT_V1: fais x'), 'a')
console.log('P8 OK')
