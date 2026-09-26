/**
 * PREUVE HORS-MODELE : AU SURVOL, UNE LIGNE DE LA PALETTE « / » MONTRE LA DESCRIPTION ENTIERE.
 *
 * Demande utilisateur du 2026-09-26 : « quand je fais / et que je hover un skill je veux voir la full
 * description ». Les tests unitaires prouvent que le texte complet est DANS la ligne ; happy-dom n'a
 * pas de `:hover`, donc seule une vraie instance prouve qu'il DEVIENT VISIBLE au survol et reste
 * cache au repos. Ce script tape « / » dans le composer, amene la souris sur une ligne (vrai
 * evenement souris CDP, donc vrai `:hover`) et mesure.
 *
 * Usage : node scripts/avec-instance-headless.mjs --code-dev -- node scripts/cdp-slash-palette-survol.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { portCdp } from './cdp-port.mjs'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = portCdp()
const output = resolve(
  argument('--out', 'Audit/headless-instances/slash-palette/proof/slash-palette-survol.png')
)
mkdirSync(dirname(output), { recursive: true })

const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = cibles.find((item) => item.type === 'page' && !item.url.startsWith('devtools'))
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.onopen = resolveOpen
  socket.onerror = rejectOpen
})
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolveCall, rejectCall) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectCall(new Error(`Timeout CDP: ${method}`))
    }, 45_000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolveCall(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        rejectCall(error)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails)
    throw new Error(`Erreur renderer: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`)
  return result.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expression, label, timeoutMs = 25_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  throw new Error(`Délai dépassé: ${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(`!document.querySelector('[data-testid="first-run-wizard"]')`, 'fermeture du first-run')
// Une instance neuve n'a aucune conversation ouverte, donc aucun composer : on charge la fixture
// de conversation (meme amorce que cdp-chat-mermaid.mjs) et on l'ouvre.
await evaluate(`window.api.seedArtifactPreviewsTest(true)`)
await send('Page.reload', { ignoreCache: true })
await waitFor(`document.readyState === 'complete'`, 'rechargement')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `(() => {
    document.querySelector('[data-testid="nav-chat"]')?.click()
    const cible = [...document.querySelectorAll('.conv-item')]
      .find((item) => item.querySelector('.conv-label')?.textContent === 'HTML rendu · fixture')
    cible?.querySelector('.conv-pick')?.click()
    return Boolean(cible)
  })()`,
  'conversation de la fixture'
)
await waitFor(`Boolean(document.querySelector('.composer-field textarea'))`, 'composer du chat')

// Frappe REELLE de « / » : Input.insertText passe par l'edition du champ, donc par onChange React.
await evaluate(`document.querySelector('.composer-field textarea').focus()`)
await send('Input.insertText', { text: '/' })
await waitFor(`document.querySelectorAll('.slash-palette .slash-item').length > 0`, 'palette /')

// Cible : une ligne VISIBLE sans defilement, suivie d'une autre (pour tester le passage de l'une a
// l'autre). On prend celle dont la skill a la description la plus longue selon le catalogue reel.
const cible = await evaluate(`(async () => {
  const items = [...document.querySelectorAll('.slash-palette .slash-item')]
  const liste = document.querySelector('.slash-palette').getBoundingClientRect()
  const catalogue = await window.api.capabilityControls('skills')
  const longueur = (li) => {
    const nom = li.querySelector('.slash-name').textContent.slice(1)
    return (catalogue.find((c) => c.id === nom)?.description ?? '').length
  }
  const visibles = items.filter((li, i) => {
    const r = li.getBoundingClientRect()
    const suivante = items[i + 1]?.getBoundingClientRect()
    return r.top >= liste.top && suivante && suivante.bottom <= liste.bottom
  })
  const choisie = visibles.sort((a, b) => longueur(b) - longueur(a))[0]
  if (!choisie) return null
  const suivante = items[items.indexOf(choisie) + 1]
  choisie.setAttribute('data-sonde', 'survol')
  suivante.setAttribute('data-sonde', 'suivante')
  const r = choisie.getBoundingClientRect()
  const rs = suivante.getBoundingClientRect()
  return {
    nom: choisie.querySelector('.slash-name').textContent,
    suivante: suivante.querySelector('.slash-name').textContent,
    longueurCatalogue: longueur(choisie),
    x: r.left + 40, y: r.top + r.height / 2,
    xs: rs.left + 40, ys: rs.top + rs.height / 2
  }
})()`)
if (!cible) {
  console.log(JSON.stringify({ ok: false, echecs: ['aucune ligne survolable dans la palette'] }))
  process.exit(1)
}

const mesurer = () =>
  evaluate(`(() => {
  const li = document.querySelector('[data-sonde="survol"]')
  const detail = document.querySelector('[data-testid="slash-detail"]')
  const rd = detail?.getBoundingClientRect()
  const survolee = document.querySelector('.slash-palette .slash-item:hover .slash-name')
  return {
    encart: Boolean(detail),
    nomEncart: detail?.querySelector('.slash-name')?.textContent ?? null,
    longueurTexteEncart: detail?.querySelector('.slash-detail-texte')?.textContent.length ?? 0,
    // L'encart doit etre ENTIEREMENT dans la fenetre (ou defilable s'il est borne).
    encartDansLaFenetre: rd ? rd.top >= 0 && rd.bottom <= window.innerHeight : null,
    encartDefilable: detail ? detail.scrollHeight > detail.clientHeight : null,
    hauteurEncart: rd?.height ?? 0,
    positionLigne: Math.round(li.getBoundingClientRect().top),
    ligneSousLaSouris: survolee?.textContent ?? null,
    largeurFenetre: window.innerWidth
  }
})()`)

// Au repos : souris hors de la palette.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
await sleep(250)
const repos = await mesurer()
// Survol : vrai deplacement de souris sur la ligne cible.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cible.x, y: cible.y })
await sleep(400)
const survol = await mesurer()

// Meme reglage que ui-capture.mjs : sans `fromSurface`, la fenetre cachee ne rend jamais l'image.
let capture = output
try {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  writeFileSync(output, Buffer.from(shot.data, 'base64'))
} catch (erreur) {
  capture = `echec de la capture : ${erreur.message}` // le verdict DOM reste, l'image manque : dit
}

// Passage a la ligne SUIVANTE : la souris doit atterrir sur elle, pas sauter plus loin.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cible.xs, y: cible.ys })
await sleep(400)
const passage = await mesurer()

const echecs = []
if (repos.encart) echecs.push('encart visible AU REPOS')
if (!survol.encart) echecs.push('aucun encart au survol')
if (survol.nomEncart !== cible.nom) echecs.push(`encart de ${survol.nomEncart} au lieu de ${cible.nom}`)
if (survol.longueurTexteEncart !== cible.longueurCatalogue)
  echecs.push(`texte tronque : ${survol.longueurTexteEncart} car. sur ${cible.longueurCatalogue}`)
if (survol.encartDansLaFenetre === false) echecs.push('encart qui sort de la fenetre')
if (survol.positionLigne !== repos.positionLigne)
  echecs.push(`la ligne survolee a bouge de ${survol.positionLigne - repos.positionLigne} px`)
if (survol.ligneSousLaSouris !== cible.nom) echecs.push(`souris sur ${survol.ligneSousLaSouris} apres affichage`)
if (passage.ligneSousLaSouris !== cible.suivante)
  echecs.push(`passage a la suivante : souris sur ${passage.ligneSousLaSouris}, attendu ${cible.suivante}`)
socket.close()
console.log(JSON.stringify({ ok: echecs.length === 0, echecs, cible, repos, survol, passage, capture }, null, 2))
process.exit(echecs.length === 0 ? 0 : 1)
