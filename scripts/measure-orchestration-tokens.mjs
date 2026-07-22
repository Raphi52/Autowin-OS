// Harnais de mesure tokens d'orchestration (repo-map #1 + compaction juge #3).
//
// S'abonne au flux RÉEL `onOrchestrateStep` (chaque step exec porte .prompt = messages envoyés au
// sous-agent, incluant la repo-map, et .usage = inputTokens), déclenche une orchestration, approuve
// les décisions d'autorité, puis rapporte par phase : repo-map injectée ? tokens input/output ?
//
// Usage : RUN_LABEL=on RUN_TASK="..." node scripts/measure-orchestration-tokens.mjs
// A/B : lancer une fois avec graphify-out/ présent (repo-map ON), une fois renommé (OFF), comparer.
//
// Lecture seule côté code app ; DÉCLENCHE un vrai run (vrais tokens sous-agent) → coût réel.

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const LABEL = process.env.RUN_LABEL || 'on'
const task =
  process.env.RUN_TASK ||
  'Locate in the Autowin OS source code where an authority decision approval is handled. Name the relevant file(s). Do not modify anything.'

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error(`Autowin introuvable via CDP ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = pending.get(m.id)
  if (!cb) return
  pending.delete(m.id)
  m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result)
}
await new Promise((r) => (socket.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nextId
    pending.set(id, { resolve: res, reject: rej })
    socket.send(JSON.stringify({ id, method, params }))
  })
async function ev(expr, awaitP = true) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: awaitP
  })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sentinel = `measure-${LABEL}-${Date.now()}`
const fullTask = `[[${sentinel}]] ${task}`

// Collecteur : on capture chaque step d'orchestration dans window.__mSteps.
await ev(String.raw`(() => {
  window.__mSteps = []
  if (window.__mUnsub) window.__mUnsub()
  window.__mUnsub = window.api.onOrchestrateStep((s) => {
    try {
      const msgs = (s.prompt && s.prompt.messages) || []
      const userText = msgs.map((m) => String(m.content || '')).join('\n')
      const sysText = String((s.prompt && s.prompt.system) || '')
      window.__mSteps.push({
        step: s.step, role: s.role || null, phase: s.detail || null, status: s.status || null,
        input: (s.usage && s.usage.inputTokens) || null,
        output: (s.usage && s.usage.outputTokens) || null,
        cacheRead: (s.usage && s.usage.cacheReadTokens) || null,
        tokens: s.tokens || null,
        repoMapInUser: /CARTE DU CODE/.test(userText),
        repoMapInSys: /CARTE DU CODE/.test(sysText),
        brainInUser: /AMITEL BRAIN REFERENCE DATA/.test(userText),
        userChars: userText.length, sysChars: sysText.length
      })
    } catch (e) { window.__mSteps.push({ error: String(e) }) }
  })
  return true
})()`)

await ev(`window.api.orchestrate(${JSON.stringify(fullTask)})`, false)

let approved = 0
let idle = 0
for (let i = 0; i < 160; i++) {
  await sleep(2500)
  const pend = await ev(
    `(async()=>{try{const p=await window.api.authorityPending();return p.map(d=>d.id)}catch(e){return []}})()`
  )
  if (Array.isArray(pend) && pend.length) {
    for (const id of pend) {
      await ev(`window.api.authorityResolve(${JSON.stringify(id)},true)`, false)
      approved++
    }
    idle = 0
    continue
  }
  // Fin : le dernier step est un 'gate' ou un 'judge' completed, et plus rien ne bouge.
  const snap = await ev(
    `(() => { const s = window.__mSteps || []; const last = s[s.length-1]; return { n: s.length, lastStep: last && last.step, lastStatus: last && last.status } })()`
  )
  if (snap.n > 0 && (snap.lastStep === 'gate' || snap.lastStep === 'judge')) {
    idle++
    if (idle >= 3) break
  } else {
    idle = 0
  }
}

const steps = await ev(`window.__mSteps || []`)
const exec = steps.filter((s) => s.step === 'exec')
const report = {
  label: LABEL,
  sentinel,
  approved,
  totalSteps: steps.length,
  execPhases: exec.length,
  repoMapReached: exec.some((s) => s.repoMapInUser || s.repoMapInSys),
  brainReached: exec.some((s) => s.brainInUser),
  perStep: steps.map((s) => ({
    step: s.step,
    phase: s.phase,
    status: s.status,
    input: s.input,
    output: s.output,
    cacheRead: s.cacheRead,
    repoMap: s.repoMapInUser || s.repoMapInSys,
    userChars: s.userChars,
    sysChars: s.sysChars
  })),
  sumInput: exec.reduce((a, s) => a + (s.input || 0), 0),
  sumOutput: exec.reduce((a, s) => a + (s.output || 0), 0)
}
console.log(JSON.stringify(report, null, 2))
socket.close()
process.exit(0)
