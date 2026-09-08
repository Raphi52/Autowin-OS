/**
 * PILOTAGE DU GRAPHE 3D DEPUIS L'EXTERIEUR (developpement).
 *
 * Remplace le balayage du canvas point par point : s'appuie sur la poignee posee par
 * src/renderer/src/components/graph-sonde.ts pour lister les noeuds RENDUS, obtenir la position
 * ECRAN de l'un d'eux, et l'ouvrir par le meme chemin que le clic.
 *
 * Usage :
 *   node scripts/cdp-graphe.mjs lister [n]
 *   node scripts/cdp-graphe.mjs situer <idNoeud>
 *   node scripts/cdp-graphe.mjs ouvrir <idNoeud>
 *   node scripts/cdp-graphe.mjs clic  <idNoeud>   (vrai clic souris aux coordonnees du noeud)
 */
import { readFileSync } from 'node:fs'
import { WebSocket } from 'ws'

const port = readFileSync('.autowin-data/autowin-os/DevToolsActivePort', 'utf8').split('\n')[0].trim()

async function cible() {
  const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('aucune page trouvee sur le port ' + port)
  return page.webSocketDebuggerUrl
}

function session(url) {
  const ws = new WebSocket(url)
  let id = 0
  const attentes = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    const at = attentes.get(msg.id)
    if (at) {
      attentes.delete(msg.id)
      msg.error ? at.rej(new Error(JSON.stringify(msg.error))) : at.res(msg.result)
    }
  })
  const pret = new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  return {
    pret,
    envoyer: (method, params = {}) =>
      new Promise((res, rej) => {
        const n = ++id
        attentes.set(n, { res, rej })
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    fermer: () => ws.close()
  }
}

const evaluer = async (s, expression) => {
  const r = await s.envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

const SONDE = "window.__autowinSondeGraphe"

async function main() {
  const [commande, argument] = process.argv.slice(2)
  const s = session(await cible())
  await s.pret
  const presente = await evaluer(s, `Boolean(${SONDE})`)
  if (!presente) {
    console.error("poignee absente : ouvre l'onglet Knowledge et attends le rendu du graphe")
    s.fermer()
    process.exitCode = 2
    return
  }
  if (commande === 'lister') {
    const n = Number(argument ?? 20)
    const noeuds = await evaluer(s, `${SONDE}.noeuds()`)
    console.log(JSON.stringify({ total: noeuds.length, premiers: noeuds.slice(0, n) }, null, 2))
  } else if (commande === 'situer') {
    console.log(JSON.stringify(await evaluer(s, `${SONDE}.positionEcran(${JSON.stringify(argument)})`)))
  } else if (commande === 'ouvrir') {
    console.log(JSON.stringify(await evaluer(s, `${SONDE}.ouvrir(${JSON.stringify(argument)})`)))
  } else if (commande === 'clic') {
    const p = await evaluer(s, `${SONDE}.positionEcran(${JSON.stringify(argument)})`)
    if (!p) {
      console.error('noeud hors champ ou inconnu : impossible de le viser')
      process.exitCode = 3
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await s.envoyer('Input.dispatchMouseEvent', {
          type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1
        })
      }
      console.log(JSON.stringify({ clique: argument, ...p }))
    }
  } else {
    console.error('commandes : lister | situer <id> | ouvrir <id> | clic <id>')
    process.exitCode = 1
  }
  s.fermer()
}

main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
