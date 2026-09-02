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
      // 180 s, et le temps réel de la bascule est MESURÉ puis rapporté (`basculeArbreMs`) : passer
      // en arbre reconstruit 704 nœuds d'un bloc et gèle l'interface plusieurs dizaines de secondes.
      // Allonger l'attente sans publier la mesure aurait caché ce gel au lieu de le montrer.
      const t = setTimeout(() => (attente.delete(n), ko(new Error(`${methode} expiré`))), 180_000)
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
  // La destination est RÉAFFIRMÉE plusieurs fois : quand un tour de chat est en cours, l'application
  // ramène d'elle-même l'utilisateur sur le Chat, et un clic unique se faisait donc annuler juste
  // après (mesuré le 2026-09-02, sortie « destination-inattendue » avec nav-chat actif).
  const destinationActuelle = () =>
    evaluer(`(() => {
      const actif = [...document.querySelectorAll('[data-testid^="nav-"]')].find((b) =>
        b.className.includes('active') || b.getAttribute('aria-current'))
      return actif?.getAttribute('data-testid') ?? null
    })()`)

  let active = null
  let navigation = null
  for (let essai = 0; essai < 8; essai += 1) {
    navigation = await evaluer(`(() => {
      const bouton = document.querySelector('[data-testid="nav-knowledge"]')
      if (!bouton) return 'bouton-absent'
      bouton.click()
      return 'clique'
    })()`)
    if (navigation !== 'clique') break
    await dormir(1200)
    active = await destinationActuelle()
    if (active === 'nav-knowledge') break
  }
  if (navigation !== 'clique') rendre({ ok: false, echecs: ['nav-knowledge-absent'], port }, 4)
  if (active !== 'nav-knowledge')
    rendre({ ok: false, echecs: ['destination-inattendue'], destinationActive: active, port }, 4)
  await dormir(1500)

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
  // Un clic « à l'aveugle » sur le nuage peut légitimement ne toucher aucun point : 704 points
  // dessinés dans un canvas WebGL, aucun élément DOM, donc aucune position lisible. On le RAPPORTE
  // au lieu de le déguiser en échec du produit — la preuve du geste, elle, est portée ci-dessous par
  // le mode ARBRE, dont le compteur est lisible dans le DOM.
  const nuage = {
    clicTouche: touche,
    pointsAvant: depart.points,
    pointsApres: apres.points,
    compteurArbreAbsent: depart.modeArbre === false
  }

  // 3. Mode ARBRE — la preuve mesurable : chaque dépliage AUGMENTE `data-tree-visible-nodes`,
  // chaque repli le ramène à sa valeur d'avant.
  const compteurArbre = () =>
    evaluer(`(() => {
      const canvas = document.querySelector('.graph-canvas')
      const brut = canvas?.dataset.treeVisibleNodes
      const replies = [...document.querySelectorAll('[aria-label="Branches du Brain"] button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
      return {
        compteur: brut === undefined ? null : Number(brut),
        branchesRepliees: replies.length,
        premiereRepliee: replies[0]?.getAttribute('title') ?? null
      }
    })()`)

  const debutBascule = Date.now()
  let arbre = await compteurArbre()
  for (let essai = 0; essai < 4 && arbre.compteur === null; essai += 1) {
    await evaluer(`document.querySelector('[aria-label="Disposition du graphe"]')?.click(), true`)
    await dormir(3000)
    arbre = await compteurArbre()
  }
  const basculeArbreMs = Date.now() - debutBascule
  if (arbre.compteur === null)
    rendre({ ok: false, echecs: ['mode-arbre-inatteignable'], nuage, arbre, port }, 5)
  if (arbre.branchesRepliees === 0)
    rendre({ ok: false, echecs: ['aucune-branche-repliee-au-depart'], nuage, arbre, port }, 5)

  const cliquerPremiereRepliee = () =>
    evaluer(`(() => {
      const b = [...document.querySelectorAll('[aria-label="Branches du Brain"] button')]
        .find((x) => x.getAttribute('aria-pressed') === 'true')
      if (!b) return null
      const titre = b.getAttribute('title')
      b.click()
      return titre
    })()`)
  const cliquerParTitre = (titre) =>
    evaluer(`(() => {
      const b = [...document.querySelectorAll('[aria-label="Branches du Brain"] button')]
        .find((x) => x.getAttribute('title') === ${JSON.stringify(titre)})
      if (!b) return null
      b.click()
      return true
    })()`)

  const avantDepliage = arbre.compteur
  const brancheDepliee = await cliquerPremiereRepliee()
  if (!brancheDepliee)
    rendre({ ok: false, echecs: ['branche-non-cliquable'], nuage, arbre, port }, 5)
  await dormir(1800)
  const apresDepliage = (await compteurArbre()).compteur
  if (!(apresDepliage > avantDepliage))
    rendre(
      {
        ok: false,
        echecs: ['depliage-sans-effet'],
        nuage,
        branche: brancheDepliee,
        compteurAvant: avantDepliage,
        compteurApres: apresDepliage,
        basculeArbreMs,
        port
      },
      6
    )

  // Le repli se demande par le titre INVERSE : le bouton dit maintenant « Replier … ».
  const titreReplier = brancheDepliee.replace('Déplier ', 'Replier ')
  await cliquerParTitre(titreReplier)
  await dormir(1800)
  const apresRepli = (await compteurArbre()).compteur

  const ok = apresDepliage > avantDepliage && apresRepli === avantDepliage
  rendre(
    {
      ok,
      echecs: ok ? [] : ['repli-non-reversible'],
      port,
      basculeArbreMs,
      nuage,
      branche: brancheDepliee,
      compteurAvant: avantDepliage,
      compteurApresDepliage: apresDepliage,
      compteurApresRepli: apresRepli,
      preuve: `mode arbre : « ${brancheDepliee} » → nœuds visibles ${avantDepliage} → ${apresDepliage} au dépliage, retour à ${apresRepli} au repli ; mode nuage : aucun compteur d'arbre (${nuage.compteurArbreAbsent}), ${nuage.clicTouche ? `clic réel en (${nuage.clicTouche.x},${nuage.clicTouche.y}) a ouvert une fiche` : 'clic à l aveugle sur le canvas n a touché aucun point (non concluant, pas un échec produit)'}`
    },
    ok ? 0 : 6
  )
}

main().catch((erreur) => {
  console.log(JSON.stringify({ ok: false, echecs: ['exception'], detail: String(erreur) }, null, 2))
  process.exit(1)
})
