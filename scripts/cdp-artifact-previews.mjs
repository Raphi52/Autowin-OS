import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { portCdp } from './cdp-port.mjs'
/*
 * PAS BRANCHEE SUR build:desktop — ELLE N'EST VERTE QU'AU SECOND PASSAGE (mesure du 2026-09-06).
 *
 * Sur une instance neuve, mesure faite deux fois de suite sur la MEME application : premier
 * passage ROUGE, second VERT. L'etat observe au premier passage est sans ambiguite — cinq cartes
 * montees, aucune repliee, diagramme, markdown, tableau et 3D presents, et `image: false` : la
 * carte VECTEUR ne rend aucun <img>. Le produit ne construit l'apercu que si l'artefact porte son
 * contenu en ligne (ArtifactPreview.tsx, `inlineDataUrl`), et ce contenu n'est pas encore la juste
 * apres la premiere semence.
 *
 * C'est peut-etre un vrai defaut vecu — « je viens de generer un SVG et je ne le vois pas » — mais
 * ce n'est pas etabli, et brancher une preuve qui echoue une fois sur deux ne prouverait rien : ce
 * serait un rouge intermittent de plus, la chose la plus couteuse a diagnostiquer.
 *
 * Ce qui a ete repare ici, et qui tient : la resolution du port, le DEPLIAGE des cartes (les
 * apercus d'image s'ouvrent desormais replies, l'<img> n'existe pas avant le clic), et le delai
 * qui DIT desormais quel rendu manque au lieu d'un « delai depasse » muet.
 */


const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
// Resolution COMMUNE du port : --port, puis AUTOWIN_CDP_PORT, puis le port REEL de l'instance
// ouverte. Le 9257 code en dur ne repondait a personne des que l'instance en prenait un autre.
const port = portCdp()
const productFingerprint = argument('--fingerprint', 'unbound')
const output = resolve(
  argument('--out', 'Audit/headless-instances/artifact-previews/artifact-previews.png')
)
const topOutput = output.replace(/\.png$/i, '-top.png')
const proofOutput = output.replace(/\.png$/i, '.json')
mkdirSync(dirname(output), { recursive: true })

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitForPage() {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // L'instance Electron est encore en train de démarrer.
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
  /*
   * UN DELAI QUI NE DIT PAS CE QUI MANQUE COUTE UNE ENQUETE ENTIERE.
   *
   * Mesure du 2026-09-06 : « Delai depasse: rendus d'artefacts » a fait chercher a la main, carte
   * par carte, laquelle des six conditions etait fausse. L'etat des cartes est ici, gratuit : on
   * le JOINT au message.
   */
  const etat = await evaluate(`(() => {
    const cartes = [...document.querySelectorAll('.artifact-preview')]
    return JSON.stringify({
      cartes: cartes.length,
      types: cartes.map((c) => c.dataset.artifactKind),
      replies: cartes.filter((c) => c.querySelector('.artifact-preview__toggle[aria-expanded="false"]')).length,
      enChargement: document.body.textContent.includes('Chargement de l’aperçu'),
      diagramme: Boolean(document.querySelector('.artifact-diagram svg')),
      image: Boolean(document.querySelector('.artifact-preview__image')),
      markdown: Boolean(document.querySelector('.artifact-preview .brain-markdown h2')),
      tableau: Boolean(document.querySelector('.artifact-preview table')),
      model3d: Boolean(document.querySelector('.artifact-model3d canvas'))
    })
  })()`).catch(() => 'etat illisible')
  throw new Error(`Délai dépassé: ${label} — état observé : ${etat}`)
}

await send('Runtime.enable')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run'
)
const seeded = await evaluate(`window.api.seedArtifactPreviewsTest()`)
await send('Page.reload', { ignoreCache: true })
await waitFor(`document.readyState === 'complete'`, 'rechargement')
await sleep(1_500)
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run après rechargement'
)
await evaluate(`document.querySelector('[data-testid="nav-chat"]')?.click()`)
await waitFor(
  `(() => {
    const target = [...document.querySelectorAll('.conv-item')]
      .find((item) => item.querySelector('.conv-label')?.textContent === 'Galerie · artefacts modèles')
    target?.querySelector('.conv-pick')?.click()
    return Boolean(target)
  })()`,
  'conversation de galerie'
)
await waitFor(
  `document.querySelectorAll('.artifact-preview').length === 5`,
  'montage des cartes artefact'
)
/*
 * ON DEPLIE CE QUI EST REPLIE.
 *
 * Mesure du 2026-09-06 : les apercus d'image et de vecteur s'ouvrent desormais REPLIES
 * (ArtifactPreview.tsx : `isCollapsible` pour ces deux types). Le `<img>` n'est donc pas dans le
 * DOM tant que personne n'a clique « Deplier », et cette sonde attendait 30 s un element que le
 * produit ne rendait pas encore — puis accusait le rendu. Elle deplie maintenant, comme le
 * lecteur le ferait.
 */
/*
 * CAUSE ELUCIDEE LE 2026-09-06 : L'APERCU EST CHARGE A L'APPROCHE, ET IL FAUT LA CARTE DEPLIEE.
 *
 * Le contenu de l'artefact n'est PAS dans le message : il est ecrit sur le DISQUE, et la carte ne
 * le lit que lorsqu'elle s'approche du champ de vision. Le produit le dit lui-meme, en toutes
 * lettres, dans la carte : « Apercu charge a l'approche ». Deux conditions, donc, et la sonde n'en
 * respectait aucune de facon durable :
 *   · la carte doit etre DEPLIEE — les apercus d'image s'ouvrent replies ;
 *   · elle doit etre PRES DU CHAMP au moment de la mesure. Or le fil redescend tout seul apres le
 *     parcours : au moment de l'assertion, la carte vecteur etait remontee a -1072 px, hors champ,
 *     et affichait encore son texte d'attente. D'ou un rouge qui semblait aleatoire (« verte au
 *     second passage ») alors qu'il ne dependait que de la position finale du fil.
 *
 * Ce n'est donc PAS un defaut du produit : le chargement paresseux est voulu et documente a
 * l'ecran. Verifie au passage : l'observateur de visibilite fonctionne bien dans une instance de
 * test masquee (callback tire, document.visibilityState = "visible"), et readChatArtifact rend bien
 * le contenu avec son encodage base64.
 *
 * La sonde AMENE donc chaque carte au champ ET la deplie, en boucle, jusqu'a ce que les cinq rendus
 * soient la — borne par un plafond de TEMPS, jamais par un nombre d'essais.
 */
{
  const echeance = Date.now() + 30_000
  for (;;) {
    const pret = await evaluate(`(() => {
      const cartes = [...document.querySelectorAll('.artifact-preview')]
      // 1. deplier ce qui est replie : un corps replie ne rend rien.
      for (const bouton of document.querySelectorAll('.artifact-preview__toggle[aria-expanded="false"]'))
        bouton.click()
      // 2. amener au champ la premiere carte dont le rendu manque encore.
      const manquante = cartes.find((carte) => {
        const type = carte.dataset.artifactKind
        if (type === 'vector' || type === 'image') return !carte.querySelector('img')
        if (type === 'diagram') return !carte.querySelector('.artifact-diagram svg')
        if (type === 'markdown') return !carte.querySelector('.brain-markdown')
        if (type === 'table') return !carte.querySelector('table')
        if (type === 'model3d') return !carte.querySelector('canvas')
        return false
      })
      if (manquante) {
        manquante.scrollIntoView({ block: 'center', behavior: 'instant' })
        return false
      }
      return true
    })()`)
    if (pret) break
    if (Date.now() >= echeance) break
    await sleep(300)
  }
}
await evaluate(`(async () => {
  const scroll = document.querySelector('.chat-scroll')
  if (!scroll) return false
  await new Promise((resolve) => setTimeout(resolve, 500))
  for (const card of document.querySelectorAll('.artifact-preview')) {
    card.scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise((resolve) => setTimeout(resolve, 650))
  }
  return true
})()`)
const proof = await waitFor(
  `(() => {
    const cards = [...document.querySelectorAll('.artifact-preview')]
    const kinds = cards.map((card) => card.getAttribute('data-artifact-kind'))
    const loaded = !document.body.textContent.includes('Chargement de l’aperçu')
    const diagram = document.querySelector('.artifact-diagram svg')
    const image = document.querySelector('.artifact-preview__image')
    const markdown = document.querySelector('.artifact-preview .brain-markdown h2')
    const table = document.querySelector('.artifact-preview table')
    const model3d = document.querySelector('.artifact-model3d canvas')
    if (cards.length !== 5 || !loaded || !diagram || !image || !markdown || !table || !model3d)
      return null
    return {
      cardCount: cards.length,
      kinds,
      diagramSecurity: document.querySelector('.artifact-diagram')?.dataset.diagramSecurity,
      diagramNodes: diagram.querySelectorAll('g.node').length,
      imageDataUrl: image.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'),
      markdownTitle: markdown.textContent,
      tableText: table.textContent,
      model3dCanvas: true,
      loadingCards: document.querySelectorAll('.artifact-preview [role="status"]').length,
      blockedCards: document.querySelectorAll('.artifact-preview__blocked').length
    }
  })()`,
  'rendus d’artefacts'
)
await evaluate(`window.api.setZoomFactor(0.7)`)
await sleep(300)
const topScreenshot = await evaluate(`(async () => {
  document.querySelector('.chat-scroll')?.scrollTo({ top: 0, behavior: 'instant' })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  return window.api.captureTestPage()
})()`)
writeFileSync(topOutput, Buffer.from(topScreenshot, 'base64'))
const visual = await evaluate(`(() => {
  const scroll = document.querySelector('.chat-scroll')
  scroll?.scrollTo({ top: scroll.scrollHeight, behavior: 'instant' })
  return {
    scrollHeight: scroll?.scrollHeight,
    clientHeight: scroll?.clientHeight,
    cardRects: [...document.querySelectorAll('.artifact-preview')].map((card) => {
      const rect = card.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height }
    })
  }
})()`)
await sleep(300)
const screenshot = await evaluate(`(async () => {
  document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return window.api.captureTestPage()
})()`)
writeFileSync(output, Buffer.from(screenshot, 'base64'))
const cleanedConversationIds = await evaluate(`(async () => {
  const fixtures = (await window.api.conversations())
    .filter((conversation) => conversation.title === 'Galerie · artefacts modèles')
    .map((conversation) => conversation.id)
  for (const id of fixtures) await window.api.conversationsRemove(id)
  return fixtures
})()`)

const result = {
  capturedAt: new Date().toISOString(),
  productFingerprint,
  port,
  seeded,
  output,
  topOutput,
  proof,
  visual,
  cleanedConversationIds,
  runtimeErrors: runtimeErrors.length
}
writeFileSync(proofOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
socket.close()

if (
  proof.cardCount !== 5 ||
  proof.diagramSecurity !== 'strict' ||
  !proof.imageDataUrl ||
  !proof.model3dCanvas ||
  proof.markdownTitle !== 'Livraison vérifiée' ||
  proof.loadingCards !== 0 ||
  proof.blockedCards !== 0 ||
  runtimeErrors.length
)
  process.exit(1)
