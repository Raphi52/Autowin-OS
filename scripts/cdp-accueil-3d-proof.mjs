/**
 * Preuve hors-modèle de la vue Accueil : le décor 3D rend-il RÉELLEMENT dans l'app, et une tuile se
 * pose-t-elle bien au pixel ?
 *
 * Une capture seule ne prouve ni la pose ni l'absence de dérive, et un test unitaire happy-dom n'a
 * pas de WebGL — donc ni l'un ni l'autre ne peut attester ce fichier-ci. Ce script pilote le vrai
 * renderer par CDP : il rejoue un geste avec `Input.dispatchMouseEvent` (de vrais évènements de
 * souris, pas des évènements synthétiques), lit la transformée appliquée, et capture l'écran.
 *
 *   node scripts/cdp-accueil-3d-proof.mjs --port 9224 --out Audit/accueil-3d.png
 */
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(value('--port', '9224'))
const output = value('--out', 'C:/Amitel/Autowin OS/Audit/accueil-3d.png')
const reload = process.argv.includes('--reload')

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let id = 0
const pending = new Map()
const consoleErrors = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) {
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params?.exceptionDetails?.text ?? 'exception')
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      consoleErrors.push(message.params.entry.text)
    }
    return
  }
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const callId = ++id
    const timer = setTimeout(() => {
      pending.delete(callId)
      reject(new Error(`Délai CDP dépassé : ${method}`))
    }, 20_000)
    pending.set(callId, {
      resolve: (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    socket.send(JSON.stringify({ id: callId, method, params }))
  })

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await send('Runtime.enable')
await send('Log.enable')

if (reload) {
  await send('Page.enable')
  await send('Page.reload', { ignoreCache: true })
  await wait(4500)
}

// --- 0. emuler une taille d'ecran de travail.
//
// La fenetre reelle peut etre etroite, et l'objet de cette preuve n'est pas la taille de la fenetre.
// `Emulation.setDeviceMetricsOverride` change ce que le RENDERER croit avoir comme surface, sans
// toucher a la fenetre de l'utilisateur — on ne redimensionne pas l'app de quelqu'un pour se prendre
// en photo.
const VIEWPORT = { width: Number(value('--width', '1440')), height: Number(value('--height', '900')) }

// Le bail garantit la RESTAURATION, meme si la preuve echoue en cours de route. Sans lui, un `throw`
// entre la surcharge et le nettoyage laissait l'application de l'utilisateur coincee dans une taille
// emulee -- et ce script en contient plusieurs. Un garde-fou du depot l'exige, et il a raison.
/**
 * Deplacement demande a la tuile. Declare au niveau MODULE parce que le VERDICT le relit, apres
 * la fermeture du bloc qui pilote le navigateur.
 *
 * Il vivait DANS ce bloc, et la comparaison finale y accedait donc hors de sa portee : une
 * `ReferenceError` a l'execution, sur un script dont le seul role est de PROUVER que l'accueil
 * rend. `node --check` ne l'attrapait pas -- il valide la syntaxe, pas la resolution des portees.
 * C'est eslint (`no-undef`) qui avait raison.
 */
const GESTE = { dx: 73, dy: 41 }

const verdict = await withDeviceMetricsOverride(
  send,
  { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false },
  async () => {
await wait(400)

// --- 1. atteindre l'accueil PAR L'INTERFACE, comme un humain : si la pastille de navigation ne
// mène pas à la vue, la vue n'existe pas pour l'utilisateur, quoi qu'en dise le code.
const reached = await evaluate(`(async () => {
  const nav = document.querySelector('[data-testid="nav-accueil"]')
  if (!nav) return { erreur: 'pastille nav-accueil absente de la barre laterale' }
  nav.click()
  await new Promise((r) => setTimeout(r, 900))
  const view = document.querySelector('[data-testid="home-view"]')
  return {
    pastille: true,
    vue: Boolean(view),
    visible: view ? view.getBoundingClientRect().width > 400 : false
  }
})()`)
if (reached.erreur) throw new Error(reached.erreur)
if (!reached.vue) throw new Error("La vue Accueil n'est pas montée après le clic sur sa pastille")

// Laisse la scène rendre quelques images avant de juger le décor.
await wait(1200)

// --- 2. le canevas du decor existe-t-il, avec un contexte 3D ?
//
// On ne relit PAS les pixels du contexte : three.js n'active pas `preserveDrawingBuffer`, donc le
// tampon est deja echange quand on le lit, et l'oracle repondait « tout noir » sur une scene qui
// s'affichait parfaitement. Ce que la scene a REELLEMENT dessine est verifie plus bas, sur la
// capture — c'est aussi ce que voit l'utilisateur.
const decor = await evaluate(`(() => {
  const canvas = document.querySelector('.home-view__decor canvas')
  if (!canvas) return { erreur: 'aucun canevas de decor' }
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  return {
    canevas: [canvas.width, canvas.height],
    contexte: gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : null,
    surface: [canvas.clientWidth, canvas.clientHeight]
  }
})()`)
if (decor.erreur) throw new Error(decor.erreur)
if (!decor.contexte) throw new Error('Le decor n a pas de contexte WebGL : la scene 3D ne rend pas')

// --- 3. la pose.
//
// D'abord « Retablir » : la disposition enregistree peut venir d'une fenetre plus etroite, et elle
// est conservee telle quelle quand la surface grandit (on ne deplace pas ce que l'utilisateur a
// pose). Sans ce retablissement les tuiles se chevauchent, et la premiere version de cette preuve
// pressait au centre d'`agenda` un point occupe par une AUTRE tuile — l'oracle visait a cote.
await evaluate(`(() => {
  const bouton = [...document.querySelectorAll('.home-view__tools button')]
    .find((b) => b.textContent.includes('Retablir') || b.textContent.includes('tablir'))
  bouton?.click()
  return true
})()`)
await wait(500)

const tuile = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="home-widget-agenda"]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
  const cx = Math.round(rect.x + rect.width / 2)
  const cy = Math.round(rect.y + 12)
  // Le point de prise doit APPARTENIR a la tuile visee : sinon on mesure le comportement d'une
  // autre, et un zero se lit a tort comme « le glisse ne marche pas ».
  const sous = document.elementFromPoint(cx, cy)
  return {
    x: Math.round(m.m41),
    y: Math.round(m.m42),
    cx,
    cy,
    prisePropre: Boolean(sous && sous.closest('[data-testid="home-widget-agenda"]')),
    sousLeCurseur: sous ? sous.className : null
  }
})()`)
if (!tuile) throw new Error('Tuile Agenda absente')
if (!tuile.prisePropre) {
  throw new Error(
    `Le point de prise n'appartient pas a la tuile Agenda (sous le curseur : ${tuile.sousLeCurseur})`
  )
}

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tuile.cx, y: tuile.cy, button: 'left', clickCount: 1 })
for (let step = 1; step <= 6; step += 1) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: tuile.cx + Math.round((GESTE.dx * step) / 6),
    y: tuile.cy + Math.round((GESTE.dy * step) / 6),
    button: 'left',
    buttons: 1
  })
  await wait(24)
}
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: tuile.cx + GESTE.dx,
  y: tuile.cy + GESTE.dy,
  button: 'left',
  clickCount: 1
})

const apres = await evaluate(`(() => {
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="home-widget-agenda"]')).transform)
  return { x: Math.round(m.m41), y: Math.round(m.m42) }
})()`)
await wait(700)
const bienPlusTard = await evaluate(`(() => {
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="home-widget-agenda"]')).transform)
  return { x: Math.round(m.m41), y: Math.round(m.m42) }
})()`)

const pose = {
  gesteDemande: [GESTE.dx, GESTE.dy],
  deplacementObtenu: [apres.x - tuile.x, apres.y - tuile.y],
  deriveApresPose: [bienPlusTard.x - apres.x, bienPlusTard.y - apres.y]
}

// --- 4. la capture, APRÈS avoir remis la tuile en place : la preuve visuelle doit montrer la vue
// telle qu'elle s'ouvre, pas telle que le test l'a laissée.
await evaluate(`(() => {
  const bouton = [...document.querySelectorAll('.home-view__tools button')]
    .find((b) => b.textContent.includes('Rétablir'))
  bouton?.click()
  return true
})()`)
await wait(600)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(output, Buffer.from(shot.data, 'base64'))

// --- 5. la capture atteste-t-elle un decor DESSINE ? On compte les pixels non noirs dans une bande
// laterale, hors des tuiles : c'est la ou vivent les nebuleuses et les planetes.
const analyse = spawnSync('python', ['scripts/mesure-pixels-allumes.py', output, '0.80', '0.55'], {
  encoding: 'utf8'
})
if (analyse.status !== 0) throw new Error(`Analyse de la capture impossible : ${analyse.stderr}`)
const [pixelsZone, pixelsAllumes] = analyse.stdout.trim().split(/\s+/).map(Number)
const partAllumee = pixelsAllumes / pixelsZone

    return {
      port,
      emulation: VIEWPORT,
      navigation: reached,
      decor: { ...decor, pixelsZone, pixelsAllumes, partAllumee: Number(partAllumee.toFixed(4)) },
      pose,
      erreursConsole: consoleErrors.slice(0, 5),
      capture: output
    }
  }
)
console.log(JSON.stringify(verdict, null, 2))
const { pose, partAllumee } = verdict

const echecs = []
if (pose.deplacementObtenu[0] !== GESTE.dx || pose.deplacementObtenu[1] !== GESTE.dy) {
  echecs.push(`la tuile n'a pas suivi le geste au pixel : ${pose.deplacementObtenu}`)
}
if (pose.deriveApresPose[0] !== 0 || pose.deriveApresPose[1] !== 0) {
  echecs.push(`la tuile a derive apres le lacher : ${pose.deriveApresPose}`)
}
// 2 % de la bande allumee : un decor spatial est majoritairement noir, mais une bande entierement
// eteinte signifierait que rien n'a ete dessine.
if (partAllumee < 0.02) {
  echecs.push(`le decor est quasi eteint dans la bande laterale : ${(partAllumee * 100).toFixed(2)} %`)
}
if (consoleErrors.length > 0) echecs.push(`erreurs console : ${consoleErrors[0]}`)
if (echecs.length > 0) {
  console.error('ECHEC : ' + echecs.join(' | '))
  process.exit(1)
}
console.log('OK — decor 3D dessine, tuile posee au pixel, aucune derive')
process.exit(0)
