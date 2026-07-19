// Auth Codex LIVE (device-code) — À LANCER PAR L'UTILISATEUR : la saisie du code
// dans le navigateur est une action humaine (on ne tape jamais tes identifiants).
// Usage : node scripts/codex-login.mjs
import { startDeviceLogin, pollForToken, saveTokens, VERIFY_URL, defaultAuthPath } from '../src/main/providers/codex-auth.ts'

console.log('→ Demande d’un code d’appareil à OpenAI…')
const login = await startDeviceLogin()

console.log('\n═══════════════════════════════════════════')
console.log('  1. Ouvre :', VERIFY_URL)
console.log('  2. Saisis le code :', login.userCode)
console.log('═══════════════════════════════════════════\n')
console.log('En attente de la validation dans le navigateur…')

const tokens = await pollForToken(login)
saveTokens(tokens)
console.log('\n✓ Authentifié. Tokens enregistrés dans', defaultAuthPath())
console.log('  (store PROPRE à Autowin OS — jamais celui d’Hermes)')
