/**
 * JUGER L'EXPÉRIENCE des conversations DÉJÀ tenues — sans en créer aucune.
 *
 * Demande de l'utilisateur le 2026-08-15 : « judge les conversations que t'as eu ». Ses mots sur les
 * sondes précédentes : « pour moi toutes tes sondes sont des échecs, y'en a pas une qui a fini avec
 * le bloc fait / à faire ». Mes scores 10/10 et 8/8 ne vérifiaient QUE l'exactitude du chiffre : des
 * faux verts sur un critère de surface.
 *
 * Ce script ne mesure plus la justesse mais ce que l'utilisateur LIT. Il ne crée ni ne supprime rien.
 */
import { jugerLaForme } from './cdp-verdict.mjs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const prefixe = process.argv[2] || 'Sonde '
const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = t.find((x) => x.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = pend.get(m.id)
  if (!cb) return
  pend.delete(m.id)
  cb.resolve(m)
}
await new Promise((r) => {
  ws.onopen = r
})
const ev = async (e) => {
  const i = ++id
  const m = await new Promise((ok) => {
    pend.set(i, { resolve: ok })
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression: e, returnByValue: true, awaitPromise: true }
      })
    )
  })
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description)
  return m.result?.result?.value
}

const liste = (await ev('window.api.conversations()')) ?? []
const cibles = liste.filter((c) => String(c.title ?? '').startsWith(prefixe))
const compte = {}
let conformes = 0
for (const c of cibles) {
  const fil = await ev(`window.api.conversation(${JSON.stringify(c.id)})`)
  const dernier = [...(fil?.messages ?? [])].filter((m) => m.role === 'assistant').at(-1)
  const defauts = jugerLaForme(dernier?.content)
  if (defauts.length === 0) conformes += 1
  for (const d of defauts) compte[d.nom] = (compte[d.nom] ?? 0) + 1
}
console.log(`conversations jugées : ${cibles.length}`)
console.log(`EXPÉRIENCE CONFORME  : ${conformes}/${cibles.length}`)
console.log('\ndéfauts, par fréquence :')
for (const [nom, n] of Object.entries(compte).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${nom}`)
}
ws.close()
