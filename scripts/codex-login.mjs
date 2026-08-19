// Auth Codex LIVE (device-code) — À LANCER PAR L'UTILISATEUR : la saisie du code
// dans le navigateur est une action humaine (on ne tape jamais tes identifiants).
// Usage : npm run codex:login
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startDeviceLogin,
  pollForToken,
  saveTokens,
  VERIFY_URL,
  defaultAuthPath
} from '../src/main/providers/codex-auth.ts'
import { configureAutowinAppDataBase, portableAppDataBase } from '../src/main/app-data.ts'

// MEME STORE QUE L'APP, sinon le login reussit dans le vide.
//
// Mesure du 2026-08-19 : ce script a ecrit des jetons frais dans `%APPDATA%utowin-osuth.json`
// pendant que l'app lisait `<depot>\.autowin-datautowin-osuth.json`, inchange depuis une
// semaine. Il affichait « Authentifie », l'app repondait `401 token_expired`, et rien ne reliait les
// deux. Cause : `appDataBase()` retombe sur `%APPDATA%` quand personne n'a configure la base ; en
// production c'est `index.ts` qui le fait avec la base PORTABLE (decision du 2026-08-07, l'app ecrit
// dans SON dossier). Ce script tourne sous `tsx`, hors Electron : il n'heritait de rien.
const racineDepot = join(dirname(fileURLToPath(import.meta.url)), '..')
configureAutowinAppDataBase(portableAppDataBase(racineDepot, racineDepot, false))

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
