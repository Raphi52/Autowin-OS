#!/usr/bin/env node
// Vérifie de bout en bout la chaîne Blender MCP sur ce poste (conv-1560, lot 3 du plan conv-1558) :
// 1. lance Blender 5.2 dans un bureau Windows caché (scripts/hdesk-lancer.ps1), jamais sur l'écran
//    de l'utilisateur ; l'add-on blender-mcp (addon.py d'ahujasid/blender-mcp, installé et activé
//    dans les préférences) démarre seul son serveur sur le port 9876 (« Auto-Start Server ») ;
// 2. attend que le port réponde ;
// 3. lance `uvx blender-mcp`, lui parle en client MCP stdio (initialize, tools/list), puis appelle
//    get_scene_info : seul cet appel prouve que le serveur MCP joint VRAIMENT Blender — une liste
//    d'outils se rend même Blender fermé ;
// 4. ferme le bureau caché (scripts/hdesk-fermer.ps1).
//
// Usage : node scripts/blender-mcp-verifier.mjs [--bureau <id>] [--conversation <conv>] [--port 9876]
// Codes : 0 chaîne prouvée · 1 erreur inattendue · 2 lancement de Blender refusé
//         3 port déjà occupé avant lancement (un autre Blender tient le serveur : on ne vérifierait
//           pas le nôtre) · 4 le serveur de l'add-on n'a pas ouvert le port
//         5 `uvx blender-mcp` ne répond pas en MCP · 6 outils attendus absents ou Blender injoignable
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = path.dirname(fileURLToPath(import.meta.url))
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}
const BLENDER = arg('blender', 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe')
const BUREAU = arg('bureau', process.env.AUTOWIN_HDESK_ID || 'blender-mcp-verif')
const CONV = arg('conversation', process.env.AUTOWIN_CONVERSATION_ID || 'blender-mcp-verif')
const PORT = Number(arg('port', '9876'))
const OUTILS_ATTENDUS = ['get_scene_info', 'execute_blender_code']

const rapport = { bureau: BUREAU, port: PORT, etapes: [] }
// fin() lève au lieu de quitter : les blocs finally (fermeture du bureau, arrêt d'uvx) passent d'abord.
class Sortie extends Error {
  constructor(code, msg) {
    super(msg || '')
    this.code = code
  }
}
const fin = (code, erreur) => {
  throw new Sortie(code, erreur)
}
const rendre = (code, erreur) => {
  if (erreur) rapport.erreur = erreur
  rapport.code = code
  console.log(JSON.stringify(rapport, null, 2))
  process.exit(code)
}
const etape = (nom, detail) => rapport.etapes.push({ nom, ...detail })

function portOuvert(port) {
  return new Promise((ok) => {
    const s = net.connect({ host: '127.0.0.1', port })
    s.once('connect', () => {
      s.destroy()
      ok(true)
    })
    s.once('error', () => ok(false))
    s.setTimeout(1000, () => {
      s.destroy()
      ok(false)
    })
  })
}

function powershell(script, args) {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ici, script), ...args],
    {
      encoding: 'utf8',
      // Pas de vérification de mise à jour de l'add-on pendant une preuve : appel réseau inutile.
      env: { ...process.env, AUTOWIN_CONVERSATION_ID: CONV, BLENDERMCP_NO_UPDATE_CHECK: '1' }
    }
  )
  return {
    code: r.status,
    sortie: (r.stdout || '').trim(),
    erreur: (r.stderr || '').trim().slice(-600)
  }
}

function fermerBureau() {
  const r = powershell('hdesk-fermer.ps1', ['-Id', BUREAU, '-Conversation', CONV])
  etape('fermeture', { code: r.code })
}

// Client MCP stdio minimal : JSON-RPC, un message par ligne.
function clientMcp() {
  const proc = spawn('uvx blender-mcp', {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, BLENDER_HOST: '127.0.0.1', BLENDER_PORT: String(PORT) }
  })
  const attente = new Map()
  let tampon = ''
  let journal = ''
  proc.stderr.on('data', (d) => {
    journal = (journal + d).slice(-2000)
  })
  proc.stdout.on('data', (d) => {
    tampon += d
    let i
    while ((i = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, i).trim()
      tampon = tampon.slice(i + 1)
      if (!ligne) continue
      try {
        const msg = JSON.parse(ligne)
        if (msg.id != null && attente.has(msg.id)) {
          attente.get(msg.id)(msg)
          attente.delete(msg.id)
        }
      } catch {
        /* ligne non JSON : ignorée, le journal stderr garde le reste */
      }
    }
  })
  let id = 0
  const requete = (method, params, delaiMs) =>
    new Promise((ok, ko) => {
      const n = ++id
      const t = setTimeout(() => {
        attente.delete(n)
        ko(new Error(`${method} : pas de réponse en ${delaiMs / 1000} s. stderr : ${journal}`))
      }, delaiMs)
      attente.set(n, (m) => {
        clearTimeout(t)
        ok(m)
      })
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
    })
  const notifier = (method) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  const arreter = () => {
    try {
      proc.stdin.end()
    } catch {
      /* déjà fermé */
    }
    if (process.platform === 'win32' && proc.pid)
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'])
    else proc.kill()
  }
  return { requete, notifier, arreter }
}

async function principal() {
  if (await portOuvert(PORT))
    fin(3, `Le port ${PORT} répond déjà avant le lancement : un autre Blender tient le serveur.`)

  const lance = powershell('hdesk-lancer.ps1', [
    '-Id',
    BUREAU,
    '-Executable',
    BLENDER,
    '-Travail',
    'Preuve Blender MCP : serveur de l’add-on + uvx blender-mcp',
    '-AttenteSecondes',
    '60'
  ])
  etape('lancement', { code: lance.code })
  if (lance.code !== 0) fin(2, `hdesk-lancer : code ${lance.code}. ${lance.sortie} ${lance.erreur}`)

  try {
    let ouvert = false
    for (let t = 0; t < 60 && !ouvert; t++) {
      ouvert = await portOuvert(PORT)
      if (!ouvert) await new Promise((r) => setTimeout(r, 1000))
    }
    etape('serveur-addon', { portOuvert: ouvert })
    if (!ouvert)
      fin(
        4,
        `Le serveur de l'add-on n'a pas ouvert le port ${PORT} en 60 s (add-on non activé ou Auto-Start coupé).`
      )

    const mcp = clientMcp()
    try {
      let init
      try {
        // Premier lancement : uvx télécharge le paquet, d'où un délai large.
        init = await mcp.requete(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'autowin-verif', version: '1' }
          },
          180000
        )
      } catch (e) {
        fin(5, e.message)
      }
      mcp.notifier('notifications/initialized')
      etape('initialize', { serveur: init.result?.serverInfo })

      const liste = await mcp.requete('tools/list', {}, 30000)
      const noms = (liste.result?.tools || []).map((t) => t.name)
      etape('tools/list', { nombre: noms.length, outils: noms })
      const manquants = OUTILS_ATTENDUS.filter((n) => !noms.includes(n))
      if (manquants.length) fin(6, `Outils absents : ${manquants.join(', ')}`)

      const scene = await mcp.requete(
        'tools/call',
        { name: 'get_scene_info', arguments: {} },
        60000
      )
      const texte = (scene.result?.content || []).map((c) => c.text || '').join('')
      const enErreur = Boolean(
        scene.error || scene.result?.isError || /error|could not connect/i.test(texte)
      )
      etape('get_scene_info', { enErreur, extrait: texte.slice(0, 200) })
      if (enErreur)
        fin(6, `get_scene_info n'a pas joint Blender : ${texte || JSON.stringify(scene.error)}`)
    } finally {
      mcp.arreter()
    }
  } finally {
    fermerBureau()
  }
}

principal().then(
  () => rendre(0),
  (e) => (e instanceof Sortie ? rendre(e.code, e.message) : rendre(1, e.stack || String(e)))
)
