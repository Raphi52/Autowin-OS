/** Tri des copies via CDP : preserve puis libere, jamais de suppression seche. */
const t=await (await fetch('http://127.0.0.1:9223/json')).json()
const page=t.find(x=>x.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl)
let id=0; const pend=new Map()
ws.onmessage=({data})=>{const m=JSON.parse(data);const cb=pend.get(m.id);if(!cb)return;pend.delete(m.id);cb.resolve(m)}
await new Promise(r=>{ws.onopen=r})
const ev=async e=>{const i=++id;const m=await new Promise(ok=>{pend.set(i,{resolve:ok});ws.send(JSON.stringify({id:i,method:'Runtime.evaluate',params:{expression:e,returnByValue:true,awaitPromise:true}}))});if(m.result?.exceptionDetails)return{EX:m.result.exceptionDetails.exception?.description};return m.result?.result?.value}
const agents = process.argv.slice(2)
const bilan={}
for (const a of agents) {
  const r = await ev(`window.api.preserveReleaseWorktree(${JSON.stringify(a)})`)
  const o = r?.outcome ?? r?.EX ?? 'inconnu'
  bilan[o]=(bilan[o]||0)+1
  console.log(`${o.padEnd(20)} ${a}${r?.branche?' → '+r.branche:''}${r?.detail?' ('+r.detail+')':''}`)
}
console.log('\nbilan:', JSON.stringify(bilan))
ws.close()
