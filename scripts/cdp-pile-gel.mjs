/**
 * LIRE LA PILE D'APPELS D'UNE FENETRE GELEE (developpement).
 *
 * Constat du 2026-09-08 : le gel de la vue Knowledge est TOTAL et PERMANENT — une evaluation
 * triviale ne repond plus jamais. Ce n'est donc pas du travail lent (qui finirait), c'est une
 * BOUCLE qui ne rend jamais le fil. Chronometrer ne dit rien d'une boucle infinie ; il faut
 * l'INTERROMPRE et lire OU elle tourne.
 *
 * Le debogueur V8 sait interrompre du JS deja en cours (Debugger.pause leve une interruption
 * traitee entre deux instructions, meme dans une boucle bloquante) et rend alors les cadres
 * d'appel. C'est la seule facon de NOMMER la cause sans continuer a debrancher au jugé.
 *
 * Usage : node scripts/cdp-pile-gel.mjs <idNoeud> [secondesAvantInterruption]
 */
import { readFileSync } from 'node:fs'
import { WebSocket } from 'ws'

const port = readFileSync('.autowin-data/autowin-os/DevToolsActivePort', 'utf8').split('\n')[0].trim()
const noeud = process.argv[2] ?? 'AGENTS'
const attenteS = Number(process.argv[3] ?? 6)

const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = liste.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) throw new Error('aucune page sur le port ' + port)

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const attentes = new Map()
const scripts = new Map()
let pause = null
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.method === 'Debugger.scriptParsed') scripts.set(m.params.scriptId, m.params.url)
  if (m.method === 'Debugger.paused' && !pause) pause = m.params
  const at = attentes.get(m.id)
  if (at) {
    attentes.delete(m.id)
    m.error ? at.rej(new Error(JSON.stringify(m.error))) : at.res(m.result)
  }
})
const envoyer = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id
    attentes.set(n, { res, rej })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
await new Promise((res, rej) => {
  ws.on('open', res)
  ws.on('error', rej)
})

const evaluer = async (expression, timeoutMs = 4000) => {
  const p = envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res('MUET'), timeoutMs))])
  if (r === 'MUET') return 'MUET'
  return r.result?.value
}

await envoyer('Debugger.enable', { maxScriptsCacheSize: 10_000_000 })
const vivant = await evaluer('Date.now()')
console.log('fenetre avant:', vivant === 'MUET' ? 'MUETTE' : 'vivante')
const nb = await evaluer('window.__autowinSondeGraphe ? window.__autowinSondeGraphe.noeuds().length : -1')
console.log('noeuds rendus:', nb)
if (typeof nb !== 'number' || nb < 1) {
  console.log('graphe non charge — rien a provoquer')
  process.exit(1)
}

console.log(`declenchement: ouvrir(${noeud})`)
envoyer('Runtime.evaluate', { expression: `window.__autowinSondeGraphe.ouvrir(${JSON.stringify(noeud)})` }).catch(() => {})
await new Promise((r) => setTimeout(r, attenteS * 1000))

const apres = await evaluer('Date.now()', 3000)
console.log('fenetre apres', attenteS + 's :', apres === 'MUET' ? 'MUETTE (gel)' : 'vivante (' + apres + ')')
if (apres !== 'MUET') {
  console.log('pas de gel — rien a interrompre')
  process.exit(0)
}

console.log('interruption du fil bloque…')
envoyer('Debugger.pause').catch((e) => console.log('pause refusee:', e.message))
const t0 = Date.now()
while (!pause && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 200))
if (!pause) {
  console.log('AUCUNE INTERRUPTION OBTENUE en 30 s — le fil ne traite meme plus les interruptions V8')
  process.exit(2)
}
console.log('INTERROMPU. raison:', pause.reason)
for (const [i, c] of (pause.callFrames ?? []).slice(0, 25).entries()) {
  const url = scripts.get(c.location.scriptId) ?? '?'
  console.log(
    `#${i} ${c.functionName || '(anonyme)'}  ${url.replace(/^.*\/(src|node_modules)\//, '$1/')}:${c.location.lineNumber + 1}`
  )
}
process.exit(0)
