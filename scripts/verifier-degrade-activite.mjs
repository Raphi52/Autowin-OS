/**
 * ORACLE DE CASCADE REELLE pour la teinte de la carte d'activite.
 *
 * Les tests unitaires lisent les feuilles par `indexOf` : ils prouvent que le degrade est ECRIT,
 * jamais qu'il est APPLIQUE. C'est exactement le faux vert deja releve sur cette conversation — une
 * regle correcte dans `ChatView.css` reste invisible quand `.cosmic-outline .activity-group` (plus
 * specifique) la repeint en aplat.
 *
 * Ce harnais demande le verdict a Chromium : il ouvre une iframe ISOLEE dans l'app en cours,
 * y charge les DEUX feuilles reelles, monte une carte par etat, et lit `getComputedStyle().
 * backgroundImage`. Un aplat rend « none » -> exit 6. L'iframe est retiree ensuite : la page de
 * l'utilisateur n'est jamais repeinte.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ETATS = ['failed', 'running', 'interrupted', 'done']
const rendre = (charge, code) => {
  console.log(JSON.stringify(charge, null, 2))
  process.exit(code)
}

const port = process.env.AUTOWIN_CDP_PORT || '9231'
const lirePort = async (p) =>
  (await (await fetch(`http://127.0.0.1:${p}/json`, { signal: AbortSignal.timeout(15_000) })).json())
let cibles
let portUtilise = String(port)
try {
  cibles = await lirePort(port)
} catch {
  const actif = readFileSync(
    'C:/Amitel/Autowin OS/.autowin-data/autowin-os/DevToolsActivePort',
    'utf8'
  )
    .trim()
    .split(/\r?\n/)
  portUtilise = actif[0]
  cibles = await lirePort(actif[0])
}
const page = cibles.find((c) => c.type === 'page')
if (!page) rendre({ ok: false, echecs: ['page-autowin-absente'] }, 3)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, ko) => {
  socket.onopen = ok
  socket.onerror = ko
})
let id = 0
const attente = new Map()
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = attente.get(m.id)
  if (!cb) return
  attente.delete(m.id)
  m.error ? cb.ko(new Error(m.error.message)) : cb.ok(m.result)
}
const envoyer = (methode, params = {}) =>
  new Promise((ok, ko) => {
    const n = ++id
    const t = setTimeout(() => (attente.delete(n), ko(new Error(`${methode} expire`))), 60_000)
    attente.set(n, { ok: (v) => (clearTimeout(t), ok(v)), ko: (e) => (clearTimeout(t), ko(e)) })
    socket.send(JSON.stringify({ id: n, method: methode, params }))
  })
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  }
  return r.result?.value
}
await envoyer('Runtime.enable')

const base = readFileSync(resolve('src/renderer/src/components/ChatView.css'), 'utf8')
const theme = readFileSync(resolve('src/renderer/src/assets/cosmic-outline.css'), 'utf8')
const html = `<html><body class="cosmic-outline" style="margin:0">${ETATS.map(
  (e) => `<div class="activity-group" data-state="${e}" id="c-${e}">x</div>`
).join('')}</body></html>`

const mesure = await evaluer(`(async () => {
  const cadre = document.createElement('iframe')
  cadre.style.cssText = 'position:fixed;left:-9999px;width:800px;height:400px'
  document.body.appendChild(cadre)
  try {
    const d = cadre.contentDocument
    d.open(); d.write(${JSON.stringify(html)}); d.close()
    for (const css of [${JSON.stringify(base)}, ${JSON.stringify(theme)}]) {
      const s = d.createElement('style'); s.textContent = css; d.head.appendChild(s)
    }
    await new Promise((r) => requestAnimationFrame(r))
    const lu = {}
    for (const e of ${JSON.stringify(ETATS)}) {
      const n = d.getElementById('c-' + e)
      const st = cadre.contentWindow.getComputedStyle(n)
      lu[e] = { fond: st.backgroundImage, bord: st.borderLeftColor }
    }
    return lu
  } finally { cadre.remove() }
})()`)

socket.close()
const echecs = []
for (const etat of ETATS) {
  const fond = mesure?.[etat]?.fond ?? 'none'
  if (!/linear-gradient/.test(fond)) echecs.push(`${etat}: fond calcule sans degrade (${fond})`)
}
rendre(
  {
    ok: echecs.length === 0,
    echecs,
    portUtilise,
    mesure,
    preuve: echecs.length
      ? 'cascade Chromium : au moins un etat rendu en aplat'
      : `cascade Chromium reelle : les ${ETATS.length} etats de .activity-group calculent un linear-gradient`
  },
  echecs.length ? 6 : 0
)
