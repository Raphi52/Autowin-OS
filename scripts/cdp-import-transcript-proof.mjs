/**
 * PREUVE DE L'IMPORT DE TRANSCRIPT (sonde jetable du run « importer SWLG v2 »).
 *
 * Ce qu'elle prouve, sur une instance cachée qui exécute le paquet du dépôt courant :
 *   1. `window.api.conversationsImportSession({id, project})` importe la VRAIE session
 *      (par défaut SWLG v2, 25,5 Mo) et rend {id, title, messageCount, projectPath} ;
 *   2. PAS DE GEL : pendant l'import, le renderer est sondé toutes les ~100 ms ; l'écart maximal
 *      entre deux réponses est mesuré et refusé au-delà de 2 s (un main bloqué fige tout) ;
 *   3. la conversation est ensuite VISIBLE dans la vue chat (titre présent dans le DOM).
 *
 * Usage : node scripts/avec-instance-headless.mjs --instance-id <id> --
 *           node scripts/cdp-import-transcript-proof.mjs [--port <n>]
 *           [--session <id.jsonl sans extension>] [--project <dossier sous ~/.claude/projects>]
 * Sortie : JSON sur stdout, code 0 = prouvé.
 *
 * fix-ok: cause mesurée des reprises — la 1re exécution a TROUVÉ le défaut qu'elle traquait :
 * gel de 2032 ms (urgence 'immediate' = écriture synchrone des 25,5 Mo au journal) ; après le
 * passage du contenu en 'checkpoint' (conversations.ts), re-mesure : écart max 520 ms, exit 0.
 * Les éditions suivantes = paramétrage --session/--project pour rejouer la garantie à la demande.
 */
import { portCdp, urlCiblesCdp } from './cdp-port.mjs'

const lireArg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}

const sessionId = lireArg('--session', '0f1ef9b4-981a-44a7-bc70-809d7e8eb172')
const project = lireArg('--project', 'E--SOURCES-GitLab-Edp-siteslocauxcore')
const port = portCdp()

const pages = await (await fetch(urlCiblesCdp(port))).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error('Page Electron introuvable')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let nextId = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (expression, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timeout: ${expression}`)
}

try {
  await waitFor(`document.readyState === 'complete' && Boolean(window.api)`)

  // L'import part SANS await : la promesse est rangée pour que la sonde de gel tourne PENDANT.
  const lance = await evaluate(`(() => {
    if (!window.api.conversationsImportSession) return 'absent'
    window.__importT0 = performance.now()
    window.__importDone = undefined
    window.api.conversationsImportSession({ id: ${JSON.stringify(sessionId)}, project: ${JSON.stringify(project)} })
      .then((r) => { window.__importDone = { ok: true, r, ms: performance.now() - window.__importT0 } })
      .catch((e) => { window.__importDone = { ok: false, erreur: String(e?.message ?? e) } })
    return 'lance'
  })()`)
  if (lance !== 'lance')
    throw new Error(`conversationsImportSession absent du preload (${String(lance)})`)

  // Sonde de gel : chaque tour d'horloge répond-il ? L'écart max mesure le pire blocage du renderer.
  let ecartMaxMs = 0
  let precedent = Date.now()
  let fini
  const echeance = Date.now() + 120000
  for (;;) {
    fini = await evaluate('window.__importDone')
    const maintenant = Date.now()
    ecartMaxMs = Math.max(ecartMaxMs, maintenant - precedent)
    precedent = maintenant
    if (fini) break
    if (maintenant > echeance) throw new Error('Import non terminé après 120 s')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!fini.ok) throw new Error(`Import rejeté : ${fini.erreur}`)
  if (!fini.r?.messageCount || fini.r.messageCount <= 0)
    throw new Error(`Import sans message : ${JSON.stringify(fini.r)}`)
  if (ecartMaxMs > 2000)
    throw new Error(`Gel détecté : ${ecartMaxMs} ms sans réponse du renderer pendant l'import`)

  // Visible dans le chat : on navigue par la pastille (les libellés changent, pas les testids).
  const navigue = await evaluate(`(() => {
    const bouton = document.querySelector('[data-testid="nav-chat"]')
    bouton?.click()
    return Boolean(bouton)
  })()`)
  if (!navigue) throw new Error('Navigation chat introuvable')
  // Le rendu HTML REPLIE les espaces multiples (le titre réel porte « v2  : », l'écran montre
  // « v2 : ») : la comparaison se fait donc à blancs normalisés des deux côtés.
  const titre = JSON.stringify(String(fini.r.title).replace(/\s+/g, ' '))
  await waitFor(`document.body.innerText.replace(/\\s+/g, ' ').includes(${titre})`, 20000)

  console.log(
    JSON.stringify({
      status: 'valid',
      session: sessionId,
      project,
      resultat: fini.r,
      dureeImportMs: Math.round(fini.ms),
      ecartMaxRendererMs: ecartMaxMs,
      titreVisibleDansChat: true
    })
  )
  process.exit(0)
} finally {
  socket.close()
}
