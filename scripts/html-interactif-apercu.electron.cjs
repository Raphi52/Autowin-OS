/*
 * Processus principal Electron de `html-interactif-apercu.mjs` : fait tourner un bloc
 * ```html-interactif dans une fenetre CACHEE (rien ne s'affiche a l'ecran), comme le fil le ferait,
 * le clique et le survole, puis ecrit `rapport.json`.
 * Ne se lance pas a la main : passe par `node scripts/html-interactif-apercu.mjs <fichier>`.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

// Un second ecouteur empeche Electron d'ouvrir sa boite d'erreur modale sur l'ecran de
// l'utilisateur : l'erreur part sur stderr et le code de sortie la porte.
const echouer = (erreur) => {
  process.stderr.write(`${(erreur && erreur.stack) || erreur}\n`)
  app.exit(1)
}
process.on('uncaughtException', echouer)
process.on('unhandledRejection', echouer)

// Le cadre isole reste dans le processus de sa page, ICI SEULEMENT (mesure de scene-3d-apercu, le
// 2026-10-16) : en rendu hors ecran, Electron ne fait pas suivre la souris vers un cadre `sandbox`
// place dans un processus a part — les clics n'atteindraient jamais la page. Son bac a sable, son
// origine opaque et sa politique de securite restent ceux du fil.
app.commandLine.appendSwitch('disable-features', 'IsolateSandboxedIframes')

const config = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'))
// La page isolee choisie comme le fil la choisirait (`pageIsoleePour`, conv-1304).
const urlScene = pathToFileURL(join(config.pages, config.page)).href
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const HAUTEUR_FENETRE = 900
const GESTES_MAX = 16

/**
 * Monte le cadre isole et parle avec lui comme BlocHtmlInteractif.tsx : au `pret`, la page, sa
 * feuille de base et le theme lu sur l'hote ; chaque `hauteur` re-dimensionne le cadre (bornee).
 * `window.__pageInteractive` vient de page-interactive.ts compile (injecte avec cette fonction).
 */
function sondeParent(parametres) {
  const outils = window.__pageInteractive
  const hote = document.querySelector('.hote')
  const messages = (window.__messagesPage = [])
  // Les demandes de la page (conv-1304) : RELEVEES, jamais executees — l'apercu ne touche ni au
  // presse-papiers de l'utilisateur ni a son navigateur. Le geste exige est le meme que dans le fil.
  const demandes = (window.__demandesPage = [])
  let stockage
  window.__phase = 'demarrage'
  const cadre = document.createElement('iframe')
  cadre.setAttribute('sandbox', outils.SANDBOX_PAGE_INTERACTIVE)
  cadre.setAttribute('referrerpolicy', 'no-referrer')
  cadre.style.height = `${outils.HAUTEUR_INITIALE_PAGE}px`
  window.addEventListener('message', (event) => {
    if (event.source !== cadre.contentWindow) return
    const message = outils.lireMessagePage(event.data)
    if (!message) return
    messages.push({
      etat: message.etat,
      message: message.message,
      hauteur: message.hauteur,
      pendant: window.__phase
    })
    if (message.etat === 'pret') {
      cadre.contentWindow.postMessage(
        {
          type: 'autowin-scene-3d',
          page: {
            html: parametres.html,
            style: outils.STYLE_PAGE_INTERACTIVE,
            theme: outils.lireThemePourPage(hote),
            stockage
          }
        },
        '*'
      )
    } else if (message.etat === 'hauteur') {
      cadre.style.height = `${message.hauteur}px`
    } else if (message.etat === 'stockage') {
      stockage = message.donnees
    } else if (
      message.etat === 'lien' ||
      message.etat === 'copier' ||
      message.etat === 'defiler' ||
      message.etat === 'prompt'
    ) {
      // `prompt` (conv-1304) : un bouton de choix qui remplirait la saisie du fil.
      const geste = outils.gesteRecentDeLUtilisateur()
      demandes.push({
        demande: message.etat,
        detail: (message.href || message.texte || String(message.y ?? '')).slice(0, 200),
        accordee: message.etat === 'defiler' || geste,
        pendant: window.__phase
      })
      if (message.etat === 'copier') {
        cadre.contentWindow.postMessage(
          outils.reponseALaPage(message.demande, geste, geste ? undefined : 'sans clic'),
          '*'
        )
      }
    }
  })
  cadre.src = parametres.url
  window.__cadrePage = cadre
  hote.appendChild(cadre)
}

/** Mesures prises DANS la page, puis la liste des elements a cliquer ou a survoler. */
function sondePage(gestesMax) {
  const racine = document.documentElement
  const corps = document.body
  const fondOpaque = []
  for (const [nom, element] of [
    ['html', racine],
    ['body', corps]
  ]) {
    const style = getComputedStyle(element)
    const couleur = style.backgroundColor
    const alpha = /rgba?\(([^)]+)\)/u.exec(couleur)?.[1].split(/[\s,/]+/u)[3]
    const opaque = alpha === undefined ? couleur !== 'transparent' : Number(alpha) > 0.02
    if (opaque || style.backgroundImage !== 'none') {
      fondOpaque.push(`${nom} : ${couleur}${style.backgroundImage !== 'none' ? ' + image' : ''}`)
    }
  }
  // Liens compris (conv-1304) : un lien de la page s'ouvre par le fil, l'apercu verifie qu'il le
  // DEMANDE bien (champ `demandes`).
  const CLIQUABLES =
    'button, summary, label, [role=button], input[type=button], input[type=submit], ' +
    'input[type=reset], input[type=checkbox], input[type=radio], input[type=range], a[href]'
  const decrire = (element) => {
    const id = element.id ? `#${element.id}` : ''
    const classe =
      !id && typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/u)[0]}`
        : ''
    const texte = (element.textContent || element.getAttribute('aria-label') || '')
      .trim()
      .replace(/\s+/gu, ' ')
      .slice(0, 30)
    return `${element.tagName.toLowerCase()}${id}${classe}${texte ? ` « ${texte} »` : ''}`
  }
  const cibles = []
  for (const element of corps.querySelectorAll('*')) {
    if (element.id === 'autowin-scene-3d-erreur') continue
    const clic =
      element.matches(CLIQUABLES) ||
      typeof element.onclick === 'function' ||
      typeof element.onmousedown === 'function' ||
      typeof element.onpointerdown === 'function'
    const survol =
      !clic &&
      ((element.matches('canvas, svg') && !element.parentElement?.closest('svg')) ||
        typeof element.onmousemove === 'function' ||
        typeof element.onmouseover === 'function' ||
        typeof element.onmouseenter === 'function' ||
        typeof element.onpointermove === 'function')
    if (!clic && !survol) continue
    const r = element.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    cibles.push({ element, geste: clic ? 'clic' : 'survol', cible: decrire(element) })
  }
  window.__ciblesApercu = cibles.slice(0, gestesMax).map((c) => c.element)
  return {
    largeurVue: racine.clientWidth,
    largeurContenu: Math.max(racine.scrollWidth, corps.scrollWidth),
    fondOpaque,
    cibles: cibles.slice(0, gestesMax).map(({ geste, cible }) => ({ geste, cible })),
    ciblesIgnorees: Math.max(0, cibles.length - gestesMax)
  }
}

/** Part des pixels d'une capture qui s'ecartent de la couleur du coin haut-gauche. */
function partDessinee(image) {
  const bmp = image.toBitmap()
  if (bmp.length === 0) return 0
  const fond = [bmp[0], bmp[1], bmp[2]]
  let differents = 0
  for (let i = 0; i < bmp.length; i += 4) {
    const ecart = Math.max(
      Math.abs(bmp[i] - fond[0]),
      Math.abs(bmp[i + 1] - fond[1]),
      Math.abs(bmp[i + 2] - fond[2])
    )
    if (ecart > 12) differents += 1
  }
  return differents / (bmp.length / 4)
}

/** Part des pixels qui changent entre deux captures ; 1 si la taille a change. */
function partChangee(a, b) {
  const x = a.toBitmap()
  const y = b.toBitmap()
  if (x.length !== y.length) return 1
  if (x.length === 0) return 0
  let changes = 0
  for (let i = 0; i < x.length; i += 4) {
    const ecart = Math.max(
      Math.abs(x[i] - y[i]),
      Math.abs(x[i + 1] - y[i + 1]),
      Math.abs(x[i + 2] - y[i + 2])
    )
    if (ecart > 12) changes += 1
  }
  return changes / (x.length / 4)
}

const arrondi = (valeur) => Math.round(valeur * 10000) / 10000

/** Joue DANS la page : la cible d'une etape (selecteur CSS ou `texte=<libelle>`) et son point. */
function sondeCible(selecteur, fractionX, fractionY) {
  let element = null
  if (selecteur.startsWith('texte=')) {
    const cherche = selecteur.slice('texte='.length).trim().toLocaleLowerCase('fr-FR')
    const porte = (e) =>
      (e.textContent || e.value || e.getAttribute('aria-label') || '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase('fr-FR')
    const interactifs = document.querySelectorAll(
      'button, a[href], summary, label, [role=button], [role=tab], [onclick], th, ' +
        'input[type=button], input[type=submit]'
    )
    element =
      [...interactifs].find((e) => porte(e) === cherche) ||
      [...interactifs].find((e) => porte(e).includes(cherche)) ||
      null
  } else {
    element = document.querySelector(selecteur)
  }
  if (!element) return { raison: `cible introuvable : ${selecteur}` }
  window.__cibleScenario = element
  const r = element.getBoundingClientRect()
  if (r.width < 1 || r.height < 1)
    return { raison: `cible invisible (taille nulle) : ${selecteur}` }
  const x = r.left + r.width * fractionX
  const y = r.top + r.height * fractionY
  // Le point vise doit etre celui de la cible : un calque qui la recouvre prendrait le vrai clic.
  const dessus = document.elementFromPoint(x, y)
  if (dessus && dessus !== element && !element.contains(dessus) && !dessus.contains(element)) {
    return { raison: `cible recouverte par <${dessus.tagName.toLowerCase()}> : ${selecteur}` }
  }
  return { x, y, balise: element.tagName, type: element.type || '' }
}

/**
 * Joue DANS la page : les jauges d'un carrousel /draft (conv-1382). Chaque jauge va d'une borne a
 * l'autre, et on releve les propositions ou elle est VISIBLE et celles qu'elle CHANGE. Les gestes
 * automatiques la cliquaient deja, mais rien n'exigeait un effet : une jauge morte sortait en code 0.
 * Le style calcule voit aussi ce qu'une capture ne montre pas (une duree) et les propositions cachees.
 * Transitions achevees et animations figees avant chaque lecture : une valeur en cours de transition
 * ferait croire a une jauge morte, une animation qui tourne a une jauge vivante.
 */
function sondeJauges() {
  const champs = [...document.querySelectorAll('.dkc-rg input')]
  const cartes = [...document.querySelectorAll('.dkc-sl .dkc-mq')]
  const radios = [...document.querySelectorAll('input[name=dkp]')]
  if (!champs.length || !cartes.length) return []
  const figer = () => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSTransition) a.finish()
      else a.pause()
    }
  }
  // Sans les variables : la jauge pose la sienne sur tout le carrousel, chaque element en herite.
  const lire = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo)
    return Array.from(style)
      .filter((nom) => !nom.startsWith('--'))
      .map((nom) => style.getPropertyValue(nom))
      .join(';')
  }
  const empreinte = (carte) =>
    [carte, ...carte.querySelectorAll('*')]
      .slice(0, 300)
      .flatMap((e) => [lire(e), lire(e, '::before'), lire(e, '::after')])
      .join('|')
  const poser = (champ, valeur) => {
    champ.value = valeur
    champ.dispatchEvent(new Event('input', { bubbles: true }))
    figer()
  }
  const aller = (radio) => {
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))
  }
  // Le cadre garde sa hauteur pendant la sonde : une jauge qui grandit la page y ferait apparaitre une
  // barre de defilement, et la largeur perdue passerait pour un effet sur TOUTES les propositions.
  const defilement = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  const depart = radios.find((r) => r.checked)
  const visibles = new Map(champs.map((c) => [c, []]))
  radios.forEach((radio, i) => {
    aller(radio)
    for (const c of champs) if (!c.closest('.dkc-rgl').hidden) visibles.get(c).push(i + 1)
  })
  if (depart) aller(depart)
  const rapport = champs.map((c) => {
    const avant = c.value
    const [bas, haut] = c.type === 'color' ? ['#000000', '#ffffff'] : [c.min, c.max]
    poser(c, bas)
    const empreintes = cartes.map(empreinte)
    poser(c, haut)
    const effet = cartes.flatMap((carte, i) => (empreinte(carte) === empreintes[i] ? [] : [i + 1]))
    poser(c, avant)
    return { nom: c.dataset.nom, variable: c.dataset.variable, visible: visibles.get(c), effet }
  })
  figer()
  for (const a of document.getAnimations()) a.play()
  document.documentElement.style.overflow = defilement
  return rapport
}

/** Joue DANS la page : pose une valeur et previent la page comme un vrai changement. */
function poserValeur(valeur) {
  const element = window.__cibleScenario
  if (element.tagName === 'SELECT') {
    const option = [...element.options].find(
      (o) => o.value === valeur || o.textContent.trim() === valeur
    )
    if (!option) return `option absente : ${valeur}`
    element.value = option.value
  } else {
    element.value = valeur
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return ''
}

/** Le texte lu dans la page : ce qui s'affiche, plus les champs en lecture seule (un total). */
const LIRE_TEXTE =
  "String(document.body.innerText || '') + ' ' + [...document.querySelectorAll(" +
  "'input[readonly], textarea[readonly], input:disabled, output')]" +
  ".map((e) => e.value || e.textContent || '').join(' ')"

/** Les types de champ qu'on ne saisit pas lettre a lettre : le navigateur les decoupe. */
const CHAMPS_POSES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range'])

/** Touches de `TOUCHES` (html-interactif-apercu-scenario.mjs) vers les noms d'Electron. */
const CODES_TOUCHES = {
  Enter: 'Return',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/**
 * Joue le parcours de `--scenario` (conv-1304) : vraie souris, vrai clavier, sur la page telle qu'elle
 * vient de se charger. S'arrete a la premiere etape qui n'aboutit pas : la suite n'aurait pas de sens.
 */
async function jouerScenario({ etapes, outils, contenu, cadre, largeur, ajuster, capturer }) {
  const debutDemandes = (await contenu.executeJavaScript('window.__demandesPage')).length
  const attendreQue = async (condition) => {
    const limite = Date.now() + outils.DELAI_VERIFICATION_MS
    for (;;) {
      if (await condition()) return true
      if (Date.now() > limite) return false
      await pause(100)
    }
  }
  const lireTexte = (dans) =>
    dans
      ? cadre.executeJavaScript(`document.querySelector(${JSON.stringify(dans)})?.innerText ?? ''`)
      : cadre.executeJavaScript(LIRE_TEXTE)
  const pointer = async (etape, cible) => {
    await ajuster()
    const lu = await cadre.executeJavaScript(
      `(${sondeCible.toString()})(${JSON.stringify(cible)}, ${etape.x ?? 0.5}, ${etape.y ?? 0.5})`
    )
    if (lu.raison) return lu
    const decalage = await contenu.executeJavaScript(
      '(() => { const r = window.__cadrePage.getBoundingClientRect(); return { x: r.left, y: r.top } })()'
    )
    return { ...lu, x: Math.round(decalage.x + lu.x), y: Math.round(decalage.y + lu.y) }
  }
  const souris = (x, y, clic) => {
    contenu.sendInputEvent({ type: 'mouseMove', x: x - 2, y })
    contenu.sendInputEvent({ type: 'mouseMove', x, y })
    if (clic) {
      contenu.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      contenu.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }
  }

  const executer = async (etape) => {
    const verbe = outils.verbeDe(etape)
    const valeur = etape[verbe]
    if (verbe === 'attendre') {
      await pause(valeur)
    } else if (verbe === 'touche') {
      const keyCode = CODES_TOUCHES[valeur]
      contenu.sendInputEvent({ type: 'keyDown', keyCode })
      if (valeur === 'Enter') contenu.sendInputEvent({ type: 'char', keyCode: '\r' })
      if (valeur === 'Space') contenu.sendInputEvent({ type: 'char', keyCode: ' ' })
      contenu.sendInputEvent({ type: 'keyUp', keyCode })
    } else if (verbe === 'voir') {
      if (
        !(await attendreQue(async () => outils.pageContient(await lireTexte(etape.dans), valeur)))
      )
        return `texte absent ${etape.dans ? `de ${etape.dans}` : 'de la page'} : ${valeur}`
    } else if (verbe === 'pasVoir') {
      if (
        !(await attendreQue(async () => !outils.pageContient(await lireTexte(etape.dans), valeur)))
      )
        return `texte encore present ${etape.dans ? `dans ${etape.dans}` : 'dans la page'} : ${valeur}`
    } else if (verbe === 'demande') {
      const trouvee = await attendreQue(async () => {
        const demandes = await contenu.executeJavaScript('window.__demandesPage')
        return demandes
          .slice(debutDemandes)
          .some(
            (d) =>
              d.demande === valeur &&
              d.accordee &&
              (etape.contient === undefined || outils.pageContient(d.detail, etape.contient))
          )
      })
      if (!trouvee)
        return `aucune demande « ${valeur} » acceptee${
          etape.contient ? ` contenant « ${etape.contient} »` : ''
        }`
    } else {
      const point = await pointer(etape, valeur)
      if (point.raison) return point.raison
      if (verbe === 'cliquer') {
        souris(point.x, point.y, true)
      } else if (verbe === 'survoler') {
        souris(point.x, point.y, false)
      } else if (verbe === 'choisir' || CHAMPS_POSES.has(point.type)) {
        const refus = await cadre.executeJavaScript(
          `(${poserValeur.toString()})(${JSON.stringify(String(etape.valeur))})`
        )
        if (refus) return refus
      } else {
        // `remplir` : comme l'utilisateur, un clic dans le champ puis la frappe. Le champ est vide
        // d'abord : un champ prerempli recevrait sinon le texte a la suite de sa valeur.
        souris(point.x, point.y, true)
        await pause(60)
        await cadre.executeJavaScript(
          'window.__cibleScenario.focus(); window.__cibleScenario.select?.()'
        )
        contenu.insertText(String(etape.valeur))
        await pause(60)
        const ecrit = await cadre.executeJavaScript('window.__cibleScenario.value')
        if (String(ecrit) !== String(etape.valeur))
          return `champ non rempli : ${JSON.stringify(ecrit)} au lieu de ${JSON.stringify(etape.valeur)}`
      }
      await pause(120)
    }
    return ''
  }

  let reussies = 0
  for (const [rang, etape] of etapes.entries()) {
    await contenu.executeJavaScript(
      `window.__phase = ${JSON.stringify(`scenario ${outils.decrireEtape(etape)}`)}`
    )
    const raison = await executer(etape)
    if (raison) {
      const png = join(config.out, `scenario-${largeur}-echec.png`)
      await ajuster()
      writeFileSync(png, (await capturer()).toPNG())
      return {
        etapes: etapes.length,
        reussies,
        echec: {
          numero: rang + 1,
          etape: outils.decrireEtape(etape),
          raison,
          texteVu: outils.normaliserTexte(await lireTexte()).slice(0, 1500),
          png
        }
      }
    }
    reussies += 1
  }
  const png = join(config.out, `scenario-${largeur}.png`)
  await ajuster()
  writeFileSync(png, (await capturer()).toPNG())
  return { etapes: etapes.length, reussies, png }
}

app
  .whenReady()
  .then(async () => {
    const outilsScenario = config.scenario
      ? await import(pathToFileURL(join(__dirname, 'html-interactif-apercu-scenario.mjs')).href)
      : null
    const resultats = []
    for (const largeur of config.largeurs) {
      const fenetre = new BrowserWindow({
        show: false,
        width: largeur,
        height: HAUTEUR_FENETRE,
        useContentSize: true,
        // Rendu HORS ECRAN : une fenetre simplement cachee peint une image puis suspend ses
        // animations et ses clics (mesure de scene-3d-apercu.electron.cjs).
        webPreferences: {
          contextIsolation: true,
          sandbox: false,
          backgroundThrottling: false,
          offscreen: true
        }
      })
      fenetre.webContents.setFrameRate(30)
      const contenu = fenetre.webContents
      const console_ = []
      const navigationsRefusees = []
      contenu.on('console-message', (event) => console_.push(String(event.message).slice(0, 300)))
      // Le filtre de la fenetre de l'app (window.ts) : premier chargement de la page isolee
      // seulement, toute navigation ulterieure d'un cadre refusee (un lien clique dans la page).
      contenu.on('will-frame-navigate', (details) => {
        if (details.isMainFrame) return
        const actuelle = (details.frame && details.frame.url) || ''
        const initiale = actuelle === '' || actuelle === 'about:blank'
        const permise =
          details.url.startsWith('data:') ||
          details.url.startsWith('blob:') ||
          details.url === urlScene
        if (!(initiale && permise)) {
          navigationsRefusees.push(details.url.slice(0, 200))
          details.preventDefault()
        }
      })
      await fenetre.loadFile(join(config.pages, 'parent.html'))
      // Le protocole compile est POSE avec la sonde (executeJavaScript n'est pas soumis a la
      // politique de la page) : l'evaluer depuis la page serait refuse, faute de 'unsafe-eval'.
      await contenu.executeJavaScript(
        `${config.protocole}\n;(${sondeParent.toString()})(${JSON.stringify({
          html: config.html,
          url: urlScene
        })})`
      )
      await pause(config.attente)
      const hauteurCadre = () =>
        contenu.executeJavaScript('Math.round(window.__cadrePage.getBoundingClientRect().height)')
      const hauteur = await hauteurCadre()
      // Sans aucun geste, la hauteur doit rester la meme : une page qui grandit seule repousse le
      // fil sans fin (hauteur en `vh` ou `innerHeight`, qui suit le cadre qui la suit).
      await pause(700)
      const hauteurFinale = await hauteurCadre()
      // La fenetre doit contenir tout le cadre : une capture ne voit que la zone affichee.
      const ajusterFenetre = async (h) => {
        const [, actuelle] = fenetre.getContentSize()
        if (h + 20 > actuelle) {
          fenetre.setContentSize(largeur, Math.min(h + 40, 4200))
          await pause(300)
        }
      }
      await ajusterFenetre(hauteurFinale)
      const zone = async () => ({
        x: 0,
        y: 0,
        width: largeur,
        height: Math.max(1, await hauteurCadre())
      })
      const t0 = await contenu.capturePage(await zone())
      const png = join(config.out, `page-${largeur}.png`)
      writeFileSync(png, t0.toPNG())

      const cadre = contenu.mainFrame.framesInSubtree.find((f) => f !== contenu.mainFrame)
      // Une seule largeur : une jauge lit la meme variable quelle que soit la colonne.
      const jauges =
        cadre && largeur === config.largeurs[0]
          ? await cadre.executeJavaScript(`(${sondeJauges.toString()})()`)
          : []
      // Le parcours passe AVANT la mesure : un debordement apparu quand une ligne s'ajoute, ou un
      // bouton ne en cours de route, sont ainsi vus par les controles et les gestes automatiques.
      const scenario =
        config.scenario && cadre
          ? await jouerScenario({
              etapes: config.scenario,
              outils: outilsScenario,
              contenu,
              cadre,
              largeur,
              ajuster: async () => ajusterFenetre(await hauteurCadre()),
              capturer: async () => contenu.capturePage(await zone())
            })
          : undefined
      const mesure = cadre
        ? await cadre.executeJavaScript(`(${sondePage.toString()})(${GESTES_MAX})`)
        : { largeurVue: largeur, largeurContenu: largeur, fondOpaque: [], cibles: [] }

      // Les gestes, dans l'ordre du document. La position de chaque cible est relue juste avant
      // son geste : un clic precedent a pu deplacer la page (onglet, ligne ajoutee).
      const gestes = []
      for (const [n, { geste, cible }] of mesure.cibles.entries()) {
        const point = await cadre.executeJavaScript(
          `(() => { const e = window.__ciblesApercu[${n}]; if (!e || !e.isConnected) return null;` +
            ' const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;' +
            ' return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
        )
        if (!point) {
          gestes.push({ geste, cible, ecart: null, note: 'cible disparue avant son geste' })
          continue
        }
        const decalage = await contenu.executeJavaScript(
          '(() => { const r = window.__cadrePage.getBoundingClientRect(); return { x: r.left, y: r.top } })()'
        )
        const x = Math.round(decalage.x + point.x)
        const y = Math.round(decalage.y + point.y)
        await ajusterFenetre(await hauteurCadre())
        const avant = await contenu.capturePage(await zone())
        await contenu.executeJavaScript(`window.__phase = ${JSON.stringify(`${geste} ${cible}`)}`)
        contenu.sendInputEvent({ type: 'mouseMove', x: x - 3, y })
        contenu.sendInputEvent({ type: 'mouseMove', x, y })
        if (geste === 'clic') {
          contenu.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
          contenu.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
        }
        await pause(350)
        await ajusterFenetre(await hauteurCadre())
        const apres = await contenu.capturePage(await zone())
        const pngGeste = join(config.out, `geste-${largeur}-${n + 1}.png`)
        writeFileSync(pngGeste, apres.toPNG())
        gestes.push({ geste, cible, ecart: arrondi(partChangee(avant, apres)), png: pngGeste })
      }

      // Le texte que la page affiche APRES tous les gestes (conv-1304) : ce que l'utilisateur lirait,
      // et la preuve qu'un geste a produit son effet (« copie : ok », « form : soumis »).
      const texteFinal = cadre
        ? await cadre.executeJavaScript(
            "String(document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 4000)"
          )
        : ''
      const messages = await contenu.executeJavaScript('window.__messagesPage')
      const demandes = await contenu.executeJavaScript('window.__demandesPage')
      resultats.push({
        largeur,
        png,
        lancee: messages.some((m) => m.etat === 'lancee'),
        erreurs: messages
          .filter((m) => m.etat === 'erreur')
          .map((m) => ({ message: String(m.message ?? ''), pendant: m.pendant })),
        avertissements: messages
          .filter((m) => m.etat === 'avertissement')
          .map((m) => ({ message: String(m.message ?? ''), pendant: m.pendant })),
        alertes: messages
          .filter((m) => m.etat === 'alerte')
          .map((m) => ({ message: String(m.message ?? ''), pendant: m.pendant })),
        demandes,
        texteFinal,
        hauteur,
        hauteurFinale,
        dessine: arrondi(partDessinee(t0)),
        debordementPx: Math.max(0, mesure.largeurContenu - mesure.largeurVue),
        fondOpaque: mesure.fondOpaque,
        ...(scenario ? { scenario } : {}),
        ...(jauges.length ? { jauges } : {}),
        gestes,
        ...(mesure.ciblesIgnorees ? { ciblesIgnorees: mesure.ciblesIgnorees } : {}),
        navigationsRefusees,
        console: console_.slice(0, 20)
      })
      // Pas de `destroy()` : sous Electron 44, detruire une fenetre fait echouer le chargement
      // suivant (ERR_FAILED -2, mesure de scene-3d-apercu). On la vide ; `app.quit()` les ferme.
      await fenetre.loadURL('about:blank')
    }
    writeFileSync(join(config.out, 'rapport.json'), JSON.stringify(resultats, null, 2))
    app.quit()
  })
  .catch(echouer)
