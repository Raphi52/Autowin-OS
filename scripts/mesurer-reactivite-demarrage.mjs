// Latence des IPC pendant la fenêtre où le balayage tourne. Un balayage bloquant produit un TROU :
// aucune réponse pendant ~19 s. Un balayage qui rend la main produit des latences bornées.
const p = 9223
const attendre = async () => {
  const limite = Date.now() + 120_000
  while (Date.now() < limite) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${p}/json`)).json()
      const page = pages.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // CDP n'est pas encore prêt : la boucle bornée retente après 300 ms.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('pas de page CDP')
}
const page = await attendre()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (m, q = {}) =>
  new Promise((res, rej) => {
    const mine = ++id
    const h = (e) => {
      const d = JSON.parse(e.data)
      if (d.id !== mine) return
      ws.removeEventListener('message', h)
      d.error ? rej(new Error(d.error.message)) : res(d.result)
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: mine, method: m, params: q }))
  })
const latences = []
const debut = Date.now()
while (Date.now() - debut < 40_000) {
  const t = Date.now()
  try {
    await send('Runtime.evaluate', {
      expression: 'window.api.getWorktreeActivity().then(a=>a.length)',
      returnByValue: true,
      awaitPromise: true
    })
    latences.push(Date.now() - t)
  } catch {
    latences.push(-1)
  }
  await new Promise((r) => setTimeout(r, 400))
}
const ok = latences.filter((l) => l >= 0)
console.log(
  JSON.stringify(
    {
      sondes: latences.length,
      echecs: latences.filter((l) => l < 0).length,
      latenceMaxMs: Math.max(...ok),
      latenceMedianeMs: ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)],
      auDessusDe2000ms: ok.filter((l) => l > 2000).length
    },
    null,
    1
  )
)
ws.close()
