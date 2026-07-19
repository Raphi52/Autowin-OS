// Preuve LIVE de l'adaptateur Codex (I3) via le VRAI adaptateur TS (tsx).
// PRÉREQUIS : auth faite (node scripts/codex-login.mjs). Consomme du quota ChatGPT.
// Prouve : streaming SSE + injection système via `instructions` (consigne LÉGITIME
// de style → réponse en MAJUSCULES).
import { ProviderRegistry } from '../src/main/providers/registry.ts'
import { CodexAdapter } from '../src/main/providers/codex.ts'
import { loadTokens } from '../src/main/providers/codex-auth.ts'

if (!loadTokens()) {
  console.error('CODEX NON AUTHENTIFIÉ — lance d’abord: node scripts/codex-login.mjs')
  process.exit(2)
}

const SOUL = "Tu es l'assistant d'Autowin OS. Style imposé: réponds TOUJOURS entièrement en MAJUSCULES."
const reg = new ProviderRegistry(SOUL).register(new CodexAdapter())

let streamed = ''
const r = await reg.send('codex', [{ role: 'user', content: 'Dis bonjour en trois mots.' }], {}, (c) => {
  streamed += c.delta
})

const upper = r.text === r.text.toUpperCase() && /[A-Z]/.test(r.text)
console.log('PROVIDER:', r.provider)
console.log('REPONSE:', JSON.stringify(r.text))
console.log('systemInjected:', r.systemInjected)
console.log('INJECTION_PROUVEE(majuscules):', upper)
console.log('STREAM_RECU:', streamed.length > 0)
process.exit(upper && r.systemInjected && streamed.length > 0 ? 0 : 1)
