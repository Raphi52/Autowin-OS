/**
 * Harnais de capture UI destiné aux phases BUILD/CLEAN, appelable en UNE commande depuis Bash.
 *
 * Pourquoi il existe : mesuré le 2026-08-12, le juge exigeait « une preuve UI live sur un binaire
 * packagé frais » et « la capture/CDP de l'application réelle » alors que le producteur in-app n'a
 * que Read/Grep/Glob + Bash/Edit/Write. Il réclamait donc une preuve que personne ne pouvait
 * produire. Plutôt que d'abaisser l'exigence du juge, on met la preuve à portée du producteur.
 *
 * Pourquoi PAS une extension de `autowin-cdp-proof.mjs` : celui-ci balaie les destinations
 * canoniques avec vérifications de thème sur une instance headless dédiée. Ici il faut l'inverse —
 * UNE vue, sur l'app réellement ouverte, avec un verdict machine et un code de sortie.
 *
 * CONTRAT ANTI-FAUX-VERT — la capture n'est déclarée valide QUE si, dans l'ordre :
 *   1. le CDP répond et une page Autowin existe ;
 *   2. la vue demandée est un identifiant connu de `APP_DESTINATIONS` ;
 *   3. après navigation, la destination ACTIVE est bien celle demandée ;
 *   4. la vue rend un contenu non trivial (texte + éléments au-dessus des seuils) ;
 *   5. le PNG écrit sur disque dépasse la taille d'une image vide.
 * Tout manquement rend un code de sortie non nul et un JSON qui NOMME l'étape fautive : une
 * capture d'écran noire ne peut pas se faire passer pour une preuve.
 *
 * Usage : node scripts/ui-capture.mjs --view worktree --out artifacts/preuve.png [--port 9231]
 *         [--click <selecteur CSS>]  ouvre ce que la vue seule ne montre pas (popover, menu,
 *                                    onglet) AVANT de capturer. Le clic doit avoir un EFFET :
 *                                    un declencheur absent ou inerte est un echec nomme, jamais
 *                                    une capture silencieuse de la vue fermee.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Identifiants réels du catalogue applicatif (src/shared/navigation.ts). */
export const VUES_CONNUES = [
  // 'accueil' MANQUAIT alors que c'est la premiere vue du catalogue (src/shared/navigation.ts:2) :
  // aucune preuve visuelle de la page d'accueil n'etait donc capturable.
  'accueil',
  'chat',
  'tests',
  'agent-studio',
  'knowledge',
  'observatory',
  'task-manager',
  'worktree',
  'tickets',
  'settings'
]

/** Alias tolérés : le pluriel traîne dans les scripts et la documentation. */
const ALIAS = { worktrees: 'worktree', 'agent studio': 'agent-studio', home: 'accueil' }

export const resoudreVue = (valeur) => {
  const brut = String(valeur ?? '')
    .trim()
    .toLowerCase()
  const canonique = ALIAS[brut] ?? brut
  return VUES_CONNUES.includes(canonique) ? canonique : undefined
}

/** Seuils au-dessus desquels une vue est considérée comme ayant réellement rendu. */
export const SEUILS = { texte: 40, elements: 12, octetsPng: 8 * 1024 }

/**
 * Verdict PUR à partir des mesures — testable sans app. Rend `ok:false` ET l'étape fautive, jamais
 * un booléen nu : un échec doit dire OÙ il a eu lieu.
 */
export const verdictCapture = (mesures) => {
  const echecs = []
  if (!mesures.vue) echecs.push('vue-inconnue')
  if (mesures.destinationActive && mesures.vue && mesures.destinationActive !== mesures.vue) {
    echecs.push(`navigation-non-appliquee(${mesures.destinationActive})`)
  }
  if ((mesures.longueurTexte ?? 0) < SEUILS.texte) echecs.push('vue-vide-texte')
  if ((mesures.elements ?? 0) < SEUILS.elements) echecs.push('vue-vide-elements')
  if (mesures.declencheur) {
    // Un declencheur introuvable ne doit JAMAIS se solder par une capture de la vue fermee : la
    // preuve montrerait autre chose que ce qu'elle affirme, et le juge la croirait.
    if (!mesures.declencheurTrouve) {
      echecs.push(`declencheur-absent(${mesures.declencheur})`)
    } else if ((mesures.elementsAvantClic ?? 0) >= (mesures.elements ?? 0)) {
      // Le declencheur existe, le clic part, et rien ne s'ouvre — deja ouvert, clic absorbe,
      // handler non pose. Sans cette garde le verdict dirait « prouve » sur une vue inchangee.
      // Le DELTA est ce qui rend le clic falsifiable ; « j'ai clique » ne l'est pas.
      echecs.push(`clic-sans-effet(${mesures.declencheur})`)
    }
  }
  if ((mesures.octetsPng ?? 0) < SEUILS.octetsPng) echecs.push('png-trop-petit')
  return { ok: echecs.length === 0, echecs }
}

// ————————————————————————————————————————————————————————————————————————
// À partir d'ici : pilotage réel. Rien de tout cela ne s'exécute à l'import.
// ————————————————————————————————————————————————————————————————————————

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}

/**
 * Découvre la page à piloter.
 *
 * Le repli sur `DevToolsActivePort` n'est autorisé QUE si l'appelant n'a pas imposé de port.
 * Sinon un port mort passé en argument se rabattait EN SILENCE sur l'instance réellement ouverte
 * et rendait `ok: true` — la capture venait alors d'une autre app que celle visée. Défaut trouvé
 * dans ce harnais même, le 2026-08-12, en testant son chemin d'échec.
 */
const decouvrirCible = async (port, portImpose) => {
  const lire = async (p) => {
    const reponse = await fetch(`http://127.0.0.1:${p}/json`, {
      signal: AbortSignal.timeout(15_000)
    })
    return { cibles: await reponse.json(), portUtilise: String(p) }
  }
  try {
    return await lire(port)
  } catch (erreur) {
    if (portImpose) throw erreur
    const actif = readFileSync(
      'C:/Amitel/Autowin OS/.autowin-data/autowin-os/DevToolsActivePort',
      'utf8'
    )
      .trim()
      .split(/\r?\n/)
    return lire(actif[0])
  }
}

const main = async () => {
  const vue = resoudreVue(argument('--view'))
  const sortie = resolve(argument('--out', `artifacts/ui-capture-${vue ?? 'inconnue'}.png`))
  const portImpose = process.argv.includes('--port')
  const port = argument('--port', process.env.AUTOWIN_CDP_PORT || '9231')

  const rendre = (charge, code) => {
    console.log(JSON.stringify(charge, null, 2))
    process.exit(code)
  }

  if (!vue) {
    rendre(
      {
        ok: false,
        echecs: ['vue-inconnue'],
        vueDemandee: argument('--view'),
        vuesConnues: VUES_CONNUES
      },
      2
    )
  }

  let cibles
  let portUtilise = String(port)
  try {
    const trouve = await decouvrirCible(port, portImpose)
    cibles = trouve.cibles
    portUtilise = trouve.portUtilise
  } catch (erreur) {
    rendre(
      {
        ok: false,
        echecs: ['cdp-injoignable'],
        port: String(port),
        detail: String(erreur).slice(0, 200)
      },
      3
    )
  }
  const page = cibles.find((c) => c.type === 'page')
  if (!page) rendre({ ok: false, echecs: ['page-autowin-absente'] }, 3)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    socket.onopen = ok
    socket.onerror = ko
  })
  let id = 0
  const attente = new Map()
  const erreursConsole = []
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    const cb = attente.get(m.id)
    if (cb) {
      attente.delete(m.id)
      m.error ? cb.ko(new Error(m.error.message)) : cb.ok(m.result)
      return
    }
    if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
      erreursConsole.push(String(m.params.entry.text).slice(0, 200))
    }
  }
  const envoyer = (methode, params = {}) =>
    new Promise((ok, ko) => {
      const n = ++id
      const t = setTimeout(() => {
        attente.delete(n)
        ko(new Error(`${methode} expiré`))
      }, 120_000)
      attente.set(n, {
        ok: (v) => (clearTimeout(t), ok(v)),
        ko: (e) => (clearTimeout(t), ko(e))
      })
      socket.send(JSON.stringify({ id: n, method: methode, params }))
    })
  const evaluer = async (expression) => {
    const r = await envoyer('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    }
    return r.result?.value
  }

  await envoyer('Runtime.enable')
  await envoyer('Log.enable')

  // Navigation par le VRAI bouton de navigation, pas par un état interne : on prouve le chemin
  // qu'emprunte l'utilisateur, pas un raccourci que lui n'a pas.
  const navigue = await evaluer(`(() => {
    const bouton = document.querySelector('[data-testid="nav-${vue}"]')
    bouton?.click()
    return Boolean(bouton)
  })()`)
  if (!navigue) {
    socket.close()
    rendre({ ok: false, echecs: [`bouton-nav-absent(nav-${vue})`], vue }, 4)
  }
  await new Promise((r) => setTimeout(r, 1_200))

  const mesurerDom = () =>
    evaluer(`(() => {
    const actif = [...document.querySelectorAll('[data-testid^="nav-"]')]
      .find((b) => b.className.includes('active') || b.getAttribute('aria-current'))
    return {
      destinationActive: actif?.getAttribute('data-testid')?.replace(/^nav-/, '') ?? null,
      longueurTexte: (document.querySelector('main')?.innerText ?? document.body.innerText ?? '').trim().length,
      elements: document.querySelectorAll('main *').length || document.querySelectorAll('body *').length
    }
  })()`)
  let mesuresDom = await mesurerDom()

  // Ce que le harnais ne savait pas faire, et qui a coute deux runs le 2026-08-26 (conv-1420) : un
  // popover, un menu, un onglet n'existent dans le DOM qu'APRES un clic. On mesure donc le DOM
  // avant, on declenche, on laisse le rendu se poser, et le verdict exige un DELTA -- un clic sans
  // effet ne doit pas produire une capture de la vue fermee portant un verdict vert.
  const declencheur = argument('--click')
  let declencheurTrouve
  let elementsAvantClic
  if (declencheur) {
    elementsAvantClic = mesuresDom.elements
    declencheurTrouve = await evaluer(`(() => {
      const cible = document.querySelector(${JSON.stringify(declencheur)})
      cible?.click()
      return Boolean(cible)
    })()`)
    if (declencheurTrouve) {
      await new Promise((r) => setTimeout(r, 600))
      mesuresDom = await mesurerDom()
    }
  }

  const capture = await envoyer('Page.captureScreenshot', { format: 'png', fromSurface: true })
  mkdirSync(dirname(sortie), { recursive: true })
  writeFileSync(sortie, Buffer.from(capture.data, 'base64'))
  const octetsPng = statSync(sortie).size
  socket.close()

  const mesures = {
    vue,
    ...mesuresDom,
    octetsPng,
    ...(declencheur ? { declencheur, declencheurTrouve, elementsAvantClic } : {})
  }
  const verdict = verdictCapture(mesures)
  rendre(
    {
      ...verdict,
      vue,
      fichier: sortie,
      portUtilise,
      ...mesures,
      erreursConsole: erreursConsole.slice(0, 5),
      // Ce que le producteur peut CITER au juge comme preuve hors-modèle.
      preuve: verdict.ok
        ? `capture ${sortie} (${octetsPng} octets), vue « ${vue} » active, ${mesures.elements} éléments rendus`
        : null
    },
    verdict.ok ? 0 : 5
  )
}

// N'exécute le pilotage que lancé en CLI : les tests importent les fonctions pures.
if (process.argv[1] && process.argv[1].endsWith('ui-capture.mjs')) {
  await main()
}
