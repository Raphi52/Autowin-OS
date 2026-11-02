// @vitest-environment node
/*
 * CHOISIR NE DOIT JAMAIS CLIQUER DANS LA PAGE — à la vraie souris (conv-1306, 2026-10-30).
 *
 * Défaut mesuré : choisir le bouton « Payer » d'une page le déclenchait. happy-dom ne le voit pas :
 * il ne joue pas la séquence d'entrée d'un vrai navigateur (pointerdown → pointerup → mouseup →
 * click), ni la suppression des mousedown/mouseup de compatibilité quand pointerdown est annulé.
 * Ce test fait donc tourner le noyau dans l'Electron du dépôt, dans le MÊME monde isolé que l'app
 * (`MONDE_ISOLE_NAVIGATEUR`), et presse le bouton par `webContents.sendInputEvent` : le chemin
 * d'entrée du navigateur, celui qu'emprunte une souris réelle.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { MONDE_ISOLE_NAVIGATEUR, SOURCE_NOYAU_NAVIGATEUR } from './navigateur-page-script'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = resolve(ICI, '../..')
const dossier = mkdtempSync(join(tmpdir(), 'choisir-reel-'))
const electron = createRequire(import.meta.url)(join(RACINE, 'node_modules/electron')) as string

afterAll(() => rmSync(dossier, { recursive: true, force: true }))

/*
 * La page COMPTE ce qu'elle reçoit, dans SON monde, comme le ferait un site : un gestionnaire sur le
 * bouton (le « Payer » d'un vrai site) et des écoutes sur le document.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>banc choisir</title>
<body style="margin:0;font:16px sans-serif">
<button id="payer" style="position:absolute;left:40px;top:40px;width:160px;height:60px">Payer</button>
<script>
  window.recu = { payer: 0, click: 0, mousedown: 0, mouseup: 0, pointerdown: 0, pointerup: 0, auxclick: 0, contextmenu: 0 };
  document.getElementById('payer').addEventListener('click', function () { window.recu.payer += 1; });
  Object.keys(window.recu).forEach(function (t) {
    if (t === 'payer') return;
    document.addEventListener(t, function () { window.recu[t] += 1; });
  });
</script>`

/** Processus principal d'Electron : un geste de souris par étape, l'état relu après chacune. */
const PROCESSUS = `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const [page, noyau, sortie, monde] = process.argv.slice(-4)
const echouer = (erreur) => { process.stderr.write(String((erreur && erreur.stack) || erreur)); app.exit(1) }
process.on('uncaughtException', echouer)
process.on('unhandledRejection', echouer)
app.whenReady().then(async () => {
  const fenetre = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false } })
  await fenetre.loadFile(page)
  const wc = fenetre.webContents
  const source = readFileSync(noyau, 'utf8')
  const isole = (appel) => wc.executeJavaScriptInIsolatedWorld(Number(monde), [{ code: source + ';' + appel }])
  const page_ = (code) => wc.executeJavaScript(code)
  // Attendre une CONDITION (jamais un délai à l'aveugle) : les entrées et les scripts n'ont pas la même file.
  async function attendre(lire, test, quoi) {
    const fin = Date.now() + 5000
    for (;;) {
      const v = await lire()
      if (test(v)) return v
      if (Date.now() > fin) throw new Error('attente dépassée : ' + quoi + ' — dernière valeur ' + JSON.stringify(v))
      await new Promise((ok) => setTimeout(ok, 20))
    }
  }
  const b = await page_("(() => { const r = document.getElementById('payer').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()")
  function presser() {
    wc.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y })
    wc.sendInputEvent({ type: 'mouseDown', x: b.x, y: b.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  }
  const resultat = {}

  // 1. Mode Choisir, un appui sur « Payer ».
  await isole("window.__awNav.appeler('activerMode', ['choisir'])")
  presser()
  // « choisi » est rangé au pointerup ; mouseup et click partent dans la MÊME tâche d'entrée.
  await attendre(() => isole('window.__awNav.file.length'), (n) => n > 0, 'message choisi')
  // Un aller-retour d'entrée de plus : un mouvement de souris, vu par la page, ferme la séquence.
  await page_("window.vuMouvement = 0; document.addEventListener('mousemove', function () { window.vuMouvement += 1 }, { once: true })")
  wc.sendInputEvent({ type: 'mouseMove', x: b.x + 1, y: b.y + 1 })
  await attendre(() => page_('window.vuMouvement'), (n) => n > 0, 'séquence d\\'entrée close')
  resultat.messages = await isole("window.__awNav.appeler('prendre', [])")
  resultat.mode = await isole('window.__awNav.mode')
  resultat.pendantChoisir = await page_('Object.assign({}, window.recu)')

  // 2. Mode quitté : un vrai clic suivant doit, lui, atteindre la page.
  presser()
  await attendre(() => page_('window.recu.payer'), (n) => n > resultat.pendantChoisir.payer, 'clic suivant reçu')
  resultat.apres = await page_('Object.assign({}, window.recu)')

  // 3. Nouveau choix, puis Entrée sur le bouton : la garde de fin de geste ne mange pas ce clic-là.
  await isole("window.__awNav.appeler('activerMode', ['choisir'])")
  presser()
  await attendre(() => isole('window.__awNav.file.length'), (n) => n > 0, 'second message choisi')
  await isole("window.__awNav.appeler('prendre', [])")
  await page_("document.getElementById('payer').focus()")
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  wc.sendInputEvent({ type: 'char', keyCode: 'Enter' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await attendre(() => page_('window.recu.payer'), (n) => n > resultat.apres.payer, 'clic au clavier reçu')
  resultat.clavier = await page_('Object.assign({}, window.recu)')

  writeFileSync(sortie, JSON.stringify(resultat))
  app.exit(0)
})
`

interface Compteurs {
  payer: number
  click: number
  mousedown: number
  mouseup: number
  pointerdown: number
  pointerup: number
}

function jouer(): {
  messages: Array<{ type: string; selecteur?: string }>
  mode: string | null
  pendantChoisir: Compteurs
  apres: Compteurs
  clavier: Compteurs
} {
  const page = join(dossier, 'page.html')
  const noyau = join(dossier, 'noyau.js')
  const principal = join(dossier, 'principal.cjs')
  const sortie = join(dossier, 'sortie.json')
  writeFileSync(page, PAGE)
  writeFileSync(noyau, SOURCE_NOYAU_NAVIGATEUR)
  writeFileSync(principal, PROCESSUS)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(electron, [principal, page, noyau, sortie, String(MONDE_ISOLE_NAVIGATEUR)], {
    encoding: 'utf8',
    env,
    timeout: 60_000
  })
  if (r.status !== 0) {
    throw new Error(`Electron a échoué (code ${r.status}) : ${r.stderr || r.error?.message || ''}`)
  }
  return JSON.parse(readFileSync(sortie, 'utf8'))
}

describe('Choisir, à la vraie souris dans Electron', () => {
  it('rend l’élément choisi sans que la page reçoive le clic, puis lui rend les clics suivants', () => {
    const r = jouer()
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]).toMatchObject({ type: 'choisi', selecteur: '#payer' })
    expect(r.mode).toBeNull()
    // Le geste qui choisit n'atteint JAMAIS la page : ni son gestionnaire, ni ses écoutes.
    expect(r.pendantChoisir).toMatchObject({
      payer: 0,
      click: 0,
      mousedown: 0,
      mouseup: 0,
      pointerdown: 0,
      pointerup: 0
    })
    // Le mode quitté, la page retrouve la souris : un seul clic, et il arrive.
    expect(r.apres.payer).toBe(1)
    expect(r.apres.click).toBe(1)
    // Après un second choix, Entrée sur le bouton le déclenche : seul le clic du choix est avalé.
    expect(r.clavier.payer).toBe(2)
    expect(r.clavier.click).toBe(2)
  }, 90_000)
})
