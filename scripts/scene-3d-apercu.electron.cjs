/*
 * Processus principal Electron de `scene-3d-apercu.mjs` : fait tourner un bloc ```threejs dans une
 * fenetre CACHEE (rien ne s'affiche a l'ecran), comme le fil le ferait, puis ecrit `rapport.json`.
 * Ne se lance pas a la main : passe par `node scripts/scene-3d-apercu.mjs <fichier>`.
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

// Le cadre isole reste dans le processus de sa page, ICI SEULEMENT. Mesure du 2026-10-16 : en rendu
// hors ecran, Electron ne fait pas suivre la souris vers un cadre `sandbox` place dans un processus
// a part (la page parente recoit 28 evenements, la scene zero) — impossible alors de verifier
// qu'elle pivote. Ce reglage ne change que le placement du cadre : son bac a sable, son origine
// opaque et sa politique de securite restent ceux du fil.
app.commandLine.appendSwitch('disable-features', 'IsolateSandboxedIframes')

const config = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'))
const urlScene = pathToFileURL(join(config.pages, 'scene-3d.html')).href
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Monte le cadre isole, repond au `pret` de la page par le code — le protocole de Bloc3D.tsx. */
function sondeParent(parametres) {
  return new Promise((resolve) => {
    // Gardes sur la page : relus a la FIN de la mesure, apres le glisser — une erreur levee par la
    // scene quand on la fait pivoter compte autant qu'une erreur au demarrage.
    const messages = (window.__messagesScene3d = [])
    const cadre = document.createElement('iframe')
    cadre.setAttribute('sandbox', 'allow-scripts')
    cadre.style.cssText = `display:block;border:0;width:100%;height:${parametres.hauteur}px`
    window.addEventListener('message', (event) => {
      if (event.source !== cadre.contentWindow || !event.data) return
      if (event.data.type !== 'autowin-scene-3d') return
      messages.push({ etat: event.data.etat, message: event.data.message })
      if (event.data.etat === 'pret') {
        cadre.contentWindow.postMessage({ type: 'autowin-scene-3d', code: parametres.code }, '*')
      }
    })
    cadre.src = parametres.url
    window.__cadreScene3d = cadre
    document.body.appendChild(cadre)
    setTimeout(() => resolve(messages), parametres.attente)
  })
}

/** Part des pixels d'une capture qui s'ecartent de la couleur du coin haut-gauche. */
function partDessinee(image) {
  const bmp = image.toBitmap()
  const fond = [bmp[0], bmp[1], bmp[2]]
  let differents = 0
  const total = bmp.length / 4
  for (let i = 0; i < bmp.length; i += 4) {
    const ecart = Math.max(
      Math.abs(bmp[i] - fond[0]),
      Math.abs(bmp[i + 1] - fond[1]),
      Math.abs(bmp[i + 2] - fond[2])
    )
    if (ecart > 12) differents += 1
  }
  return total ? differents / total : 0
}

/** Part des pixels qui changent entre deux captures de meme taille. */
function partChangee(a, b) {
  const x = a.toBitmap()
  const y = b.toBitmap()
  if (x.length !== y.length) return 1
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

/** Un glisser de souris de gauche a droite, en douze pas, comme une main qui fait pivoter. */
async function glisser(contenu, x, y, distance) {
  contenu.sendInputEvent({ type: 'mouseMove', x, y })
  contenu.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  for (let pas = 1; pas <= 12; pas += 1) {
    await pause(16)
    const nx = Math.round(x + (distance * pas) / 12)
    contenu.sendInputEvent({
      type: 'mouseMove',
      x: nx,
      y,
      button: 'left',
      modifiers: ['leftButtonDown']
    })
  }
  contenu.sendInputEvent({ type: 'mouseUp', x: x + distance, y, button: 'left', clickCount: 1 })
}

app
  .whenReady()
  .then(async () => {
    const resultats = []
    for (const largeur of config.largeurs) {
      const fenetre = new BrowserWindow({
        show: false,
        width: largeur,
        height: config.hauteur,
        useContentSize: true,
        // Rendu HORS ECRAN : une fenetre simplement cachee peint une image puis suspend ses
        // animations (mesure : aucune difference entre deux captures, meme apres un glisser). Le
        // rendu hors ecran continue de dessiner sans rien afficher.
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
      // Le filtre de la fenetre de l'app (window.ts) : premier chargement local ou de la page de
      // scene seulement, toute navigation ulterieure d'un cadre refusee.
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
      await contenu.executeJavaScript(
        `(${sondeParent.toString()})(${JSON.stringify({
          code: config.code,
          url: urlScene,
          hauteur: config.hauteur,
          attente: config.attente
        })})`
      )
      const zone = { x: 0, y: 0, width: largeur, height: config.hauteur }
      const t0 = await contenu.capturePage(zone)
      await pause(400)
      const t1 = await contenu.capturePage(zone)
      // Scene d'un carrousel /draft : chaque rang 2..N, comme le fil quand on change de proposition.
      // Chaque ecart se compare au mouvement propre de la scene sur le MEME delai (`bruitChoix`) :
      // une scene qui tourne derive d'une capture a l'autre sans rien changer de sa proposition.
      // AVANT le glisser, sur la vue de depart — celle qu'a l'utilisateur quand il change de
      // proposition. Mesure du 2026-10-17 (ville de conv-315) : pris apres le glisser, le regard
      // etait tourne vers le mur, la ville hors champ, et l'inertie du glisser comptait comme bruit
      // (0,26) : « choix-ignore » sur une scene qui changeait bel et bien.
      const choix = []
      let bruitChoix = 0
      if (config.choix > 1) {
        const b0 = await contenu.capturePage(zone)
        await pause(700)
        bruitChoix = partChangee(b0, await contenu.capturePage(zone))
      }
      for (let rang = 2; rang <= (config.choix || 0); rang += 1) {
        const avant = await contenu.capturePage(zone)
        await contenu.executeJavaScript(
          `window.__cadreScene3d.contentWindow.postMessage({ type: 'autowin-scene-3d', choix: ${rang} }, '*')`
        )
        await pause(700)
        const vue = await contenu.capturePage(zone)
        const pngChoix = join(config.out, `scene-${largeur}-choix-${rang}.png`)
        writeFileSync(pngChoix, vue.toPNG())
        choix.push({ rang, png: pngChoix, ecart: arrondi(partChangee(avant, vue)) })
      }
      // Le glisser se mesure contre une capture prise JUSTE avant lui : apres les rangs, `t1`
      // montre une autre proposition, et l'ecart compterait le changement de proposition.
      const avantGlisser = config.choix > 1 ? await contenu.capturePage(zone) : t1
      await glisser(
        contenu,
        Math.round(largeur * 0.35),
        Math.round(config.hauteur / 2),
        Math.round(largeur * 0.3)
      )
      await pause(400)
      const t2 = await contenu.capturePage(zone)
      const messages = await contenu.executeJavaScript('window.__messagesScene3d')
      const png = join(config.out, `scene-${largeur}.png`)
      writeFileSync(png, t0.toPNG())
      const pngApres = join(config.out, `scene-${largeur}-apres-glisser.png`)
      writeFileSync(pngApres, t2.toPNG())
      resultats.push({
        largeur,
        png,
        pngApres,
        lancee: messages.some((m) => m.etat === 'lancee'),
        erreurs: messages.filter((m) => m.etat === 'erreur').map((m) => m.message),
        dessine: arrondi(partDessinee(t0)),
        animee: arrondi(partChangee(t0, t1)),
        apresGlisser: arrondi(partChangee(avantGlisser, t2)),
        choix,
        bruitChoix: arrondi(bruitChoix),
        navigationsRefusees,
        console: console_.slice(0, 20)
      })
      // Pas de `destroy()` ici : mesure du 2026-10-16 sous Electron 44, detruire une fenetre fait
      // echouer le chargement suivant (ERR_FAILED -2). On la vide seulement ; `app.quit()` les ferme.
      await fenetre.loadURL('about:blank')
    }
    writeFileSync(join(config.out, 'rapport.json'), JSON.stringify(resultats, null, 2))
    app.quit()
  })
  .catch(echouer)
