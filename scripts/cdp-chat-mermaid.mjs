/**
 * PREUVE HORS-MODELE : UN BLOC ```mermaid EST REELLEMENT DESSINE DANS LE FIL.
 *
 * Pourquoi cette sonde existe malgre les tests unitaires : ils prouvent que le bloc est RECONNU et
 * confie au bon composant (happy-dom n'a pas de moteur de rendu, mermaid n'y dessine rien). Le juge
 * du 2026-09-13 a pose l'objection exacte : « personne n'a vu le diagramme s'afficher ». C'est ce
 * que mesure ce script, dans le VRAI renderer d'une instance cachee : un <svg> non vide, des noeuds
 * du diagramme, et le repli sur la source quand la syntaxe est fausse.
 *
 * Usage : node scripts/avec-instance-headless.mjs -- node scripts/cdp-chat-mermaid.mjs
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
  argument('--out', 'Audit/headless-instances/chat-mermaid/proof/chat-mermaid.png')
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
const runtimeErrors = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params?.exceptionDetails?.text ?? 'exception')
    return
  }
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
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
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
  'conversation de la fixture'
)

// L'import de mermaid est PARESSEUX : on attend le dessin, jamais une duree fixe.
try {
  await waitFor(
    `Boolean(document.querySelector('[data-testid="chat-inline-mermaid"] svg'))`,
    'diagramme dessine'
  )
} catch (erreur) {
  // Un delai depasse sans etat est une impasse : on dit CE QU'ON VOIT avant de rendre la main.
  const etat = await evaluate(`(() => ({
    conteneurs: document.querySelectorAll('[data-testid="chat-inline-mermaid"]').length,
    htmlRender: document.querySelectorAll('[data-testid="chat-inline-html"]').length,
    blocsCode: [...document.querySelectorAll('pre code')].map((n) => n.textContent.slice(0, 40)),
    placeholder: document.body.innerText.includes('Rendu du diagramme'),
    bulles: document.querySelectorAll('.md').length
  }))()`)
  console.error('ETAT AU MOMENT DU DELAI :', JSON.stringify(etat, null, 2))
  throw erreur
}
await sleep(800)

const preuve = await evaluate(`(() => {
  const blocs = [...document.querySelectorAll('[data-testid="chat-inline-mermaid"]')]
  const dessine = blocs.find((bloc) => bloc.querySelector('svg'))
  const replie = blocs.find((bloc) => !bloc.querySelector('svg'))
  const svg = dessine?.querySelector('svg')
  const boite = svg?.getBoundingClientRect()
  const fil = document.querySelector('.chat-scroll')
  return {
    blocs: blocs.length,
    svgLargeur: boite ? Math.round(boite.width) : 0,
    svgHauteur: boite ? Math.round(boite.height) : 0,
    noeuds: svg ? svg.querySelectorAll('.node, .nodeLabel, g').length : 0,
    textes: svg ? [...svg.querySelectorAll('text, .nodeLabel')].map((n) => n.textContent.trim()).filter(Boolean) : [],
    scripts: dessine ? dessine.querySelectorAll('script').length : 0,
    replieMontreLaSource: replie ? replie.textContent.includes("n'est pas du mermaid") : false,
    replieSansSvg: Boolean(replie),
    // LE DEBORDEMENT SE MESURE CONTRE LE CONTENEUR DU BLOC (.md-mermaid), pas contre le fil : c'est
    // lui qui borne le dessin et porte le defilement horizontal. Mesurer contre .chat-scroll
    // comparait deux boites sans rapport.
    debordement: dessine && boite ? Math.round(boite.right - dessine.getBoundingClientRect().right) : null,
    largeurConteneur: dessine ? Math.round(dessine.getBoundingClientRect().width) : null,
    largeurFil: fil ? Math.round(fil.getBoundingClientRect().width) : null
  }
})()`)

// CAPTURE PAR LA PAGE QUE L'ON VIENT D'INTERROGER. `captureTestPage` passe par la fenetre du
// processus principal et a rendu l'ecran de demarrage alors que le DOM sonde portait deja le
// diagramme : une preuve d'image doit venir de la MEME page que la preuve de DOM.
const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false
})
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
writeFileSync(
  output.replace(/\.png$/i, '.json'),
  JSON.stringify({ seeded, preuve, runtimeErrors }, null, 2)
)
console.log(JSON.stringify(preuve, null, 2))
console.log(`capture: ${output}`)

const echecs = []
if (!seeded) echecs.push('la fixture ne s est pas semee')
if (preuve.blocs < 2) echecs.push(`${preuve.blocs} bloc(s) mermaid dans le fil au lieu de 2`)
if (preuve.svgLargeur < 80 || preuve.svgHauteur < 40)
  echecs.push(`le diagramme est vide ou minuscule (${preuve.svgLargeur}x${preuve.svgHauteur})`)
if (preuve.noeuds < 4)
  echecs.push(`${preuve.noeuds} element(s) dans le SVG — le diagramme n est pas dessine`)
if (!preuve.textes.some((texte) => texte.includes('Message')))
  echecs.push(`les libelles du diagramme sont absents : ${JSON.stringify(preuve.textes)}`)
if (preuve.scripts) echecs.push(`${preuve.scripts} script(s) dans le SVG rendu`)
if (!preuve.replieSansSvg) echecs.push('le diagramme invalide n a pas de repli visible')
if (!preuve.replieMontreLaSource)
  echecs.push('le repli ne montre pas la source du diagramme invalide')
/*
 * DEBORDEMENT : mesure valable SEULEMENT si le conteneur a une largeur reelle. L'instance cachee
 * peut naitre avec un fil de 27 px (mesure du 2026-09-13) ; comparer un dessin de 544 px a une
 * boite de 0 px ne dit rien sur la mise en page. On le DIT plutot que de le faire passer.
 */
if (preuve.largeurConteneur > 200 && preuve.debordement !== null && preuve.debordement > 2)
  echecs.push(`le diagramme deborde de son conteneur de ${preuve.debordement}px`)
else if (!(preuve.largeurConteneur > 200))
  console.log(
    `NOTE — debordement non mesure : conteneur de ${preuve.largeurConteneur}px dans une fenetre cachee de ${preuve.largeurFil}px.`
  )
if (runtimeErrors.length)
  echecs.push(`${runtimeErrors.length} erreur(s) JavaScript pendant le rendu`)

if (echecs.length) {
  console.error('\nECHEC :')
  for (const echec of echecs) console.error(`- ${echec}`)
  process.exit(1)
}
console.log(
  '\nOK — le diagramme mermaid est REELLEMENT dessine dans le fil, et une source invalide retombe sur son texte.'
)
