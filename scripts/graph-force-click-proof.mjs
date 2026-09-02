/**
 * Preuve de clic dans le graphe Memory en mode NUAGE (le mode d'ouverture par défaut).
 *
 * Pourquoi ce script existe : `ui-capture.mjs --click` ne sait cliquer qu'un sélecteur CSS. Or les
 * points du graphe sont dessinés dans un canvas WebGL : ils n'ont AUCUN élément DOM. Le contrôle
 * final a donc refusé, à juste titre, une capture « après clic » dont rien ne prouvait le clic.
 * Ici on clique de VRAIES coordonnées écran (CDP Input), et on mesure l'effet sur deux signaux
 * lisibles dans le DOM : le compteur « N nœuds mis en évidence · M de contexte » (total de points
 * affichés) et l'apparition du panneau « Détail du nœud ».
 *
 * Verdict machine : sortie 0 seulement si un clic a ouvert une fiche ET que le total de points
 * après ≥ avant. Sortie non nulle nommée sinon — aucun « peut-être » ne passe pour une preuve.
 *
 * Usage : node scripts/graph-force-click-proof.mjs [--out artifacts/graph-force-click.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}

const candidatsDevToolsPort = () => {
  const candidats = []
  if (process.env.AUTOWIN_DATA_DIR)
    candidats.push(resolve(process.env.AUTOWIN_DATA_DIR, 'DevToolsActivePort'))
  let dossier = dirname(fileURLToPath(import.meta.url))
  const racine = parse(dossier).root
  for (;;) {
    candidats.push(resolve(dossier, '.autowin-data/autowin-os/DevToolsActivePort'))
    const parent = dirname(dossier)
    if (dossier === racine || parent === dossier) break
    dossier = parent
  }
  return candidats
}

const decouvrirCible = async () => {
  const ports = []
  const fichier = candidatsDevToolsPort().find((c) => existsSync(c))
  if (fichier) ports.push(readFileSync(fichier, 'utf8').trim().split(/\r?\n/)[0])
  ports.push(process.env.AUTOWIN_CDP_PORT || '9231')
  for (const p of ports) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${p}/json`, {
        signal: AbortSignal.timeout(10_000)
      })
      const cibles = await reponse.json()
      const page = cibles.find((c) => c.type === 'page')
      if (page) return { page, port: String(p) }
    } catch {
      /* port suivant */
    }
  }
  throw new Error(`aucune page Autowin. Ports sondés : ${ports.join(' | ')}`)
}

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms))

const main = async () => {
  const sortie = resolve(argument('--out', 'artifacts/graph-force-click.json'))
  const rendre = (charge, code) => {
    mkdirSync(dirname(sortie), { recursive: true })
    writeFileSync(sortie, JSON.stringify(charge, null, 2), 'utf8')
    console.log(JSON.stringify(charge, null, 2))
    process.exit(code)
  }

  let page
  let port
  try {
    ;({ page, port } = await decouvrirCible())
  } catch (erreur) {
    rendre({ ok: false, echecs: ['cdp-injoignable'], detail: String(erreur) }, 3)
  }

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
      const t = setTimeout(() => (attente.delete(n), ko(new Error(`${methode} expiré`))), 60_000)
      attente.set(n, { ok: (v) => (clearTimeout(t), ok(v)), ko: (e) => (clearTimeout(t), ko(e)) })
      socket.send(JSON.stringify({ id: n, method: methode, params }))
    })
  const evaluer = async (expression) => {
    const r = await envoyer('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }

  await envoyer('Runtime.enable')

  // 1. Se placer sur Memory par le bouton de navigation IDENTIFIÉ (`data-testid="nav-knowledge"`),
  // jamais par une recherche de texte : un `find` sur /memory/i attrape « Clean memory » et déclenche
  // une action que personne n'a demandée. Défaut commis puis corrigé ici même le 2026-09-02.
  const navigation = await evaluer(`(() => {
    const bouton = document.querySelector('[data-testid="nav-knowledge"]')
    if (!bouton) return 'bouton-absent'
    bouton.click()
    return 'clique'
  })()`)
  if (navigation !== 'clique') rendre({ ok: false, echecs: ['nav-knowledge-absent'], port }, 4)
  await dormir(2500)
  const active = await evaluer(`(() => {
    const actif = [...document.querySelectorAll('[data-testid^="nav-"]')].find((b) =>
      b.className.includes('active') || b.getAttribute('aria-current'))
    return actif?.getAttribute('data-testid') ?? null
  })()`)
  if (active !== 'nav-knowledge')
    rendre({ ok: false, echecs: ['destination-inattendue'], destinationActive: active, port }, 4)

  const etat = () =>
    evaluer(`(() => {
      const canvas = document.querySelector('.graph-canvas')
      const zone = canvas?.querySelector('canvas')
      const boite = zone?.getBoundingClientRect()
      const texte = document.body.innerText
      // Lecture SANS expression régulière : les échappements ne survivent pas au transport CDP,
      // et un compteur non lu se déguiserait en « rien à mesurer ».
      const ligne = texte.split(String.fromCharCode(10)).find((l) => l.includes('mis en')) || ''
      const chiffres = []
      let courant = ''
      for (const c of ligne) {
        if (c >= '0' && c <= '9') courant += c
        else if (courant) { chiffres.push(Number(courant)); courant = '' }
      }
      if (courant) chiffres.push(Number(courant))
      const m = chiffres.length >= 2 ? chiffres : null
      return {
        modeArbre: canvas?.dataset.treeVisibleNodes !== undefined,
        points: m ? m[0] + m[1] : null,
        ficheOuverte: texte.includes('Détail du nœud'),
        boite: boite ? { x: boite.x, y: boite.y, w: boite.width, h: boite.height } : null
      }
    })()`)

  let depart = await etat()
  if (depart.modeArbre) {
    // On veut prouver le mode NUAGE : repasser dessus par la vraie bascule si besoin.
    await evaluer(`document.querySelector('[aria-label="Disposition du graphe"]')?.click(), true`)
    await dormir(1500)
    depart = await etat()
  }
  if (depart.modeArbre || !depart.boite || depart.points === null)
    rendre({ ok: false, echecs: ['nuage-non-mesurable'], depart }, 4)

  // 2. Cliquer de VRAIES coordonnées jusqu'à toucher un point du nuage.
  const { x, y, w, h } = depart.boite
  const cibles = []
  for (let cx = 0.2; cx <= 0.8; cx += 0.1)
    for (let cy = 0.2; cy <= 0.8; cy += 0.1) cibles.push([x + w * cx, y + h * cy])

  let touche = null
  let apres = depart
  for (const [px, py] of cibles) {
    const commun = { x: Math.round(px), y: Math.round(py), button: 'left', clickCount: 1 }
    await envoyer('Input.dispatchMouseEvent', { type: 'mouseMoved', ...commun, clickCount: 0 })
    await dormir(120)
    await envoyer('Input.dispatchMouseEvent', { type: 'mousePressed', ...commun })
    await envoyer('Input.dispatchMouseEvent', { type: 'mouseReleased', ...commun })
    await dormir(700)
    apres = await etat()
    if (apres.ficheOuverte) {
      touche = { x: commun.x, y: commun.y }
      break
    }
  }
  if (!touche) rendre({ ok: false, echecs: ['aucun-point-touche'], depart, apres, port }, 5)

  await dormir(1500)
  apres = await etat()
  const ok = apres.points !== null && apres.points >= depart.points
  rendre(
    {
      ok,
      echecs: ok ? [] : ['points-en-baisse'],
      port,
      clic: touche,
      pointsAvant: depart.points,
      pointsApres: apres.points,
      ficheOuverteAvant: depart.ficheOuverte,
      ficheOuverteApres: apres.ficheOuverte,
      preuve: `clic réel en (${touche.x},${touche.y}) sur le nuage : fiche ouverte (« Détail du nœud »), points ${depart.points} → ${apres.points}`
    },
    ok ? 0 : 6
  )
}

main().catch((erreur) => {
  console.log(JSON.stringify({ ok: false, echecs: ['exception'], detail: String(erreur) }, null, 2))
  process.exit(1)
})
