#!/usr/bin/env node
/**
 * sonde-cout-image-accueil — combien coûte UNE image du fond de l'Accueil, et à quelle cadence il tourne.
 *
 * POURQUOI (conv-1512, 2026-11-04) : « l'accueil ça fait laggy ». Le fond falaise (quartier-scene.ts)
 * se dessine dans le fil de l'interface ; decor-cadence.ts espace les images dès qu'une image coûte
 * plus de la moitié de l'intervalle. Le banc de décor retiré ne mesurait que l'ancien fond « avenue ».
 * Cette sonde lit les repères `decor:image` posés par DecorDeFond.tsx et rend les centiles.
 *
 * Usage :
 *   node scripts/avec-instance-headless.mjs --code-dev --instance-id <id> -- \
 *     node --experimental-websocket scripts/sonde-cout-image-accueil.mjs [--secondes 8]
 *   ou, sur une app déjà ouverte avec un port de débogage : ... sonde-cout-image-accueil.mjs --port <n>
 * Sortie : JSON { images, ips, cout: { p50, p90, p99, max } } ; code 2 = mesure impossible.
 */
function argument(nom, defaut) {
  const i = process.argv.indexOf(nom)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : defaut
}

async function connecter(port) {
  const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !String(t.url).startsWith('devtools'))
  if (!page) throw new Error(`aucune page sur le port ${port}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    ws.onopen = ok
    ws.onerror = () => ko(new Error('connexion CDP refusée'))
  })
  let id = 0
  const attente = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && attente.has(m.id)) {
      attente.get(m.id)(m)
      attente.delete(m.id)
    } else if (m.method === 'Page.screencastFrame') {
      envoyer('Page.screencastFrameAck', { sessionId: m.params.sessionId })
    }
  }
  const envoyer = (method, params = {}) =>
    new Promise((ok) => {
      const n = ++id
      attente.set(n, ok)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const evaluer = async (expression) => {
    const m = await envoyer('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.text)
    return m.result?.result?.value
  }
  return { ws, envoyer, evaluer }
}

const centile = (tries, p) => tries[Math.min(tries.length - 1, Math.floor(p * tries.length))]

async function main() {
  const port = Number(argument('--port'))
  const secondes = Number(argument('--secondes', '8'))
  if (!Number.isInteger(port)) {
    console.error('--port manquant')
    return 2
  }
  const cdp = await connecter(port)
  await cdp.envoyer('Page.enable')
  // L'instance cachée n'a ni écran ni focus : le screencast la remet à sa cadence réelle.
  const reel = process.argv.includes('--reel')
  if (!reel)
    await cdp.envoyer('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 320 })
  if (!reel) await cdp.envoyer('Emulation.setFocusEmulationEnabled', { enabled: true })
  const debut = Date.now()
  while (Date.now() - debut < 180_000) {
    const n = await cdp.evaluer(`performance.getEntriesByName('decor:image').length`)
    if (n > 5) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  await cdp.evaluer(`performance.clearMeasures('decor:image'); globalThis.__sonde = []; true`)
  // Le tampon de la page est vidé à 300 : on recopie au fil de l'eau.
  await cdp.evaluer(
    `(() => { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'decor:image') globalThis.__sonde.push([e.startTime, e.duration]) }).observe({ type: 'measure' }); return true })()`
  )
  await new Promise((r) => setTimeout(r, secondes * 1000))
  const images = await cdp.evaluer(`globalThis.__sonde`)
  cdp.ws.close()
  if (!images || images.length < 2) {
    console.log(
      JSON.stringify({ erreur: 'aucune image du fond mesurée', images: images?.length ?? 0 })
    )
    return 2
  }
  const couts = images.map(([, d]) => d).sort((a, b) => a - b)
  const duree = (images.at(-1)[0] - images[0][0]) / 1000
  const r = (v) => Math.round(v * 10) / 10
  console.log(
    JSON.stringify({
      images: images.length,
      ips: r((images.length - 1) / duree),
      cout: {
        p50: r(centile(couts, 0.5)),
        p90: r(centile(couts, 0.9)),
        p99: r(centile(couts, 0.99)),
        max: r(couts.at(-1))
      }
    })
  )
  return 0
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(String(e))
    process.exit(2)
  }
)
