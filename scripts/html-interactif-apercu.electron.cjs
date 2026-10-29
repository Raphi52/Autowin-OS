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
const urlScene = pathToFileURL(join(config.pages, 'scene-3d.html')).href
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
  window.__phase = 'demarrage'
  const cadre = document.createElement('iframe')
  cadre.setAttribute('sandbox', 'allow-scripts')
  cadre.setAttribute('referrerpolicy', 'no-referrer')
  cadre.style.height = `${outils.HAUTEUR_INITIALE_PAGE}px`
  window.addEventListener('message', (event) => {
    if (event.source !== cadre.contentWindow || !event.data) return
    const donnees = event.data
    if (donnees.type !== 'autowin-scene-3d') return
    messages.push({
      etat: donnees.etat,
      message: donnees.message,
      hauteur: donnees.hauteur,
      pendant: window.__phase
    })
    if (donnees.etat === 'pret') {
      cadre.contentWindow.postMessage(
        {
          type: 'autowin-scene-3d',
          page: {
            html: parametres.html,
            style: outils.STYLE_PAGE_INTERACTIVE,
            theme: outils.lireThemePourPage(hote)
          }
        },
        '*'
      )
    } else if (donnees.etat === 'hauteur') {
      const borne = outils.borneHauteurPage(donnees.hauteur)
      if (borne !== null) cadre.style.height = `${borne}px`
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
  const CLIQUABLES =
    'button, summary, label, [role=button], input[type=button], input[type=submit], ' +
    'input[type=reset], input[type=checkbox], input[type=radio], input[type=range]'
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

app
  .whenReady()
  .then(async () => {
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

      const messages = await contenu.executeJavaScript('window.__messagesPage')
      resultats.push({
        largeur,
        png,
        lancee: messages.some((m) => m.etat === 'lancee'),
        erreurs: messages
          .filter((m) => m.etat === 'erreur')
          .map((m) => ({ message: String(m.message ?? ''), pendant: m.pendant })),
        hauteur,
        hauteurFinale,
        dessine: arrondi(partDessinee(t0)),
        debordementPx: Math.max(0, mesure.largeurContenu - mesure.largeurVue),
        fondOpaque: mesure.fondOpaque,
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
