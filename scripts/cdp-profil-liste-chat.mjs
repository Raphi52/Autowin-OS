/**
 * PROFIL CPU DU RAFRAÎCHISSEMENT DE LA LISTE DES CONVERSATIONS — reproduire et NOMMER un gel
 * `renderer:vue-chat-liste`.
 *
 * Pourquoi (gel conv-1115, 2026-10-23) : `gels.jsonl` porte 32 événements `renderer:vue-chat-liste`
 * pour 125 s depuis le 20/10 (pire 12,9 s), PAR PAIRES — le Profiler React de la liste
 * (VueMesuree.tsx) et la tâche longue qu'il a dominée (main.tsx). Aucun ne porte de pile. La sonde du
 * fil (`cdp-profil-ouverture-fil.mjs`) ne sème qu'UNE conversation : la liste y a une ligne, donc
 * aucun coût. Celle-ci sème la liste ENTIÈRE (instantané, journal, archive) et déclenche le chemin
 * réel : un `broadcast refresh conversations` du processus principal, par `setHighlight` sur une
 * conversation de la copie, que `refreshConvs` (ChatView.tsx) suit d'un `setConvs` neuf.
 *
 * Usage : node scripts/cdp-profil-liste-chat.mjs [--essais 5] [--out <rapport.json>] [--top 25]
 *          [--sans-reutilisation]
 * Chaque passage COMPTE aussi les lignes redessinées par rafraîchissement (appels de
 * `LigneConversation`, compteur exact de V8 : `Profiler.startPreciseCoverage`).
 * `--sans-reutilisation` rejoue l'AVANT du correctif conv-1115 (`conversations-stables.ts`) dans
 * l'instance cachée SEULE : le module est intercepté à son chargement et sa réconciliation rend la
 * liste chargée telle quelle. Rien n'est modifié sur disque ; sortie 3 si l'interception échoue —
 * un « avant » qui n'en serait pas un mentirait sur le gain.
 * Sans `--port`, la sonde se lance ELLE-MÊME dans une instance cachée dédiée (`profil-liste-<pid>`),
 * par `avec-instance-headless.mjs --code-dev`, puis efface l'instance et sa copie. Jamais copiés :
 * `turn-journals/` (un tour inachevé y serait REPRIS) ni `run-state/` (un run y serait RELANCÉ) —
 * même règle que `semer-conversation.mjs`. Sortie 0 = mesures rendues ; 2 = copie impossible ;
 * 3 = page ou liste introuvable.
 */
import { spawn, spawnSync } from 'node:child_process'
import { constants, getPriority, setPriority } from 'node:os'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { racineDepot } from './racine-depot.mjs'
import { racineDonneesInstance } from './semer-conversation.mjs'

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = argument('--port')
const essais = Number(argument('--essais', 5))
const top = Number(argument('--top', 25))
const sortie = resolve(argument('--out', 'Audit/cdp/profil-liste-chat.json'))
const chargeCpu = Number(argument('--sous-charge', 0))
const rechargements = Number(argument('--rechargements', 0))
const sansReutilisation = process.argv.includes('--sans-reutilisation')
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * L'AVANT du correctif conv-1115, servi à la place du module transformé par le serveur de dev : la
 * fonction d'origine est renommée, et une version qui rend la liste chargée telle quelle (l'ancien
 * `setConvs(loaded)`) prend son nom. Rend `null` si la fonction n'est pas trouvée. Pure.
 */
export function moduleSansReutilisation(source) {
  // Deux formes : `export function x(` (serveur de dev de Vite) ou `function x(` exportée plus bas
  // par `export { x }` (esbuild seul). La remplaçante prend la même forme que l'original.
  const declaration = /(export\s+)?function reutiliserConversationsInchangees\(/
  const trouvee = source.match(declaration)
  if (!trouvee) return null
  const exporte = trouvee[1] ?? ''
  return `${source.replace(declaration, `${exporte}function reutiliserConversationsInchangeesOrigine(`)}
${exporte}function reutiliserConversationsInchangees(_affichees, chargees) {
  return chargees
}
`
}

/**
 * Nombre d'appels de `LigneConversation` (ChatView.tsx) dans un relevé de couverture précise : une
 * ligne de la liste redessinée = un appel. Le nom porte parfois un suffixe de l'outil de build
 * (`LigneConversation2` : composant passé à `memo`). Pure.
 */
export function lignesRedessinees(couverture) {
  let n = 0
  for (const script of couverture ?? []) {
    if (!/ChatView\.tsx/.test(script.url)) continue
    for (const f of script.functions ?? [])
      if (/^LigneConversation\d*$/.test(f.functionName)) n += f.ranges?.[0]?.count ?? 0
  }
  return n
}

/**
 * Occupe TOUS les cœurs en priorité « inférieure à la normale » : un processus de priorité normale
 * (l'app ouverte de l'utilisateur, son processus principal) passe devant ; seul un processus en
 * priorité « inactive » — celle que Chromium donne à l'affichage d'une fenêtre en arrière-plan sous
 * Windows (`IDLE_PRIORITY_CLASS`, base/process/process_win.cc) — reste derrière.
 */
function lancerCharge(secondes) {
  const code = `const { Worker } = require('node:worker_threads');
const n = require('node:os').availableParallelism();
const corps = 'const fin = Date.now() + ${secondes * 1000}; let x = 0; while (Date.now() < fin) x = (x * 1103515245 + 12345) % 2147483648';
for (let i = 0; i < n; i++) new Worker(corps, { eval: true });
setTimeout(() => process.exit(0), ${secondes * 1000 + 500});`
  const enfant = spawn(process.execPath, ['-e', code], { stdio: 'ignore', windowsHide: true })
  setPriority(enfant.pid, constants.priority.PRIORITY_BELOW_NORMAL)
  return enfant
}

/** Une commande sur le point d'entrée « navigateur » du débogueur (fenêtres, processus). */
async function navigateur(method, params = {}) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  const reponse = await new Promise((res) => {
    ws.on('message', (d) => res(JSON.parse(d.toString())))
    ws.send(JSON.stringify({ id: 1, method, params }))
  })
  ws.close()
  return reponse
}

/** L'identifiant de l'instance cachée qui tient CE port (`Audit/headless-instances/<id>/instance.json`). */
function idInstance() {
  const racine = resolve(racineDepot(), 'Audit', 'headless-instances')
  for (const id of readdirSync(racine)) {
    try {
      const fiche = JSON.parse(readFileSync(join(racine, id, 'instance.json'), 'utf8'))
      if (String(fiche.port) === String(port)) return id
    } catch {
      /* dossier sans fiche : une autre instance, ou une instance arrêtée */
    }
  }
  return 'inconnue'
}

/** Les processus d'affichage de l'instance. */
async function processusDAffichage() {
  const reponse = await navigateur('SystemInfo.getProcessInfo')
  return (reponse.result?.processInfo ?? []).filter((p) => p.type === 'renderer').map((p) => p.id)
}

/**
 * Réduit ou rétablit la fenêtre de l'INSTANCE (bureau caché) — l'état d'une fenêtre que
 * l'utilisateur laisse derrière une autre application. Electron ne connaît pas
 * `Browser.setWindowBounds`, et ses boutons de fenêtre sont ceux de Windows (`titleBarOverlay`,
 * window.ts) : on passe par `ShowWindow`, sur les seules fenêtres visibles du processus navigateur
 * de l'instance (son pid, lu par le débogueur) — jamais une fenêtre d'un autre processus.
 */
async function etatFenetre(etat) {
  const info = await navigateur('SystemInfo.getProcessInfo')
  const pid = (info.result?.processInfo ?? []).find((p) => p.type === 'browser')?.id
  if (!pid) return 'processus navigateur introuvable'
  const commande = etat === 'reduite' ? 6 : 9 // SW_MINIMIZE / SW_RESTORE
  // La fenêtre vit sur le bureau caché de l'instance (`AutowinTest_<id>`, autowin-headless.ps1) :
  // `EnumWindows` ne verrait que le bureau de l'appelant.
  const bureau = `AutowinTest_${idInstance()}`
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr OpenDesktop(string n, uint f, bool i, uint a);
[DllImport("user32.dll")] public static extern bool EnumDesktopWindows(System.IntPtr d, EnumProc f, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool CloseDesktop(System.IntPtr d);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
'@
$d = [W.U]::OpenDesktop('${bureau}', 0, $false, 0x00C1)
if ($d -eq [IntPtr]::Zero) { 'bureau-introuvable'; exit }
$script:n = 0
[void][W.U]::EnumDesktopWindows($d, { param($h, $p) $q = 0; [void][W.U]::GetWindowThreadProcessId($h, [ref]$q); if ($q -eq ${pid} -and [W.U]::IsWindowVisible($h)) { [void][W.U]::ShowWindow($h, ${commande}); $script:n++ }; $true }, [IntPtr]::Zero)
[void][W.U]::CloseDesktop($d)
"$script:n"`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true
  })
  const n = Number(r.stdout.trim())
  return n > 0
    ? `ok (${n} fenêtre(s) du pid ${pid})`
    : `aucune fenêtre (pid ${pid}, ${bureau}) ${r.stdout.trim()} ${r.stderr.trim()}`.trim()
}

/**
 * La ligne de CETTE conversation porte-t-elle le surlignage ? D'autres fils de la copie peuvent déjà
 * être surlignés : compter `.surlignee` dans toute la liste ne prouve rien. La ligne n'a pas
 * d'attribut d'identifiant ; son identifiant est le premier texte de `.conv-meta` (ChatView.tsx).
 */
const ligneSurlignee = (id) =>
  `[...document.querySelectorAll('.conv-item')].find((e) => e.querySelector('.conv-meta span')?.textContent === ${JSON.stringify(id)})?.classList.contains('surlignee') ?? null`

let prochainEtat = true

const NOM_PRIORITE = Object.fromEntries(
  Object.entries(constants.priority).map(([nom, valeur]) => [valeur, nom.replace('PRIORITY_', '')])
)

/**
 * UN rafraîchissement réel, mesuré comme le voit l'utilisateur : du `setHighlight` à la ligne
 * redessinée (mur), et les tâches longues de la page pendant ce temps.
 */
async function unRafraichissement(evaluer, cible, etat) {
  await evaluer(`(() => {
    window.__sondeListe = { longues: [] }
    window.__sondeListeObs?.disconnect()
    window.__sondeListeObs = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) window.__sondeListe.longues.push(Math.round(e.duration))
    })
    window.__sondeListeObs.observe({ type: 'longtask', buffered: false })
    return true
  })()`)
  const debut = Date.now()
  await evaluer(`window.api.conversationsSetHighlight(${JSON.stringify(cible)}, ${etat})`)
  let fait = false
  while (!fait && Date.now() - debut < 60_000) {
    await attendre(100)
    fait = (await evaluer(ligneSurlignee(cible))) === etat
  }
  const murMs = Date.now() - debut
  await attendre(500)
  const mesure = await evaluer(`window.__sondeListe`)
  return { murMs, fait, tachesLongues: mesure?.longues ?? [] }
}

/**
 * COMBIEN DE LIGNES CHAQUE RAFRAÎCHISSEMENT REDESSINE — le compte exact, pas un échantillon :
 * `takePreciseCoverage` rend les appels depuis le relevé précédent et remet les compteurs à zéro
 * (protocole CDP, domaine Profiler). Passage séparé des essais chronométrés : le comptage ralentit
 * l'exécution.
 */
async function compterLignes(cdp, evaluer, cible, n = 3) {
  await cdp('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  await cdp('Profiler.takePreciseCoverage')
  const comptes = []
  for (let i = 0; i < n; i += 1) {
    const r = await unRafraichissement(evaluer, cible, prochainEtat)
    prochainEtat = !prochainEtat
    const releve = (await cdp('Profiler.takePreciseCoverage'))?.result?.result
    comptes.push({ fait: r.fait, murMs: r.murMs, lignesRedessinees: lignesRedessinees(releve) })
  }
  await cdp('Profiler.stopPreciseCoverage')
  console.log(`lignes redessinées par rafraîchissement : ${JSON.stringify(comptes)}`)
  return comptes
}

/**
 * RECHARGEMENT COMPLET DE LA PAGE — ce que fait le serveur de dev quand un module modifié n'a pas de
 * frontière de rechargement à chaud (`page reload src/animations-par-crans.ts`,
 * `.autowin-data/dev-app-stdout.log`, 22/10). L'app se remonte en entier, liste comprise. On lit ce
 * qu'en écrit le détecteur de l'INSTANCE (son `gels.jsonl`), le même que celui de l'utilisateur.
 */
async function mesurerRechargements(cdp, evaluer) {
  const journal = join(racineDonneesInstance(racineDepot(), idInstance()), 'gels.jsonl')
  const lireGels = () =>
    existsSync(journal)
      ? readFileSync(journal, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l)
            } catch {
              return null
            }
          })
          .filter((e) => e && /^renderer:/.test(e.operation))
      : []
  const deja = lireGels().length
  const essais = []
  for (let i = 0; i < rechargements; i += 1) {
    const debut = Date.now()
    await cdp('Page.reload', { ignoreCache: false })
    await attendre(1_000)
    let n = 0
    for (let stable = 0, k = 0; k < 240 && stable < 8; k += 1) {
      await attendre(250)
      const m = (await evaluer(`document.querySelectorAll('.conv-item').length`)) ?? 0
      stable = m > 0 && m === n ? stable + 1 : 0
      n = m
    }
    essais.push({ lignes: n, jusquALaListeStableMs: Date.now() - debut - 2_000 })
    await attendre(1_500)
  }
  const gels = lireGels()
    .slice(deja)
    .map((e) => ({ operation: e.operation, ms: e.blocageMs }))
  console.log(`rechargements : ${JSON.stringify(essais)} ; gels écrits : ${JSON.stringify(gels)}`)
  return { essais, gels }
}

async function mesurerSousCharge(_cdp, evaluer, cible) {
  const pids = await processusDAffichage()
  const priorites = () =>
    pids.map((pid) => {
      try {
        return `${pid}:${NOM_PRIORITE[getPriority(pid)] ?? getPriority(pid)}`
      } catch (erreur) {
        return `${pid}:illisible(${erreur.code ?? erreur.message})`
      }
    })
  const serie = async (nom, n) => {
    const r = []
    for (let i = 0; i < n; i += 1) {
      r.push(await unRafraichissement(evaluer, cible, prochainEtat))
      prochainEtat = !prochainEtat
    }
    console.log(`${nom} [${priorites().join(' ')}] : ${JSON.stringify(r)}`)
    return { priorites: priorites(), rafraichissements: r }
  }
  const bilan = { processus: pids }
  bilan.repos = await serie('repos, fenêtre affichée', 3)
  bilan.reduction = await etatFenetre('reduite')
  await attendre(3_000)
  bilan.reposReduite = await serie(`repos, fenêtre réduite (${bilan.reduction})`, 3)
  const charge = lancerCharge(chargeCpu)
  try {
    await attendre(1_000)
    bilan.chargeReduite = await serie('charge, fenêtre réduite', 3)
    bilan.retablissement = await etatFenetre('affichee')
    await attendre(3_000)
    bilan.chargeAffichee = await serie(`charge, fenêtre rétablie (${bilan.retablissement})`, 3)
  } finally {
    charge.kill()
  }
  return bilan
}

/** Les seuls emplacements copiés : le stockage des conversations, rien qui fasse agir l'app. */
export const STOCKAGE_DES_CONVERSATIONS = [
  'conversations.json',
  'conversations.json.journal.jsonl',
  'conversations.json.archive'
]

/**
 * Temps PROPRE et temps INCLUSIF par fonction (`nom fichier:ligne`), à partir d'un profil CDP. Pure.
 * L'inclusif compte une fonction UNE fois par échantillon même si elle est récursive.
 */
export function classerProfil(profil, { racineUrl = /^https?:\/\/[^/]+\// } = {}) {
  const noeuds = new Map(profil.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profil.nodes) for (const enfant of n.children ?? []) parent.set(enfant, n.id)
  const nomDe = (cadre) => {
    const fichier = (cadre.url || `(${cadre.functionName || 'natif'})`)
      .replace(racineUrl, '')
      .replace(/\?.*$/, '')
    return {
      fichier,
      fonction: `${cadre.functionName || '(anonyme)'} ${fichier}:${cadre.lineNumber + 1}`
    }
  }
  const propre = new Map()
  const inclusif = new Map()
  const parFichier = new Map()
  let totalMs = 0
  for (let i = 0; i < profil.samples.length; i += 1) {
    const ms = (profil.timeDeltas[i] ?? 0) / 1000
    const feuille = noeuds.get(profil.samples[i])
    if (!feuille?.callFrame) continue
    totalMs += ms
    const { fichier, fonction } = nomDe(feuille.callFrame)
    propre.set(fonction, (propre.get(fonction) ?? 0) + ms)
    parFichier.set(fichier, (parFichier.get(fichier) ?? 0) + ms)
    const vues = new Set()
    for (let id = feuille.id; id !== undefined; id = parent.get(id)) {
      const cadre = noeuds.get(id)?.callFrame
      if (!cadre) continue
      const nom = nomDe(cadre).fonction
      if (vues.has(nom)) continue
      vues.add(nom)
      inclusif.set(nom, (inclusif.get(nom) ?? 0) + ms)
    }
  }
  const trier = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nom, ms]) => ({ nom, ms: Math.round(ms) }))
  return {
    totalMs: Math.round(totalMs),
    parFonction: trier(propre),
    inclusif: trier(inclusif),
    parFichier: trier(parFichier)
  }
}

function lancerDansUneInstanceCachee() {
  const racine = racineDepot()
  const instanceId = `profil-liste-${process.pid}`
  const source = resolve(racine, '.autowin-data', 'autowin-os')
  const destination = racineDonneesInstance(racine, instanceId)
  if (!existsSync(join(source, 'conversations.json'))) {
    console.error(`copie impossible : ${join(source, 'conversations.json')} absent`)
    return 2
  }
  mkdirSync(destination, { recursive: true })
  for (const relatif of STOCKAGE_DES_CONVERSATIONS) {
    const de = join(source, relatif)
    if (!existsSync(de)) continue
    if (relatif.endsWith('.archive')) cpSync(de, join(destination, relatif), { recursive: true })
    else copyFileSync(de, join(destination, relatif))
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
        '--attendre',
        '180',
        '--',
        process.execPath,
        ici,
        ...process.argv.slice(2)
      ],
      { stdio: 'inherit', windowsHide: true }
    )
    return r.status ?? 1
  } finally {
    rmSync(resolve(destination, '..', '..', '..'), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500
    })
  }
}

async function principal() {
  if (!port) return lancerDansUneInstanceCachee()
  const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) return 3
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const attentes = new Map()
  const interceptions = { servies: 0, refusees: [] }
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    if (m.method === 'Fetch.requestPaused') {
      void servirSansReutilisation(m.params)
      return
    }
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
  /** Sert l'AVANT du correctif à la place du module du serveur de dev (`--sans-reutilisation`). */
  async function servirSansReutilisation(params) {
    const { requestId } = params
    const corps = (await cdp('Fetch.getResponseBody', { requestId }))?.result
    const source = corps
      ? corps.base64Encoded
        ? Buffer.from(corps.body, 'base64').toString('utf8')
        : corps.body
      : ''
    const avant = moduleSansReutilisation(source)
    if (!avant) {
      interceptions.refusees.push(`${params.request.url} (${params.responseStatusCode})`)
      await cdp('Fetch.continueRequest', { requestId })
      return
    }
    interceptions.servies += 1
    await cdp('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: (params.responseHeaders ?? []).filter(
        (h) => !/^(content-length|etag|cache-control)$/i.test(h.name)
      ),
      body: Buffer.from(avant, 'utf8').toString('base64')
    })
  }
  if (sansReutilisation) {
    await cdp('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp('Fetch.enable', {
      patterns: [{ urlPattern: '*conversations-stables*', requestStage: 'Response' }]
    })
    await cdp('Page.reload', { ignoreCache: true })
    await attendre(1_000)
  }

  for (let i = 0; i < 120; i += 1) {
    const pret = await evaluer(`(() => {
      const nav = document.querySelector('[data-testid="nav-chat"]')
      if (nav && !document.querySelector('.conv-new-row')) nav.click()
      return Boolean(document.querySelector('.conv-new-row'))
    })()`)
    if (pret) break
    await attendre(500)
  }
  // La liste est prête quand son nombre de lignes ne bouge plus depuis 2 s.
  let lignes = 0
  for (let stable = 0, i = 0; i < 240 && stable < 8; i += 1) {
    await attendre(250)
    const n = (await evaluer(`document.querySelectorAll('.conv-item').length`)) ?? 0
    stable = n > 0 && n === lignes ? stable + 1 : 0
    lignes = n
  }
  const inventaire = await evaluer(`(async () => {
    const t = performance.now()
    const l = await window.api.conversations()
    return { n: l.length, ipcMs: Math.round(performance.now() - t), octets: JSON.stringify(l).length,
      cible: l.find((c) => !c.surlignee)?.id ?? null }
  })()`)
  console.log(
    `liste : ${lignes} lignes affichées, ${inventaire?.n} conversations (${inventaire?.octets} octets, IPC ${inventaire?.ipcMs} ms)`
  )
  if (!lignes || !inventaire?.cible) {
    console.error('liste vide ou aucune conversation à basculer')
    ws.close()
    return 3
  }
  await cdp('Profiler.enable')
  await cdp('Profiler.setSamplingInterval', { interval: 200 })
  const resultats = []
  for (let essai = 1; essai <= essais; essai += 1) {
    await evaluer(`(() => {
      window.__sondeListe = { longues: [] }
      window.__sondeListeObs?.disconnect()
      window.__sondeListeObs = new PerformanceObserver((liste) => {
        for (const e of liste.getEntries()) window.__sondeListe.longues.push(Math.round(e.duration))
      })
      window.__sondeListeObs.observe({ type: 'longtask', buffered: false })
      return true
    })()`)
    await cdp('Profiler.start')
    // UN rafraîchissement réel : le main écrit, diffuse `refresh conversations`, la vue recharge.
    const bascule = essai % 2 === 1
    await evaluer(
      `window.api.conversationsSetHighlight(${JSON.stringify(inventaire.cible)}, ${bascule})`
    )
    // Fin : la ligne basculée porte son nouvel état, puis 1,5 s de calme.
    for (let i = 0; i < 80; i += 1) {
      await attendre(250)
      if ((await evaluer(ligneSurlignee(inventaire.cible))) === bascule) break
    }
    prochainEtat = !bascule
    await attendre(1_500)
    const { profile } = (await cdp('Profiler.stop')).result
    const mesure = await evaluer(`window.__sondeListe`)
    const classe = classerProfil(profile)
    resultats.push({
      essai,
      lignes,
      tachesLongues: mesure?.longues ?? [],
      cpuMs: classe.totalMs,
      parFichier: classe.parFichier.slice(0, top),
      parFonction: classe.parFonction.slice(0, top),
      inclusif: classe.inclusif.slice(0, top * 2)
    })
    console.log(
      `essai ${essai} : tâches longues ${JSON.stringify(mesure?.longues ?? [])} ms, CPU ${classe.totalMs} ms`
    )
    for (const f of classe.parFichier.slice(0, 6)) console.log(`   fichier ${f.ms} ms  ${f.nom}`)
    for (const f of classe.parFonction.slice(0, 10)) console.log(`   propre ${f.ms} ms  ${f.nom}`)
    for (const f of classe.inclusif.filter((x) => /src\//.test(x.nom)).slice(0, 12))
      console.log(`   inclusif ${f.ms} ms  ${f.nom}`)
  }
  const comptage = await compterLignes(cdp, evaluer, inventaire.cible)
  const sousCharge = chargeCpu > 0 ? await mesurerSousCharge(cdp, evaluer, inventaire.cible) : null
  const apresRechargement = rechargements > 0 ? await mesurerRechargements(cdp, evaluer) : null
  const mode = sansReutilisation ? 'avant (sans réutilisation)' : 'code courant'
  console.log(`mode : ${mode} ; module intercepté ${interceptions.servies} fois`)
  mkdirSync(dirname(sortie), { recursive: true })
  writeFileSync(
    sortie,
    JSON.stringify(
      {
        mode,
        interceptions,
        inventaire,
        lignes,
        comptage,
        resultats,
        sousCharge,
        apresRechargement
      },
      null,
      2
    )
  )
  if (sansReutilisation && interceptions.servies === 0) {
    console.error(
      `interception sans effet : l'AVANT n'a pas été servi (${JSON.stringify(interceptions)})`
    )
    ws.close()
    return 3
  }
  console.log(`rapport : ${sortie}`)
  ws.close()
  return 0
}

if (process.argv[1]?.endsWith('cdp-profil-liste-chat.mjs')) {
  principal().then(
    (code) => process.exit(code),
    (erreur) => {
      console.error(erreur)
      process.exit(1)
    }
  )
}
