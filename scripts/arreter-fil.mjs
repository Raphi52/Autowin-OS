#!/usr/bin/env node
/**
 * Arrête le tour en cours d'un fil, exactement comme son bouton Stop : `window.api.cancelPilotChat`
 * (le tour du chat ET le run de développement rattaché), ou seulement le run avec `--run-seul`
 * (`window.api.cancelOrchestration`).
 *
 * Pourquoi (conv-1625, 05/11/2026) : conv-1613 rejouait sans fin la même réparation refusée,
 * à environ 3,30 $ toutes les 35 secondes. Un agent d'un autre fil n'avait AUCUN moyen de l'arrêter :
 * l'arrêt n'existe que derrière les canaux `os:pilotChat:cancel` / `os:orchestrate:cancel`, réservés
 * à l'interface. Ce script passe par le port de débogage de l'app (le même que les scripts cdp-*)
 * et appelle la fonction que l'interface appelle : aucun chemin d'arrêt parallèle à maintenir.
 *
 * Usage : node scripts/arreter-fil.mjs conv-1613 [--run-seul]
 * Sortie : une ligne JSON { fil, action, ok, page } ; code 0 si l'app dit avoir coupé quelque chose,
 * 2 si rien n'était en cours, 1 en cas d'erreur.
 */
import { portCdp } from './cdp-port.mjs'

const fil = process.argv.slice(2).find((a) => !a.startsWith('--'))
const runSeul = process.argv.includes('--run-seul')
if (!fil || !/^conv-\d+$/.test(fil)) {
  console.error('Usage : node scripts/arreter-fil.mjs conv-NNN [--run-seul]')
  process.exit(1)
}
const action = runSeul ? 'cancelOrchestration' : 'cancelPilotChat'

/** Fenêtre principale : une page de l'app qui expose le pont `api`, pas un aperçu ni la mascotte. */
async function evaluer(ws, expression) {
  return await new Promise((resoudre, rejeter) => {
    const id = Math.floor(Math.random() * 1e9)
    const delai = setTimeout(() => rejeter(new Error('pas de réponse de la page en 10 s')), 10_000)
    ws.addEventListener('message', function ecoute(ev) {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== id) return
      clearTimeout(delai)
      ws.removeEventListener('message', ecoute)
      if (msg.error || msg.result?.exceptionDetails) {
        rejeter(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails)))
      } else resoudre(msg.result?.result?.value)
    })
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    )
  })
}

async function ouvrir(url) {
  const ws = new WebSocket(url)
  await new Promise((ok, ko) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', () => ko(new Error(`connexion impossible : ${url}`)), { once: true })
  })
  return ws
}

try {
  const port = portCdp()
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  // La fenêtre principale se charge sur `/` (dev, serveur 5173) ou `index.html` (app empaquetée) ;
  // un aperçu (`apercu-*.html`) ou la mascotte exposent aussi parfois `api` : on les écarte.
  const candidates = pages.filter((p) => {
    if (p.type !== 'page' || !p.webSocketDebuggerUrl) return false
    try {
      const chemin = new URL(p.url).pathname
      return chemin === '/' || chemin.endsWith('/index.html')
    } catch {
      return false
    }
  })
  let resultat
  for (const page of candidates) {
    const ws = await ouvrir(page.webSocketDebuggerUrl)
    try {
      const present = await evaluer(ws, `typeof window.api?.${action} === 'function'`)
      if (!present) continue
      const reponse = await evaluer(ws, `window.api.${action}(${JSON.stringify(fil)})`)
      resultat = { fil, action, ok: Boolean(reponse?.ok), page: page.url }
      break
    } finally {
      ws.close()
    }
  }
  if (!resultat) throw new Error(`aucune fenêtre principale d'Autowin trouvée sur le port ${port}`)
  console.log(JSON.stringify(resultat))
  process.exit(resultat.ok ? 0 : 2)
} catch (erreur) {
  console.error(JSON.stringify({ fil, action, erreur: String(erreur?.message ?? erreur) }))
  process.exit(1)
}
