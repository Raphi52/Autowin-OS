const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('5173'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const {res,rej}=pending.get(m.id); pending.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result) } }
await new Promise((r) => (ws.onopen = r))
const send = (method, params={}) => new Promise((res,rej)=>{ const i=++id; pending.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method,params})) })
const ev = async (expr) => { const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,200)); return r.result.value }
const CIBLES = process.argv.slice(2)
for (let i = 0; i < 40; i++) {
  const act = await ev(`(async () => { const a = await window.api.getWorktreeActivity(); return (a||[]).filter(x => ${JSON.stringify(CIBLES)}.includes(x.agentId)).map(x => ({ id: x.agentId, s: x.state, p: x.publication, r: x.attentionReason, wt: x.worktreeAvailable })) })()`)
  const encore = act.filter((x) => x.s === 'working' || x.s === 'isolated')
  console.log(new Date().toISOString().slice(11,19), JSON.stringify(act))
  if (!encore.length && act.length) { console.log('TERMINES'); break }
  await new Promise((r) => setTimeout(r, 15000))
}
ws.close()
