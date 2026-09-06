import { existsSync, readFileSync } from 'node:fs'
import { cheminDevToolsPort } from './racine-depot.mjs'

/**
 * Le port de debogage de l'instance a piloter.
 *
 * Vingt-cinq sondes ecrivaient `9223` en dur, parfois jusque dans l'URL
 * (`fetch('http://127.0.0.1:9223/json')`). Or l'application choisit son port au demarrage et
 * l'ECRIT dans `.autowin-data/autowin-os/DevToolsActivePort` : le 2026-09-06, elle tournait sur
 * 9225 et AUCUNE de ces sondes ne pouvait l'atteindre. Une sonde qui ne joint pas l'app rend un
 * echec qui ressemble a un defaut du produit.
 *
 * Ordre de resolution, du plus explicite au plus devine :
 *   1. `--port 1234` passe en argument (l'appelant sait ce qu'il vise)
 *   2. `AUTOWIN_CDP_PORT`
 *   3. le `DevToolsActivePort` REEL du depot courant
 *   4. `9223`, l'ancien defaut, pour ne casser aucun appel existant
 */
export const PORT_PAR_DEFAUT = 9223

export function portCdp(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--port')
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1])
  if (env.AUTOWIN_CDP_PORT) return Number(env.AUTOWIN_CDP_PORT)
  const fichier = cheminDevToolsPort()
  if (existsSync(fichier)) {
    const premiereLigne = readFileSync(fichier, 'utf8').split('\n')[0].trim()
    if (/^\d+$/.test(premiereLigne)) return Number(premiereLigne)
  }
  return PORT_PAR_DEFAUT
}

/** L'URL du catalogue de cibles CDP pour ce port. */
export function urlCiblesCdp(port = portCdp()) {
  return `http://127.0.0.1:${port}/json`
}
