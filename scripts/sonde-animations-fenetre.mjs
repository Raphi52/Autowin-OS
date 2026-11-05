#!/usr/bin/env node
/**
 * SONDE : CE QUE COÛTENT LES ANIMATIONS DE LA FENÊTRE OUVERTE (conv-1610, 2026-11-05).
 *
 * Pourquoi : « autowin OS est full laggy » — il a fallu, quatre fois dans le même fil, recopier à la
 * main une sonde par le port de débogage pour savoir quelles animations tournent, lesquelles sont à
 * l'écran, et ce que coûte chaque groupe au processeur de la fenêtre et de la carte graphique.
 *
 * Ce qu'elle fait, en LECTURE (rien n'est écrit dans l'app) :
 *   1. liste les animations en cours de la fenêtre « Autowin OS », visibles ou hors champ ;
 *   2. mesure le processeur de la fenêtre et du processus carte graphique pendant N s ;
 *   3. pour chaque groupe demandé, met ses animations en pause, remesure, puis les relance à leur
 *      phase d'origine (départ restauré) — la fenêtre revient exactement comme avant.
 *
 * Usage : node scripts/sonde-animations-fenetre.mjs [--secondes 8]
 *           [--groupe "libellé=expression JS sur a (Animation)"]...
 *   Sans --groupe : « tout en pause » seulement. Exemple :
 *   --groupe "atomes=a.animationName?.startsWith('aw-atom')" --groupe "lave=a.animationName==='nv-lave'"
 * Sortie 0 ; 2 si l'app ou sa page est introuvable.
 *
 * Limite : la fenêtre réelle bouge pendant la mesure (autres fils qui écrivent) ; comparer des
 * écarts de quelques points n'a pas de sens, refaire la mesure témoin « tel quel » en fin de série.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const secondes = Number(args[args.indexOf('--secondes') + 1]) || 8
const groupes = [['tout en pause', 'true']]
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--groupe') continue
  const [libelle, ...reste] = String(args[i + 1]).split('=')
  groupes.unshift([libelle, reste.join('=')])
}

const fichierPort = join(RACINE, '.autowin-data/autowin-os/DevToolsActivePort')
let port
try {
  port = readFileSync(fichierPort, 'utf8').split(/\r?\n/)[0].trim()
} catch {
  console.error(`introuvable : ${fichierPort} (l'app tourne-t-elle ?)`)
  process.exit(2)
}
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  (p) => p.type === 'page' && p.title === 'Autowin OS'
)
if (!page) {
  console.error('page « Autowin OS » introuvable sur le port de débogage')
  process.exit(2)
}

// Les processus : la fenêtre = le plus gros renderer, la carte graphique = gpu-process.
// Script passé en ligne de commande encodée, sans fichier : un dossier temporaire a été effacé
// en pleine mesure le 2026-11-05 (conv-1610, ENOENT sur p.ps1 entre deux relevés).
const powershell = (script) =>
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-EncodedCommand',
      // Sans cela, la barre de progression de PowerShell sort en XML sur la sortie d'erreur.
      Buffer.from(
        `$ProgressPreference='SilentlyContinue'
${script}`,
        'utf16le'
      ).toString('base64')
    ],
    { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }
  ).toString()
const procs = powershell(
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.WorkingSetSize, ([regex]::Match($_.CommandLine,'--type=(\\S+)').Groups[1].Value) }`
)
  .trim()
  .split(/\r?\n/)
  .map((l) => l.trim().split('|'))
const fenetre = procs.filter((l) => l[2] === 'renderer').sort((a, b) => b[1] - a[1])[0]?.[0]
const carte = procs.find((l) => l[2] === 'gpu-process')?.[0]
const cpu = () =>
  powershell(
    `(Get-Process -Id ${fenetre}).TotalProcessorTime.TotalSeconds; (Get-Process -Id ${carte}).TotalProcessorTime.TotalSeconds`
  )
    .trim()
    .split(/\r?\n/)
    .map((v) => parseFloat(v.trim().replace(',', '.')))

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const attente = new Map()
const envoyer = (method, params = {}) =>
  new Promise((ok, ko) => {
    const n = ++id
    attente.set(n, ok)
    ws.send(JSON.stringify({ id: n, method, params }))
    setTimeout(() => ko(new Error(`${method} sans réponse`)), 30_000)
  })
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
  return r.result.result?.value
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && attente.has(m.id)) {
    attente.get(m.id)(m)
    attente.delete(m.id)
  }
}
await new Promise((ok) => (ws.onopen = ok))

const VISIBLE = `const visible=(el)=>{if(!el?.getBoundingClientRect)return false;const r=el.getBoundingClientRect();if(r.width===0&&r.height===0)return false;if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return false;for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowY+s.overflowX)){const q=p.getBoundingClientRect();if(r.bottom<=q.top||r.top>=q.bottom||r.right<=q.left||r.left>=q.right)return false}}return true};`
const inventaire = await evaluer(
  `(()=>{${VISIBLE}const t={};for(const a of document.getAnimations().filter(a=>a.playState==='running')){const c=a.effect?.target;const k=(a.animationName||'transition')+' @ '+(c?.className?.toString?.()||c?.tagName||'?').slice(0,45)+(a.effect?.pseudoElement||'')+(visible(c)?'  [visible]':'  [hors champ]');t[k]=(t[k]||0)+1}return JSON.stringify(Object.entries(t).sort((a,b)=>b[1]-a[1]))})()`
)
console.log('Animations en cours :')
for (const [k, n] of JSON.parse(inventaire)) console.log(`  ${String(n).padStart(3)} × ${k}`)

const mesurer = async (libelle) => {
  const a = cpu()
  const t = Date.now()
  await new Promise((ok) => setTimeout(ok, secondes * 1000))
  const b = cpu()
  const dt = (Date.now() - t) / 1000
  const pc = (i) => `${((100 * (b[i] - a[i])) / dt).toFixed(0).padStart(3)} %`
  console.log(`${libelle.padEnd(50)} fenêtre ${pc(0)}   carte graphique ${pc(1)}`)
}

try {
  await mesurer('tel quel')
  for (const [libelle, expression] of groupes) {
    const n = await evaluer(
      `(()=>{window.__sondeAnim=document.getAnimations().filter(a=>a.playState==='running'&&(${expression})).map(a=>({a,d:a.startTime}));window.__sondeAnim.forEach(x=>x.a.pause());return window.__sondeAnim.length})()`
    )
    await mesurer(`${libelle} [${n} en pause]`)
    await evaluer(
      `(()=>{for(const x of window.__sondeAnim||[]){x.a.play();if(x.d!==null)x.a.startTime=x.d}delete window.__sondeAnim;return 1})()`
    )
    await new Promise((ok) => setTimeout(ok, 1500))
  }
  await mesurer('tel quel (témoin de fin)')
} finally {
  await evaluer(
    `(()=>{for(const x of window.__sondeAnim||[]){x.a.play();if(x.d!==null)x.a.startTime=x.d}delete window.__sondeAnim;return 1})()`
  ).catch(() => undefined)
  ws.close()
}
process.exit(0)
