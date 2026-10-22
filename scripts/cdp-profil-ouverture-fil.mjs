/**
 * PROFIL CPU DE L'OUVERTURE D'UN FIL — reproduire et NOMMER un gel `renderer:vue-chat-fil`.
 *
 * Pourquoi (conv-1055, 2026-10-22) : ces gels n'ont jamais de pile — c'est le Profiler React de la
 * vue chat qui les écrit (VueMesuree.tsx), pas une entrée-sortie instrumentée. `banc-gel.mjs` ouvre
 * une VUE, pas une conversation. Cette sonde ouvre UNE conversation longue, depuis « nouvelle
 * conversation », avec le profileur CPU de Chrome allumé, et classe les fonctions par temps propre.
 * Sous `--code-dev`, l'interface vient du serveur de dev : les URL du profil sont les sources.
 *
 * Usage : node scripts/cdp-profil-ouverture-fil.mjs --conversation <id> [--essais 3]
 *              [--out <rapport.json>] [--top 25]
 * Sans `--port`, la sonde se lance ELLE-MÊME dans une instance cachée dédiée (`profil-fil-<pid>`) :
 * elle y copie la conversation (`semer-conversation.mjs`, sans tours ni runs à reprendre), joue
 * l'ouverture par `avec-instance-headless.mjs --code-dev`, puis efface l'instance et sa copie.
 * Jamais dans l'app ouverte de l'utilisateur. Sortie 0 = profils rendus ; 2 = conversation absente ;
 * 3 = page introuvable.
 *
 * Premier usage (conv-1055, conv-826, 100 bulles, mode dev). LIRE AVANT DE CONCLURE : la mise en
 * page du fil entier coûte ~0,7 à 0,8 s, et c'est la PREMIÈRE fonction qui la lit qui la paie.
 * `FilDePensee.mesurer` (ThinkingBlock.tsx) la payait (818 ms) ; ne plus mesurer les blocs pliés l'a
 * fait passer à `ajusterALaLargeur` (690 à 770 ms) : gain net nul sur cet arbre. Le correctif ne
 * paie que contre la CASCADE — un code qui salit la mise en page entre deux lectures : sur un état
 * intermédiaire de la carte du fil (conv-1059), 4,6 à 5,3 s dans `mesurer` et une tâche de
 * 1 002 ms, ramenés à 0. Comparer toujours avant/après sur le MÊME arbre, cible vérifiée.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { racineDepot } from './racine-depot.mjs'
import { racineDonneesInstance, semerConversation } from './semer-conversation.mjs'

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = argument('--port')
const conversation = argument('--conversation')
const essais = Number(argument('--essais', 3))
const top = Number(argument('--top', 25))
const sortie = resolve(argument('--out', 'Audit/cdp/profil-ouverture-fil.json'))
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

/** Temps PROPRE par fonction (fichier:ligne) et par fichier, à partir d'un profil CDP. Pure. */
export function classerProfil(profil, { racineUrl = /^https?:\/\/[^/]+\// } = {}) {
  const noeuds = new Map(profil.nodes.map((n) => [n.id, n]))
  const propre = new Map()
  for (let i = 0; i < profil.samples.length; i += 1) {
    const ms = (profil.timeDeltas[i] ?? 0) / 1000
    propre.set(profil.samples[i], (propre.get(profil.samples[i]) ?? 0) + ms)
  }
  const parFonction = new Map()
  const parFichier = new Map()
  let totalMs = 0
  for (const [id, ms] of propre) {
    const cadre = noeuds.get(id)?.callFrame
    if (!cadre) continue
    totalMs += ms
    const fichier = (cadre.url || `(${cadre.functionName || 'natif'})`)
      .replace(racineUrl, '')
      .replace(/\?.*$/, '')
    const fonction = `${cadre.functionName || '(anonyme)'} ${fichier}:${cadre.lineNumber + 1}`
    parFonction.set(fonction, (parFonction.get(fonction) ?? 0) + ms)
    parFichier.set(fichier, (parFichier.get(fichier) ?? 0) + ms)
  }
  const trier = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nom, ms]) => ({ nom, ms: Math.round(ms) }))
  return {
    totalMs: Math.round(totalMs),
    parFonction: trier(parFonction),
    parFichier: trier(parFichier)
  }
}

/**
 * Sans port : copier la conversation dans une instance cachée neuve, s'y relancer, tout effacer.
 * L'instance est à nous seuls (identifiant au pid) : son dossier entier part après la mesure.
 */
function lancerDansUneInstanceCachee() {
  const racine = racineDepot()
  const instanceId = `profil-fil-${process.pid}`
  const destination = racineDonneesInstance(racine, instanceId)
  const semence = semerConversation({
    source: resolve(racine, '.autowin-data', 'autowin-os'),
    destination,
    id: conversation
  })
  if (!semence.ok) {
    console.error(`copie impossible : ${semence.echec}`)
    return 2
  }
  const ici = fileURLToPath(import.meta.url)
  try {
    const r = spawnSync(
      process.execPath,
      [
        resolve(dirname(ici), 'avec-instance-headless.mjs'),
        '--instance-id',
        instanceId,
        '--code-dev',
        '--',
        process.execPath,
        ici,
        ...process.argv.slice(2)
      ],
      { stdio: 'inherit', windowsHide: true }
    )
    return r.status ?? 1
  } finally {
    // `<instance>/user-data/app-data/autowin-os` → on efface `<instance>` : profil ET copie.
    rmSync(resolve(destination, '..', '..', '..'), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500
    })
  }
}

async function principal() {
  if (!conversation) {
    console.error('Usage : --conversation <id> [--essais 3] [--out <rapport.json>]')
    return 2
  }
  if (!port) return lancerDansUneInstanceCachee()
  const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) return 3
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const attentes = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    attentes.get(m.id)?.(m)
    attentes.delete(m.id)
  })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  const cdp = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id
      attentes.set(n, res)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const evaluer = async (expression) =>
    (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result
      ?.result?.value

  // La vue chat, puis la liste des conversations rendue.
  for (let i = 0; i < 60; i += 1) {
    const pret = await evaluer(`(() => {
      const nav = document.querySelector('[data-testid="nav-chat"]')
      if (nav && !document.querySelector('.conv-new-row')) nav.click()
      return Boolean(document.querySelector('.conv-new-row'))
    })()`)
    if (pret) break
    await attendre(500)
  }
  // La ligne de la liste ne porte pas d'identifiant : la sonde ne vise que l'UNIQUE conversation de
  // son instance, et vérifie après chaque clic que c'est bien elle qui s'est ouverte (revue de
  // conv-1055 : profiler une autre conversation sous le nom demandé serait une fausse preuve).
  let lignes = 0
  for (let i = 0; i < 60 && lignes === 0; i += 1) {
    lignes = (await evaluer(`document.querySelectorAll('.conv-item').length`)) ?? 0
    if (lignes === 0) await attendre(250)
  }
  // L'instance crée aussi sa propre conversation au démarrage : on essaie chaque ligne jusqu'à ce
  // que l'app AFFICHE celle demandée (`data-active-conversation-id`).
  const affichee = () =>
    evaluer(
      `document.querySelector('[data-active-conversation-id]')?.getAttribute('data-active-conversation-id') ?? null`
    )
  let titre = null
  for (let rang = 0; rang < lignes && !titre; rang += 1) {
    await evaluer(`document.querySelectorAll('.conv-item .conv-pick')[${rang}]?.click()`)
    for (let i = 0; i < 12; i += 1) {
      await attendre(250)
      if ((await affichee()) === conversation) {
        titre = await evaluer(
          `document.querySelectorAll('.conv-item')[${rang}]?.querySelector('.conv-label')?.textContent ?? null`
        )
        break
      }
    }
  }
  if (!titre) {
    console.error(`conversation ${conversation} introuvable parmi les ${lignes} de la liste`)
    return 2
  }
  await cdp('Profiler.enable')
  await cdp('Profiler.setSamplingInterval', { interval: 200 })
  const resultats = []
  for (let essai = 1; essai <= essais; essai += 1) {
    // Départ : « nouvelle conversation », fil vide — l'ouverture mesurée est donc complète.
    await evaluer(`document.querySelector('.conv-new-row')?.click()`)
    await attendre(1_500)
    // Tâches longues et retard de boucle pendant l'ouverture, mesurés DANS la page.
    await evaluer(`(() => {
      window.__sondeFil = { longues: [], debut: performance.now() }
      window.__sondeFilObs?.disconnect()
      window.__sondeFilObs = new PerformanceObserver((liste) => {
        for (const e of liste.getEntries()) window.__sondeFil.longues.push(Math.round(e.duration))
      })
      window.__sondeFilObs.observe({ type: 'longtask', buffered: false })
      return true
    })()`)
    await cdp('Profiler.start')
    const debut = Date.now()
    await evaluer(`(() => {
      const item = [...document.querySelectorAll('.conv-item')].find(
        (e) => e.querySelector('.conv-label')?.textContent === ${JSON.stringify(titre)}
      )
      item?.querySelector('.conv-pick')?.click()
      return Boolean(item)
    })()`)
    // Le fil est rendu quand son nombre de bulles ne bouge plus depuis 2 s : il se rend par
    // tranches (fil-progressif.ts), un délai fixe comparerait deux ouvertures inégalement avancées.
    let bulles = 0
    let stable = 0
    while (Date.now() - debut < 30_000 && stable < 8) {
      await attendre(250)
      const n = (await evaluer(`document.querySelectorAll('.msg').length`)) ?? 0
      stable = n > 0 && n === bulles ? stable + 1 : 0
      bulles = n
    }
    const { profile } = (await cdp('Profiler.stop')).result
    const ouverte = await evaluer(
      `document.querySelector('[data-active-conversation-id]')?.getAttribute('data-active-conversation-id') ?? null`
    )
    if (ouverte !== conversation) {
      console.error(
        `ouverture de ${conversation} non constatée (conversation affichée : ${ouverte})`
      )
      ws.close()
      return 2
    }
    const mesure = await evaluer(`window.__sondeFil`)
    const classe = classerProfil(profile)
    resultats.push({
      essai,
      bulles,
      tachesLongues: mesure?.longues ?? [],
      cpuMs: classe.totalMs,
      parFichier: classe.parFichier.slice(0, top),
      parFonction: classe.parFonction.slice(0, top)
    })
    console.log(
      `essai ${essai} : ${bulles} bulles, tâches longues ${JSON.stringify(mesure?.longues ?? [])} ms, CPU ${classe.totalMs} ms`
    )
    for (const f of classe.parFichier.slice(0, 8)) console.log(`   fichier ${f.ms} ms  ${f.nom}`)
    for (const f of classe.parFonction.slice(0, 12)) console.log(`   fonction ${f.ms} ms  ${f.nom}`)
  }
  mkdirSync(dirname(sortie), { recursive: true })
  writeFileSync(sortie, JSON.stringify({ conversation, titre, resultats }, null, 2))
  console.log(`rapport : ${sortie}`)
  ws.close()
  return 0
}

if (process.argv[1]?.endsWith('cdp-profil-ouverture-fil.mjs')) {
  principal().then(
    (code) => process.exit(code),
    (erreur) => {
      console.error(erreur)
      process.exit(1)
    }
  )
}
