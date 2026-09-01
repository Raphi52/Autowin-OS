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
 *         [--css <fichier.css>]      injecte une feuille de style d'une COPIE DE TRAVAIL par-dessus
 *                                    celle du depot : sans elle, un agent en worktree ne peut rien
 *                                    prouver visuellement (l'app sert le depot, pas sa copie). Le
 *                                    JSON porte alors `cssInjecte` — la capture le DIT.
 *         [--click <selecteur CSS>]  ouvre ce que la vue seule ne montre pas (popover, menu,
 *                                    onglet) AVANT de capturer. Le clic doit avoir un EFFET :
 *                                    un declencheur absent ou inerte est un echec nomme, jamais
 *                                    une capture silencieuse de la vue fermee.
 *         [--state attention] [--state-selector <sel>] force un etat DOM (defaut
 *                                    `.chat-mosaic-window`) que la navigation seule ne produit pas.
 *                                    Zero element touche = echec nomme (code 7).
 *         [--motion <selecteur CSS>] [--reduced-motion | --full-motion] PROUVE QUE CA BOUGE. Capture N frames de chaque occurrence du
 *                                    selecteur, a sa taille de rendu REELLE, et rend la fraction de
 *                                    pixels qui change entre frames. Un element immobile est un
 *                                    echec nomme. Options : --frames (defaut 4), --interval ms
 *                                    (defaut 220). La planche de contact ecrite dans --out agrandit
 *                                    les vignettes pour l'oeil ; le DIFF, lui, est mesure au rendu
 *                                    vrai (scale 1) — un agrandi ressusciterait un detail
 *                                    sous-pixel et rendrait « ca bouge » sur un ecran ou l'humain
 *                                    ne voit rien.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
export const SEUILS = {
  texte: 40,
  elements: 12,
  octetsPng: 8 * 1024,
  /**
   * Fraction de pixels devant changer entre deux frames pour qu'un element soit dit MOBILE.
   *
   * Le cas mesure separe franchement : une orbite qui tourne deplace ~20 % des pixels de sa boite,
   * un rendu fige en deplace 0. Le seuil est place bas — assez pour accepter une rotation lente,
   * assez haut pour ne pas prendre le bruit d'anticrenelage d'un rendu identique pour du mouvement.
   */
  mouvement: 0.004
}

/**
 * Verdict PUR de mouvement, par OCCURRENCE.
 *
 * Chaque occurrence porte sa taille de rendu REELLE et les fractions de pixels ayant change entre
 * frames consecutives. Le verdict accuse l'occurrence fautive nommement : une moyenne, ou un « au
 * moins une bouge », rendrait vert le defaut exact rapporte le 2026-08-28 — le rail tourne, la
 * pastille de la sidebar est morte.
 *
 * L'ordre des gardes n'est pas cosmetique. Une occurrence de taille nulle est INVISIBLE, pas
 * immobile : l'accuser aussi d'immobilite enverrait corriger l'animation d'un element qui n'est
 * meme pas affiche.
 */
export const verdictMouvement = ({ selecteur, occurrences }) => {
  const liste = occurrences ?? []
  if (liste.length === 0) return { ok: false, echecs: [`selecteur-sans-occurrence(${selecteur})`] }
  const echecs = []
  liste.forEach((occurrence, index) => {
    const nom = `${selecteur}#${index + 1}`
    const largeur = occurrence.largeur ?? 0
    const hauteur = occurrence.hauteur ?? 0
    const taille = `${largeur}x${hauteur}`
    if (largeur < 1 || hauteur < 1) {
      echecs.push(`occurrence-invisible(${nom}, ${taille})`)
      return
    }
    const ratios = occurrence.ratios ?? []
    if (ratios.length === 0) {
      // Une seule frame ne prouve rien : sans deuxieme instant, « immobile » et « pas mesure » sont
      // le meme JSON. On les separe.
      echecs.push(`frames-insuffisantes(${nom})`)
      return
    }
    const max = Math.max(...ratios)
    if (max < SEUILS.mouvement) echecs.push(`mouvement-absent(${nom}, ${taille}, max=${max})`)
  })
  return { ok: echecs.length === 0, echecs }
}

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

/**
 * Etats forcables par `--state`, tels que le composant les ECRIT reellement
 * (src/renderer/src/components/ChatMosaic.tsx : data-etat = 'occupe' | 'attention').
 */
/**
 * Quelle valeur de `prefers-reduced-motion` emuler, d'apres les drapeaux CLI.
 * `--reduced-motion` (couper) l'emporte sur `--full-motion` (no-preference) : demander une
 * preuve dans la condition reduite ne doit jamais etre neutralise par l'autre drapeau.
 * Mesure du 2026-08-31 : le poste reel repond deja `reduce`, donc sans `--full-motion` une
 * animation correcte se mesure IMMOBILE — ce qui est vrai, mais ne dit rien du poste standard.
 */
export const mediaMouvementEmulee = (argv) => {
  if (argv.includes('--reduced-motion')) return 'reduce'
  if (argv.includes('--full-motion')) return 'no-preference'
  return undefined
}

export const ETATS_CONNUS = ['attention', 'occupe']

export const resoudreEtat = (valeur) => {
  const brut = String(valeur ?? '')
    .trim()
    .toLowerCase()
  return ETATS_CONNUS.includes(brut) ? brut : undefined
}

/**
 * Un etat force n'est une preuve que s'il a TOUCHE quelque chose. Mosaique vide => appliques: 0 =>
 * l'anneau dore n'existe pas dans le DOM ; un vert rendu la serait un faux vert.
 */
export const verdictEtat = ({ etat, selecteur, appliques }) => {
  const echecs = []
  if (!resoudreEtat(etat)) echecs.push(`etat-inconnu(${etat})`)
  if (!(Number(appliques) > 0)) echecs.push(`etat-sans-cible(${selecteur})`)
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
 * Où vit le `DevToolsActivePort` de l'instance ouverte.
 *
 * Ce chemin était CODÉ EN DUR sur une seule installation (`C:/Amitel/Autowin OS/...`). Le harnais
 * rendait donc `cdp-injoignable` sur toute autre machine ET depuis tout worktree d'agent, alors que
 * l'application tournait : un instrument de preuve qui impute au produit un défaut qui est le sien.
 * On REMONTE désormais les parents du script jusqu'à trouver le fichier — depuis un worktree
 * (`<depot>/.autowin-data/autowin-os/worktrees/…`) comme depuis le dépôt, la remontée croise la
 * racine réelle. L'ancien chemin reste en dernier recours, et `AUTOWIN_DATA_DIR` passe devant tout.
 */
const candidatsDevToolsPort = () => {
  const candidats = []
  if (process.env.AUTOWIN_DATA_DIR) {
    candidats.push(resolve(process.env.AUTOWIN_DATA_DIR, 'DevToolsActivePort'))
  }
  let dossier = dirname(fileURLToPath(import.meta.url))
  const racineDisque = parse(dossier).root
  for (;;) {
    candidats.push(resolve(dossier, '.autowin-data/autowin-os/DevToolsActivePort'))
    const parent = dirname(dossier)
    if (dossier === racineDisque || parent === dossier) break
    dossier = parent
  }
  candidats.push('C:/Amitel/Autowin OS/.autowin-data/autowin-os/DevToolsActivePort')
  return candidats
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
    const candidats = candidatsDevToolsPort()
    const trouve = candidats.find((c) => existsSync(c))
    if (!trouve) {
      // On NOMME ce qui a été sondé : un « injoignable » sans inventaire est indébogable.
      throw new Error(
        `DevToolsActivePort introuvable. Sondes : ${candidats.join(' | ')}. Amont : ${erreur}`
      )
    }
    const actif = readFileSync(trouve, 'utf8').trim().split(/\r?\n/)
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

  // --reduced-motion : rejoue la condition reelle d'un poste ou les effets visuels systeme sont
  // desactives (Windows > Accessibilite). Sans cette emulation, une preuve de mouvement ne dit
  // RIEN du poste utilisateur : elle mesure un navigateur ou l'animation n'a jamais ete coupee.
  const mediaMouvement = mediaMouvementEmulee(process.argv)
  if (mediaMouvement) {
    await envoyer('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: mediaMouvement }]
    })
  }

  // --------------------------------------------------------------------
  // --css : RENDRE LA FEUILLE DE STYLE D'UNE COPIE DE TRAVAIL.
  //
  // Pourquoi : l'application ouverte sert son rendu depuis le depot de l'utilisateur (vite sur
  // localhost:5173). Un agent qui travaille dans une copie isolee ne peut donc RIEN prouver
  // visuellement : sa feuille de style n'est jamais chargee par la page qu'il capture. Le harnais
  // rendait alors une capture verte de l'ANCIEN rendu — un faux vert parfait.
  // Ce que ca fait : injecte le fichier CSS demande en DERNIERE feuille du document, donc par-dessus
  // celle du depot. Rien n'est ecrit sur disque, rien n'est modifie dans le depot de l'utilisateur ;
  // l'injection meurt avec le rechargement de la page.
  // Anti-faux-vert : fichier introuvable, vide, ou feuille dont le navigateur n'a retenu AUCUNE
  // regle => echec nomme (code 8). Le JSON PORTE `cssInjecte` : une capture obtenue par injection
  // ne peut pas se faire passer pour le rendu natif du depot.
  const cheminCss = argument('--css')
  let cssInjecte
  if (cheminCss) {
    const absolu = resolve(cheminCss)
    if (!existsSync(absolu)) {
      socket.close()
      rendre({ ok: false, echecs: [`css-introuvable(${absolu})`], vue }, 8)
    }
    const source = readFileSync(absolu, 'utf8')
    if (source.trim().length === 0) {
      socket.close()
      rendre({ ok: false, echecs: [`css-vide(${absolu})`], vue }, 8)
    }
    const regles = await evaluer(`(() => {
      document.getElementById('aw-css-injecte')?.remove()
      const noeud = document.createElement('style')
      noeud.id = 'aw-css-injecte'
      noeud.textContent = ${JSON.stringify(source)}
      document.head.appendChild(noeud)
      try {
        return noeud.sheet ? noeud.sheet.cssRules.length : 0
      } catch {
        return 0
      }
    })()`)
    if (!regles) {
      socket.close()
      rendre({ ok: false, echecs: [`css-sans-regle-retenue(${absolu})`], vue }, 8)
    }
    cssInjecte = { fichier: absolu, regles, octets: source.length }
    await new Promise((r) => setTimeout(r, 300))
  }

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
  // --state : amene l'UI dans un etat qu'aucune navigation ne produit a la demande (une fenetre
  // mosaique passe en data-etat='attention' seulement a la FIN d'un tour). On l'ECRIT sur le DOM,
  // et le verdict exige que l'ecriture ait touche au moins un element.
  const etatDemande = argument('--state')
  let verdictEtatForce
  if (etatDemande !== undefined) {
    const etat = resoudreEtat(etatDemande)
    const selecteurEtat = argument('--state-selector', '.chat-mosaic-window')
    const appliques = etat
      ? await evaluer(`(() => {
      const noeuds = [...document.querySelectorAll(${JSON.stringify(selecteurEtat)})]
      noeuds.forEach((n) => n.setAttribute('data-etat', ${JSON.stringify(etat)}))
      return noeuds.length
    })()`)
      : 0
    verdictEtatForce = {
      ...verdictEtat({ etat: etatDemande, selecteur: selecteurEtat, appliques }),
      etat: etatDemande,
      selecteurEtat,
      appliques
    }
    if (!verdictEtatForce.ok) {
      socket.close()
      rendre({ ok: false, echecs: verdictEtatForce.echecs, vue, etatForce: verdictEtatForce }, 7)
    }
    await new Promise((r) => setTimeout(r, 300))
    mesuresDom = await mesurerDom()
  }

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

  // --------------------------------------------------------------------
  // MOUVEMENT — la seule chose qu'une capture fixe ne peut pas prouver.
  // --------------------------------------------------------------------
  const selecteurMouvement = argument('--motion')
  if (selecteurMouvement) {
    const frames = Math.min(8, Math.max(2, Number(argument('--frames', '4')) || 4))
    const intervalle = Math.min(2_000, Math.max(60, Number(argument('--interval', '220')) || 220))
    // Plafond d'occurrences : un selecteur large (`.spinner` en compte des dizaines a l'ecran)
    // ferait exploser le nombre de captures. On borne, et on DIT ce qu'on a laisse de cote —
    // une troncature muette se lirait comme « tout est couvert ».
    const PLAFOND = 6

    const boites = await evaluer(`(() => {
      const noeuds = [...document.querySelectorAll(${JSON.stringify(selecteurMouvement)})]
      return {
        total: noeuds.length,
        boites: noeuds.slice(0, ${PLAFOND}).map((n) => {
          const r = n.getBoundingClientRect()
          return {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            largeur: Math.round(r.width),
            hauteur: Math.round(r.height)
          }
        })
      }
    })()`)

    // Le comparateur vit DANS la page : Chrome sait decoder un PNG, Node sans dependance non.
    // Un pixel compte comme change des qu'un canal bouge de plus de 12/255 — au-dessus du bruit
    // d'anticrenelage, tres en dessous d'un deplacement reel.
    await evaluer(`(() => {
      window.__awCharger = (url) => new Promise((ok, ko) => {
        const img = new Image()
        img.onload = () => ok(img)
        img.onerror = ko
        img.src = url
      })
      window.__awDiff = async (a, b) => {
        const [ia, ib] = await Promise.all([window.__awCharger(a), window.__awCharger(b)])
        const w = Math.min(ia.naturalWidth, ib.naturalWidth)
        const h = Math.min(ia.naturalHeight, ib.naturalHeight)
        if (w < 1 || h < 1) return 0
        const lire = (img) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          return ctx.getImageData(0, 0, w, h).data
        }
        const pa = lire(ia)
        const pb = lire(ib)
        let changes = 0
        for (let i = 0; i < pa.length; i += 4) {
          if (
            Math.abs(pa[i] - pb[i]) > 12 ||
            Math.abs(pa[i + 1] - pb[i + 1]) > 12 ||
            Math.abs(pa[i + 2] - pb[i + 2]) > 12 ||
            Math.abs(pa[i + 3] - pb[i + 3]) > 12
          ) changes++
        }
        return changes / (w * h)
      }
      window.__awPlanche = []
      return true
    })()`)

    const occurrences = []
    for (const boite of boites.boites) {
      if (boite.largeur < 1 || boite.hauteur < 1) {
        occurrences.push({ ...boite, ratios: [] })
        continue
      }
      const clip = { x: boite.x, y: boite.y, width: boite.largeur, height: boite.hauteur }
      const prises = []
      for (let f = 0; f < frames; f++) {
        // scale 1 : le rendu VRAI. C'est ici que se joue l'honnetete de l'outil.
        const brut = await envoyer('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { ...clip, scale: 1 }
        })
        prises.push(`data:image/png;base64,${brut.data}`)
        if (f < frames - 1) await new Promise((r) => setTimeout(r, intervalle))
      }
      const ratios = []
      for (let f = 1; f < prises.length; f++) {
        ratios.push(
          Number(
            await evaluer(
              `window.__awDiff(${JSON.stringify(prises[f - 1])}, ${JSON.stringify(prises[f])})`
            )
          )
        )
      }
      occurrences.push({ ...boite, ratios })
      await evaluer(`(() => { window.__awPlanche.push(${JSON.stringify(prises)}); return true })()`)
    }

    if (boites.boites.length > 0) {
      // Planche de contact : les vignettes sont AGRANDIES sans lissage pour l'oeil humain. Elle
      // ILLUSTRE, elle ne juge pas — le verdict vient des ratios mesures a scale 1 ci-dessus.
      const planche = await evaluer(`(async () => {
        const G = window.__awPlanche
        const CELL = 96
        const MARGE = 8
        const lignes = G.length
        const colonnes = Math.max(...G.map((r) => r.length))
        const c = document.createElement('canvas')
        c.width = colonnes * (CELL + MARGE) + MARGE
        c.height = lignes * (CELL + MARGE) + MARGE
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#0b0d13'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.imageSmoothingEnabled = false
        for (let l = 0; l < lignes; l++) {
          for (let col = 0; col < G[l].length; col++) {
            const img = await window.__awCharger(G[l][col])
            const x = MARGE + col * (CELL + MARGE)
            const y = MARGE + l * (CELL + MARGE)
            ctx.strokeStyle = 'rgba(255,255,255,.14)'
            ctx.strokeRect(x - 0.5, y - 0.5, CELL + 1, CELL + 1)
            ctx.drawImage(img, x, y, CELL, CELL)
          }
        }
        return c.toDataURL('image/png')
      })()`)
      mkdirSync(dirname(sortie), { recursive: true })
      writeFileSync(sortie, Buffer.from(String(planche).split(',')[1], 'base64'))
    }

    const verdictM = verdictMouvement({ selecteur: selecteurMouvement, occurrences })
    socket.close()
    rendre(
      {
        ...verdictM,
        vue,
        ...(verdictEtatForce ? { etatForce: verdictEtatForce } : {}),
        ...(cssInjecte ? { cssInjecte } : {}),
        planche: boites.boites.length > 0 ? sortie : null,
        portUtilise,
        selecteur: selecteurMouvement,
        frames,
        intervalle,
        occurrencesTotal: boites.total,
        occurrencesMesurees: occurrences.length,
        ...(boites.total > occurrences.length
          ? { tronque: `${boites.total - occurrences.length} occurrence(s) non mesuree(s)` }
          : {}),
        occurrences,
        erreursConsole: erreursConsole.slice(0, 5),
        preuve: verdictM.ok
          ? `mouvement mesure sur ${occurrences.length} occurrence(s) de « ${selecteurMouvement} » : ` +
            occurrences
              .map((o, i) => `#${i + 1} ${o.largeur}x${o.hauteur} max=${Math.max(...o.ratios, 0)}`)
              .join(', ')
          : null
      },
      verdictM.ok ? 0 : 6
    )
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
      ...(verdictEtatForce ? { etatForce: verdictEtatForce } : {}),
      ...(cssInjecte ? { cssInjecte } : {}),
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
