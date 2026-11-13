#!/usr/bin/env node
/*
 * SONDE « CONTINUER AVEC GOOGLE » SUR LE VRAI ELECTRON. Le test unitaire du navigateur intégré
 * simule Electron : il ne peut pas prouver que Chromium relie bien la fenêtre de connexion à la page.
 * Cette sonde joue le VRAI code (`creerFabriqueElectron`, src/main/bureau/navigateur-integre.ts) dans
 * l'Electron du dépôt, lancé dans un bureau Windows caché : rien ne s'ouvre sur l'écran de
 * l'utilisateur.
 *
 * Scénario, sur deux origines locales comme Pinterest et Google : l'onglet ouvre une fenêtre de
 * connexion (`window.open` avec dimensions) ; elle renvoie un jeton à la page par `window.opener`,
 * puis se ferme. Contrôles : une vraie fenêtre fille de l'app, à la taille demandée ; le jeton reçu ;
 * la fenêtre refermée ; un agent Chrome ; au plus MAX_FENETRES_DE_CONNEXION fenêtres en rafale ; un
 * lien `target=_blank` toujours rendu au fil en onglet ; les fenêtres fermées avec l'onglet.
 *
 * Usage : node scripts/sonde-fenetre-connexion.mjs --bureau <id du bureau caché> [--conversation conv-NNN]
 * Codes : 0 tout est vert · 1 un contrôle rouge · 2 sonde impossible (paquet, lancement, délai)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const depot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = process.argv.slice(2)
const option = (nom) => {
  const i = options.indexOf(nom)
  return i >= 0 ? options[i + 1] : undefined
}
const bureau = option('--bureau')
const conversation = option('--conversation') ?? process.env.AUTOWIN_CONVERSATION_ID ?? ''
if (!bureau || !/^[a-zA-Z0-9_-]+$/.test(bureau)) {
  console.error(
    'Usage : node scripts/sonde-fenetre-connexion.mjs --bureau <id> [--conversation conv-NNN]'
  )
  process.exit(2)
}

const dossier = mkdtempSync(join(tmpdir(), 'sonde-fenetre-connexion-'))
const paquet = join(dossier, 'fabrique.cjs')
const principal = join(dossier, 'principal.cjs')
const sortie = join(dossier, 'resultat.json')

await build({
  entryPoints: [join(depot, 'src/main/bureau/navigateur-integre.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: paquet,
  logLevel: 'error'
})

// Le processus principal de l'Electron sondé. Il écrit son verdict dans `sortie`, puis s'arrête.
const sourcePrincipal = String.raw`
const { app, BrowserWindow, webContents } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const SORTIE = ${JSON.stringify(sortie)}
app.setPath('userData', ${JSON.stringify(join(dossier, 'donnees'))})
const { creerFabriqueElectron, MAX_FENETRES_DE_CONNEXION } = require(${JSON.stringify(paquet)})

const PAGES = {
  '/onglet': '<!doctype html><title>Onglet</title>' +
    '<button id="connexion" onclick="window.open(\'__B__/connexion\', \'connexion\', \'width=480,height=600\')">Continuer</button>' +
    '<button id="rafale" onclick="for (let i = 0; i < 4; i++) window.open(\'__B__/attente?\' + i, \'r\' + i, \'width=320,height=320\')">Rafale</button>' +
    '<a id="lien" href="/lien" target="_blank">Lien</a>' +
    '<script>window.recus = []; addEventListener("message", (e) => recus.push({ origine: e.origin, donnees: e.data }))</script>',
  // Comme Google : une redirection du serveur, puis une page qui change d'adresse, avant le jeton.
  '/etape': '<!doctype html><title>Etape</title><script>location.href = "/jeton"</script>',
  '/jeton': '<!doctype html><title>Jeton</title><script>' +
    'opener.postMessage({ jeton: "jeton-ok", agent: navigator.userAgent }, "*"); setTimeout(() => close(), 200)</script>',
  '/attente': '<!doctype html><title>Attente</title>',
  '/lien': '<!doctype html><title>Lien</title>'
}

const attendre = async (condition, ms) => {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await condition()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

async function sonder() {
  const agents = {}
  const serveur = http.createServer((req, res) => {
    const chemin = req.url.split('?')[0]
    ;(agents[chemin] = agents[chemin] ?? []).push(req.headers['user-agent'])
    if (chemin === '/connexion') {
      res.writeHead(302, { location: '/etape' })
      res.end()
      return
    }
    const page = PAGES[chemin]
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    res.end((page ?? '').replaceAll('__B__', 'http://localhost:' + serveur.address().port))
  })
  await new Promise((r) => serveur.listen(0, r))
  const port = serveur.address().port

  const fenetre = new BrowserWindow({ width: 1000, height: 760, title: 'Sonde fenetre de connexion' })
  const ongletsDuFil = []
  const consoleDuFil = []
  const vue = creerFabriqueElectron(fenetre).creerVue({
    partition: 'sonde-fenetre-connexion',
    ecouteurs: {
      surChangement() {},
      surNouvelleFenetre: (url, disposition) => ongletsDuFil.push({ url, disposition }),
      surConsole: (l) => consoleDuFil.push(l.message),
      surRequeteEchouee() {},
      surTelechargement() {}
    }
  })
  vue.poserCadre({ x: 0, y: 0, width: 1000, height: 760 })
  vue.rendreVisible(true)
  const creees = []
  app.on('browser-window-created', (_e, w) => {
    if (w !== fenetre) creees.push({ w, fille: w.getParentWindow() === fenetre, taille: w.getContentSize() })
  })
  const chargement = await vue.charger('http://127.0.0.1:' + port + '/onglet')
  if (!chargement.ok) throw new Error('onglet non chargé : ' + chargement.erreur)
  const page = webContents.getAllWebContents().find((w) => w.getURL().endsWith('/onglet'))
  const cliquer = (id) => page.executeJavaScript('document.getElementById("' + id + '").click()', true)
  const recus = () => page.executeJavaScript('window.recus')
  const controles = []
  const noter = (nom, ok, vu) => controles.push({ nom, ok: Boolean(ok), vu })

  // 1. « Continuer avec Google » : vraie fenêtre, jeton rendu à la page, fenêtre refermée.
  await cliquer('connexion')
  await attendre(async () => (await recus()).length > 0 && creees[0]?.w.isDestroyed(), 10_000)
  const message = (await recus())[0]
  noter('une vraie fenêtre s’ouvre', creees.length === 1, creees.length + ' fenêtre(s)')
  noter('fille de la fenêtre de l’app', creees[0]?.fille, String(creees[0]?.fille))
  noter('à la taille demandée par la page', creees[0]?.taille.join('x') === '480x600', creees[0]?.taille.join('x'))
  noter('la page reçoit le jeton par window.opener', message?.donnees?.jeton === 'jeton-ok', JSON.stringify(message?.donnees?.jeton))
  noter('le jeton vient de l’autre origine', message?.origine === 'http://localhost:' + port, message?.origine)
  noter('la fenêtre se referme d’elle-même', creees[0]?.w.isDestroyed(), String(creees[0]?.w.isDestroyed()))
  const marque = (agent) => (/Electron/.test(agent) ? 'Electron' : 'Chrome')
  const pagesVues = (await recus()).map((r) => marque(r.donnees.agent))
  const requetes = ['/connexion', '/etape', '/jeton'].flatMap((c) => (agents[c] ?? []).map((a) => c + ' ' + marque(a)))
  noter('la page de connexion voit Chrome, pas Electron', pagesVues.length > 0 && pagesVues.every((m) => m === 'Chrome'), 'pages : ' + pagesVues.join(', '))
  noter('chaque requête de la connexion aussi, redirections comprises', requetes.length === 3 && requetes.every((r) => r.endsWith('Chrome')), requetes.join(', '))
  noter('aucun onglet ajouté au fil', ongletsDuFil.length === 0, ongletsDuFil.length + ' onglet(s)')

  // 2. Une rafale de quatre fenêtres : bornée, et dite dans la console de l'onglet.
  creees.length = 0
  await cliquer('rafale')
  await attendre(() => creees.length >= MAX_FENETRES_DE_CONNEXION, 5_000)
  await new Promise((r) => setTimeout(r, 800))
  const refus = consoleDuFil.filter((m) => /ouvertes au plus/.test(m)).length
  noter('rafale bornée à ' + MAX_FENETRES_DE_CONNEXION + ' fenêtres', creees.length === MAX_FENETRES_DE_CONNEXION, creees.length + ' fenêtre(s)')
  noter('les refus sont dits dans la console', refus === 4 - MAX_FENETRES_DE_CONNEXION, refus + ' refus')

  // 3. Un lien target=_blank reste un onglet du fil.
  await cliquer('lien')
  await attendre(() => ongletsDuFil.length > 0, 5_000)
  noter('un lien target=_blank devient un onglet du fil', ongletsDuFil[0]?.url === 'http://127.0.0.1:' + port + '/lien', ongletsDuFil[0]?.url)
  noter('sans ouvrir de fenêtre', creees.length === MAX_FENETRES_DE_CONNEXION, creees.length + ' fenêtre(s)')

  // 4. L'onglet fermé, ses fenêtres de connexion partent avec lui.
  vue.fermer()
  await attendre(() => creees.every((c) => c.w.isDestroyed()), 5_000)
  noter('l’onglet fermé ferme ses fenêtres', creees.every((c) => c.w.isDestroyed()), creees.filter((c) => !c.w.isDestroyed()).length + ' encore ouverte(s)')

  serveur.close()
  return { electron: process.versions.electron, controles }
}

app.whenReady().then(async () => {
  let resultat
  try {
    resultat = await Promise.race([
      sonder(),
      new Promise((_r, refuser) => setTimeout(() => refuser(new Error('délai de 45 s dépassé')), 45_000))
    ])
  } catch (erreur) {
    resultat = { erreur: String(erreur && erreur.stack ? erreur.stack : erreur) }
  }
  fs.writeFileSync(SORTIE, JSON.stringify(resultat, null, 2))
  app.exit(0)
})
`
writeFileSync(principal, sourcePrincipal, 'utf8')

const electron = createRequire(import.meta.url)('electron')
const lancement = spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-File',
    join(depot, 'scripts/hdesk-lancer.ps1'),
    '-Id',
    bureau,
    '-Executable',
    electron,
    '-Arguments',
    `"${principal}"`,
    '-Travail',
    'Sonde : fenêtre de connexion du navigateur intégré',
    ...(conversation ? ['-Conversation', conversation] : []),
    '-SurvieSecondes',
    '0'
  ],
  { encoding: 'utf8', timeout: 60_000 }
)
// 4 = l'app s'est arrêtée après sa fenêtre : c'est la fin normale de la sonde.
if (![0, 4].includes(lancement.status ?? -1)) {
  console.error(`Lancement dans le bureau caché refusé (code ${lancement.status}).`)
  console.error(lancement.stderr || lancement.stdout)
  process.exit(2)
}

const fin = Date.now() + 60_000
while (!existsSync(sortie) && Date.now() < fin) await new Promise((r) => setTimeout(r, 200))
if (!existsSync(sortie)) {
  console.error(`Aucun verdict de l'Electron sondé en 60 s (dossier ${dossier}).`)
  process.exit(2)
}
const resultat = JSON.parse(readFileSync(sortie, 'utf8'))
if (resultat.erreur) {
  console.error(`Sonde interrompue : ${resultat.erreur}`)
  process.exit(2)
}
console.log(`Electron ${resultat.electron}`)
for (const c of resultat.controles) console.log(`${c.ok ? 'VERT ' : 'ROUGE'} ${c.nom} — ${c.vu}`)
const rouges = resultat.controles.filter((c) => !c.ok).length
console.log(rouges ? `${rouges} contrôle(s) rouge(s).` : 'Tous les contrôles sont verts.')
process.exit(rouges ? 1 : 0)
