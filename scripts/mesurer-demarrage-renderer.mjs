/**
 * Où passent les ~26,5 secondes entre la construction de la fenêtre et le premier rendu.
 *
 * Ce script ne suppose rien : il lit la chronologie que le renderer a lui-même enregistrée
 * (`performance.getEntriesByType('resource')`), qui donne un enregistrement par module servi par le
 * serveur de développement. C'est la mesure décisive, parce qu'en développement le coût dominant
 * n'est pas l'exécution du code mais la TRANSFORMATION de chaque module par Vite à sa première
 * requête — et cette transformation est exactement ce que `duration` capture.
 *
 * Attention à ce que ce chiffre est et n'est pas : les modules sont demandés en PARALLÈLE, donc la
 * somme des durées dépasse largement le temps écoulé. Un total ne prouve donc rien tout seul ; ce
 * qui départage, c'est la PART d'un sous-arbre (`three`, `react-force-graph`) dans ce total, et le
 * dernier module à finir, qui borne le premier rendu.
 *
 * Usage : node scripts/mesurer-demarrage-renderer.mjs [--port 9223] [--json-out <chemin>]
 */

import { writeFileSync } from 'node:fs'

const value = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = Number(value('--port', '9223'))
const jsonOut = value('--json-out', '')

const attendrePage = async () => {
  const limite = Date.now() + 180_000
  while (Date.now() < limite) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Le port n'écoute pas encore : c'est l'état normal pendant le démarrage qu'on mesure.
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`aucune page CDP sur ${port} après 180 s`)
}

const page = await attendrePage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let id = 0
const envoyer = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mien = ++id
    const ecoute = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== mien) return
      socket.removeEventListener('message', ecoute)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
    socket.addEventListener('message', ecoute)
    socket.send(JSON.stringify({ id: mien, method, params }))
  })

const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

// On attend que l'interface soit RÉELLEMENT peinte : sans cela on mesurerait une chronologie
// partielle et on sous-estimerait précisément ce qu'on cherche.
const limite = Date.now() + 180_000
let peint = false
while (Date.now() < limite) {
  peint = await evaluer(`!!document.querySelector('[data-testid="app-shell"], .app-shell, main')`)
  if (peint) break
  await new Promise((r) => setTimeout(r, 500))
}

const mesure = await evaluer(`(() => {
  const res = performance.getEntriesByType('resource')
  const paint = performance.getEntriesByType('paint')
  const nav = performance.getEntriesByType('navigation')[0]
  const groupe = (nom, test) => {
    const lot = res.filter((r) => test(r.name))
    return {
      groupe: nom,
      modules: lot.length,
      sommeDureesMs: Math.round(lot.reduce((s, r) => s + r.duration, 0)),
      dernierFinitAMs: lot.length ? Math.round(Math.max(...lot.map((r) => r.responseEnd))) : 0
    }
  }
  const est = (frag) => (n) => n.includes(frag)
  return {
    urlDocument: location.href,
    peint: ${peint},
    premierRenduMs: Math.round(paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? -1),
    documentPretMs: Math.round(nav?.domContentLoadedEventEnd ?? -1),
    chargeCompleteMs: Math.round(nav?.loadEventEnd ?? -1),
    modulesTotal: res.length,
    sommeDureesTotalMs: Math.round(res.reduce((s, r) => s + r.duration, 0)),
    dernierModuleFinitAMs: res.length ? Math.round(Math.max(...res.map((r) => r.responseEnd))) : 0,
    parSousArbre: [
      groupe('three', est('/three')),
      groupe('react-force-graph', est('force-graph')),
      groupe('mermaid', est('mermaid')),
      groupe('code de l app (src/)', est('/src/')),
      groupe('autres dependances', (n) => n.includes('node_modules') && !n.includes('/three') && !n.includes('force-graph') && !n.includes('mermaid'))
    ].sort((a, b) => b.sommeDureesMs - a.sommeDureesMs),
    dixPlusLents: res
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map((r) => ({ module: r.name.replace(/^https?:\\/\\/[^/]+/, ''), dureeMs: Math.round(r.duration) }))
  }
})()`)

console.log(JSON.stringify(mesure, null, 2))
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(mesure, null, 2), 'utf8')
socket.close()
