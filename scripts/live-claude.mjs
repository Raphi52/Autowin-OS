// Preuve LIVE de l'adaptateur Claude (I2) via le VRAI adaptateur TS (tsx).
// Consomme un peu de quota abonnement. Prouve : streaming + injection système
// (le modèle applique une consigne LÉGITIME de style → réponse en MAJUSCULES).
import { ProviderRegistry } from '../src/main/providers/registry.ts'
import { ClaudeCliAdapter } from '../src/main/providers/claude.ts'

const SOUL = "Tu es l'assistant d'Autowin OS. Style imposé: réponds TOUJOURS entièrement en MAJUSCULES."
const reg = new ProviderRegistry(SOUL).register(new ClaudeCliAdapter())

let streamed = ''
const r = await reg.send('claude', [{ role: 'user', content: 'Dis bonjour en trois mots.' }], {}, (c) => {
  streamed += c.delta
})

const upper = r.text === r.text.toUpperCase() && /[A-Z]/.test(r.text)
console.log('PROVIDER:', r.provider)
console.log('REPONSE:', JSON.stringify(r.text))
console.log('SESSION:', r.sessionId)
console.log('systemInjected:', r.systemInjected)
console.log('INJECTION_PROUVEE(majuscules):', upper)
console.log('STREAM_RECU:', streamed.length > 0)
process.exit(upper && r.systemInjected && streamed.length > 0 ? 0 : 1)
