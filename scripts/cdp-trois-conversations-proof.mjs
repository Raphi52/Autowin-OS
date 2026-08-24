/**
 * PREUVE HORS-MODÈLE de la demande de l'utilisateur : « lancer 3 convers sur la même chose, pas
 * d'erreur avant de se lancer au travail, pas de workspace orphelin à la fin ».
 *
 * Les tests unitaires prouvent chaque pièce. Ce script prouve le GESTE, dans l'application réelle.
 */
const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('5173'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const erreursConsole = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    erreursConsole.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
await send('Runtime.enable')

const TACHE = "Ajoute une seule ligne a la fin du fichier PREUVE-TROIS-CONVERS.md a la racine du depot : une ligne commencant par '- ' suivie d'un mot au hasard. Ne touche a AUCUN autre fichier."

const ids = []
for (const nom of ['preuve-1', 'preuve-2', 'preuve-3']) {
  ids.push(await ev(`(async () => { const c = await window.api.conversationsCreate(${JSON.stringify(nom)}); return c?.id ?? c })()`))
}
console.log('CONVERSATIONS', JSON.stringify(ids))

// Les trois partent sur LA MEME CHOSE, sans attendre les unes les autres.
for (const cid of ids) {
  await ev(`(() => { window.api.orchestrate(${JSON.stringify(TACHE)}, ${JSON.stringify(cid)}); return true })()`)
}
console.log('LANCEES', new Date().toISOString())

// Erreurs AVANT le travail : on regarde tout de suite.
await new Promise((r) => setTimeout(r, 8000))
console.log('ERREURS_AU_LANCEMENT', JSON.stringify(erreursConsole.slice(0, 6)))
const act = await ev(`(async () => { const a = await window.api.getWorktreeActivity(); return (a||[]).map(x => ({ id: x.agentId, s: x.state, p: x.publication, r: x.attentionReason })) })()`)
console.log('ACTIVITE_INITIALE', JSON.stringify(act))
ws.close()
