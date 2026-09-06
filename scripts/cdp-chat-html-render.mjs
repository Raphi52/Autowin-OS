/**
 * PREUVE HORS-MODELE : LE HTML D'UN MODELE EST RENDU, ET IL EST DESARME.
 *
 * Reecrite le 2026-09-06. La version precedente pilotait une IFRAME isolee et verifiait sa CSP.
 * Cette architecture n'existe plus : Markdown.tsx rend desormais le bloc html-render DANS le fil
 * (data-testid="chat-inline-html"), parce que l'iframe imposait bordure, barre d'outils et hauteur
 * fixe — « le contenu etait enferme dans une boite au lieu d'embellir la reponse ». La frontiere de
 * securite tient donc a UNE seule fonction, sanitizeChatHtml (chat-html-inline.ts).
 *
 * POURQUOI CETTE SONDE EXISTE MALGRE 13 TESTS UNITAIRES sur cette fonction : ils prouvent ce que la
 * fonction RETOURNE. Ils ne peuvent pas prouver ce qui arrive dans le VRAI DOM de l'application, ni
 * qu'aucune requete ne part sur le reseau. C'est exactement ce que le HTML injecte peut faire de
 * pire, et c'est ce qui se mesure ici.
 *
 * La fixture semee est deliberement HOSTILE (src/main/index.ts) : elle porte un script, un
 * meta http-equiv="refresh", une image distante et un lien externe, tous pointes vers un serveur
 * canari local. Le verdict est donc double :
 *   · le contenu LEGITIME est bien rendu (titre, cartes, depliable natif) ;
 *   · le contenu HOSTILE est absent du DOM, n'a rien execute, et n'a JOINT PERSONNE.
 *
 * Usage : node scripts/cdp-chat-html-render.mjs [--port <port>] [--canary-port <port>]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'
import { portCdp } from './cdp-port.mjs'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
// Resolution COMMUNE du port : --port, puis AUTOWIN_CDP_PORT, puis le port REEL de l'instance.
const port = portCdp()
const canaryPort = Number(argument('--canary-port', '9262'))
const productFingerprint = argument('--fingerprint', 'unbound')
const output = resolve(argument('--out', 'Audit/headless-instances/chat-html/proof/chat-html.png'))
const narrowOutput = output.replace(/\.png$/i, '-narrow.png')
const proofOutput = output.replace(/\.png$/i, '.json')
mkdirSync(dirname(output), { recursive: true })

let networkCanaryHits = 0
const networkCanaryHitsByType = { image: 0, metaRefresh: 0, link: 0 }
let canaryHealthHits = 0
const canaryServer = createServer((request, response) => {
  const requestUrl = request.url ?? ''
  if (requestUrl.includes('autowin-html-render-network-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.image += 1
  } else if (requestUrl.includes('autowin-html-render-meta-refresh-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.metaRefresh += 1
  } else if (requestUrl.includes('autowin-html-render-link-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.link += 1
  } else canaryHealthHits += 1
  response.writeHead(204).end()
})
await new Promise((resolveListen, rejectListen) => {
  canaryServer.once('error', rejectListen)
  canaryServer.listen(canaryPort, '127.0.0.1', resolveListen)
})
const canaryHealth = (await fetch(`http://127.0.0.1:${canaryPort}/health`)).status === 204

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitForPage() {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // Electron démarre encore.
    }
    await sleep(150)
  }
  throw new Error(`Fenêtre Electron introuvable sur le port ${port}`)
}

const page = await waitForPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.onopen = resolveOpen
  socket.onerror = rejectOpen
})
let sequence = 0
const pending = new Map()
const runtimeErrors = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) {
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params)
    return
  }
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
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails)
    throw new Error(`Erreur renderer: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`)
  return result.result?.value
}
const waitFor = async (expression, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  throw new Error(`Délai dépassé: ${label}`)
}
const capture = async (path) => {
  const screenshot = await evaluate(`window.api.captureTestPage()`)
  writeFileSync(path, Buffer.from(screenshot, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run'
)

const seeded = await evaluate(`window.api.seedArtifactPreviewsTest(true)`)
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
  'conversation HTML'
)

/*
 * ON ATTEND LE BLOC MONTE. Le rendu est inline : il n'y a pas de cadre a attendre, mais le fil doit
 * avoir fini de se poser. On attend l'element, jamais une duree.
 */
const rendu = await waitFor(
  `Boolean(document.querySelector('[data-testid="chat-inline-html"]'))`,
  'rendu HTML inline'
)

// On laisse au navigateur le temps de tenter ce qu'il aurait tente : charger une image distante,
// suivre un meta refresh. S'il le fait, le serveur canari le saura.
await sleep(1_500)

const preuve = await evaluate(`(() => {
  const bloc = document.querySelector('[data-testid="chat-inline-html"]')
  if (!bloc) return null
  const elements = [...bloc.querySelectorAll('*')]
  const style = bloc.querySelector('style')
  const corpsApp = getComputedStyle(document.body)
  const fil = document.querySelector('.chat-scroll')
  return {
    elements: elements.length,
    titre: bloc.querySelector('h1')?.textContent?.trim() ?? null,
    cartes: bloc.querySelectorAll('.card').length,
    depliableNatif: Boolean(bloc.querySelector('details > summary')),
    scripts: bloc.querySelectorAll('script').length,
    attributsEvenement: elements.filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
    iframes: bloc.querySelectorAll('iframe').length,
    metaRefresh: bloc.querySelectorAll('meta').length,
    imagesDistantes: [...bloc.querySelectorAll('img')].filter((i) => /^https?:/i.test(i.getAttribute('src') ?? '')).length,
    /*
     * UN LIEN DISTANT EST AUTORISE — MAIS IL DOIT ETRE HARNACHE.
     *
     * sanitizeHref garde http(s) et refuse tout le reste, et c'est deliberе : une IMAGE distante se
     * charge toute seule (elle ferait fuiter une visite au simple affichage), un LIEN demande un
     * clic. Ce qu'on exige donc, ce n'est pas son absence, c'est qu'il ne puisse pas emporter
     * l'application : cible externe et rel qui coupe l'acces a l'ouvreur.
     */
    liensJavascript: [...bloc.querySelectorAll('a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') ?? '')).length,
    liensDistantsNonHarnaches: [...bloc.querySelectorAll('a')]
      .filter((a) => /^https?:/i.test(a.getAttribute('href') ?? ''))
      .filter((a) => a.getAttribute('target') !== '_blank' || !/noopener/.test(a.getAttribute('rel') ?? '')).length,
    adresseAvantClic: location.href,
    scriptExecute: document.documentElement.dataset.forbiddenScript ?? null,
    styleAppartientAuBloc: Boolean(style?.textContent?.includes('data-html-scope')),
    scopeId: bloc.getAttribute('data-html-scope'),
    padCorpsApp: corpsApp.padding,
    debordement: fil
      ? Math.round(bloc.getBoundingClientRect().right - fil.getBoundingClientRect().right)
      : null
  }
})()`)

/*
 * PHOTO DU CANARI AVANT TOUT CLIC.
 *
 * C'est LA mesure qui compte : au simple AFFICHAGE, le rendu ne doit joindre personne. Ce qui part
 * apres un clic deliberе du lecteur est une autre histoire — un lien qu'on ouvre est cense etre
 * suivi. Confondre les deux rendait la preuve fausse dans les deux sens : elle aurait rougi sur un
 * comportement voulu, et elle serait restee muette si l'affichage seul avait fuite.
 */
const canariAvantClic = { total: networkCanaryHits, ...networkCanaryHitsByType }

/*
 * LE CLIC SUR UN LIEN DISTANT NE DOIT PAS EMPORTER L'APPLICATION.
 *
 * C'est le vrai risque restant maintenant que les liens http(s) sont autorises : une navigation du
 * document remplacerait l'interface d'Autowin par une page du web, sans retour possible. On clique
 * pour de vrai, et on relit l'adresse.
 */
await evaluate(`(() => {
  document.querySelector('[data-testid="chat-inline-html"] a[href^="http"]')?.click()
  return true
})()`)
await sleep(1_500)
const adresseApresClic = await evaluate(`location.href`)

// Le lecteur peut-il INTERAGIR avec le rendu ? Le depliable natif doit s'ouvrir au clic.
const interaction = await evaluate(`(() => {
  const details = document.querySelector('[data-testid="chat-inline-html"] details')
  details?.querySelector('summary')?.click()
  return Boolean(details?.open)
})()`)

await capture(output)

const rapport = {
  schema: 'autowin.chat-html-inline-proof/v1',
  capturedAt: new Date().toISOString(),
  productFingerprint,
  port,
  seeded,
  rendu: Boolean(rendu),
  preuve,
  interaction,
  adresseApresClic,
  canari: {
    sante: canaryHealth,
    appelsSante: canaryHealthHits,
    avantClic: canariAvantClic,
    apresClic: { total: networkCanaryHits, ...networkCanaryHitsByType }
  },
  runtimeErrors: runtimeErrors.length,
  capture: output
}
mkdirSync(dirname(proofOutput), { recursive: true })
writeFileSync(proofOutput, JSON.stringify(rapport, null, 2), 'utf8')
console.log(JSON.stringify(rapport))
socket.close()
canaryServer.close()

/*
 * LE VERDICT, CONDITION PAR CONDITION.
 *
 * Chacune porte son NOM : un echec doit dire ce qui a lache, pas « exit 1 ». La journee du
 * 2026-09-06 a montre le prix d'un delai muet — une enquete entiere pour retrouver laquelle des six
 * conditions etait fausse.
 *
 * Le padding du corps de l'application est teste contre 22px, la valeur EXACTE que la fixture
 * poserait si son style fuyait hors du bloc. Nommer la valeur attendue evite un vert de hasard.
 */
const echecs = []
if (!preuve) echecs.push('le bloc html-render n est pas monte dans le fil')
else {
  if (preuve.elements < 10) echecs.push(`rendu trop pauvre : ${preuve.elements} elements`)
  if (!preuve.titre) echecs.push('titre du rendu absent')
  if (preuve.cartes !== 3) echecs.push(`cartes attendues 3, obtenues ${preuve.cartes}`)
  if (!preuve.depliableNatif) echecs.push('le depliable natif n est pas rendu')
  if (preuve.scripts) echecs.push(`${preuve.scripts} script(s) conserve(s) dans le DOM`)
  if (preuve.attributsEvenement) echecs.push(`${preuve.attributsEvenement} attribut(s) on* conserve(s)`)
  if (preuve.iframes) echecs.push(`${preuve.iframes} iframe(s) conservee(s)`)
  if (preuve.metaRefresh) echecs.push('une balise meta a survecu au nettoyage')
  if (preuve.imagesDistantes) echecs.push(`${preuve.imagesDistantes} image(s) distante(s) conservee(s)`)
  if (preuve.liensJavascript) echecs.push(`${preuve.liensJavascript} lien(s) javascript: conserve(s)`)
  if (preuve.liensDistantsNonHarnaches)
    echecs.push(`${preuve.liensDistantsNonHarnaches} lien(s) distant(s) sans target=_blank + rel noopener`)
  if (preuve.scriptExecute !== null) echecs.push('LE SCRIPT DE LA FIXTURE A ETE EXECUTE')
  if (!preuve.styleAppartientAuBloc) echecs.push('la feuille de style du rendu n est pas portee')
  if (!preuve.scopeId) echecs.push('le bloc ne porte pas son identifiant de portee')
  if (preuve.padCorpsApp === '22px') echecs.push('le style du rendu a FUI sur le corps de l application')
  if (preuve.debordement !== null && preuve.debordement > 2)
    echecs.push(`le rendu deborde du fil de ${preuve.debordement}px`)
}
if (interaction !== true) echecs.push('le depliable natif ne s ouvre pas au clic')
if (preuve && adresseApresClic !== preuve.adresseAvantClic)
  echecs.push(`LE CLIC A EMPORTE L APPLICATION : ${preuve.adresseAvantClic} -> ${adresseApresClic}`)
if (!canaryHealth) echecs.push('le serveur canari ne repond pas — la preuve reseau serait muette')
if (canaryHealthHits !== 1) echecs.push(`canari de sante appele ${canaryHealthHits} fois au lieu d une`)
if (canariAvantClic.total !== 0)
  echecs.push(`LE SIMPLE AFFICHAGE A JOINT LE RESEAU : ${JSON.stringify(canariAvantClic)}`)
// Apres le clic, l'image et le meta refresh doivent TOUJOURS etre a zero : eux ne dependent
// d'aucun geste, et rien ne peut les avoir reveilles.
if (networkCanaryHitsByType.image !== 0 || networkCanaryHitsByType.metaRefresh !== 0)
  echecs.push(`chargement automatique declenche : ${JSON.stringify(networkCanaryHitsByType)}`)
if (runtimeErrors.length) echecs.push(`${runtimeErrors.length} erreur(s) JavaScript pendant le rendu`)

if (echecs.length) {
  console.error('\nECHEC :')
  for (const echec of echecs) console.error(`- ${echec}`)
  process.exit(1)
}
console.log('\nOK — le HTML du modele est rendu dans le fil, desarme, et il n a joint personne.')
