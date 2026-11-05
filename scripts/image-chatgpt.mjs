#!/usr/bin/env node
/**
 * PREMIÈRE VOIE pour générer une image 2D (décor de l'Accueil, bâtiment, icône, illustration) : le compte
 * ChatGPT, par l'outil en ligne de commande Codex (conv-1603). Règle de l'utilisateur : la génération
 * d'images 2D passe par ChatGPT. `scripts/generer-image.mjs` (OpenRouter, gpt-image-2 / gemini-3-pro-image)
 * est PAYANT à l'image : seulement si l'utilisateur le demande nommément.
 *
 * Usage : node scripts/image-chatgpt.mjs --prompt "<texte>" --sortie <fichier.png>
 *           [--reference <image>]... [--fond transparent] [--ratio 1:1|2:3|3:2|16:9] [--n 1..4]
 *           [--delai <secondes, défaut 600>]
 *
 * Comment : `codex exec` tourne dans un dossier temporaire neuf, ses outils de contrôle d'écran coupés (au
 * premier essai, conv-1603, il est parti sur `computer_use` au lieu de dessiner) et `image_generation`
 * activé (`codex features list` : stable). Il reçoit les références par `-i` et doit écrire image-1.png…
 * dans ce dossier ; à défaut, on reprend ses images neuves de $CODEX_HOME/generated_images
 * (emplacement décrit par https://www.skillsdirectory.com/skills/takazudo-codex-imagegen).
 *
 * Jamais facturé à l'API : les clés OPENAI_API_KEY / CODEX_API_KEY sont retirées de son environnement, et le
 * script refuse un Codex connecté par clé (~/.codex/auth.json, `auth_mode` ≠ chatgpt) — avec une clé, Codex
 * bascule sur la facturation API. L'image compte dans les limites d'usage du compte ChatGPT
 * (https://github.com/GenericJam/rho/releases/tag/v0.4.0). Aucune valeur de clé n'est lue ni affichée.
 *
 * Codes de sortie : 0 image(s) écrite(s) · 2 usage · 3 Codex introuvable · 4 aucune image rendue ·
 * 5 Codex connecté par clé d'API (refus) · 6 limite d'usage du compte ChatGPT atteinte (date de reprise dite).
 */
import { spawn, execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLES_API = ['OPENAI_API_KEY', 'CODEX_API_KEY']
const EXTENSIONS = /\.(png|webp|jpe?g)$/i

/** L'environnement de Codex sans clé d'API : une clé présente ferait facturer l'image à l'API. */
export function envSansCleApi(env) {
  const copie = { ...env }
  for (const k of CLES_API) delete copie[k]
  return copie
}

/** Codex est-il connecté par le compte ChatGPT (abonnement), et non par une clé d'API ? */
export function connexionChatgpt(auth) {
  if (!auth)
    return {
      ok: false,
      motif: 'Codex non connecté (~/.codex/auth.json absent) : lance `codex login`'
    }
  if (auth.OPENAI_API_KEY)
    return {
      ok: false,
      motif: "Codex porte une clé d'API : l'image serait facturée à l'API, refus"
    }
  if (auth.auth_mode !== 'chatgpt')
    return {
      ok: false,
      motif: `Codex connecté en « ${auth.auth_mode} », pas par le compte ChatGPT : refus`
    }
  return { ok: true }
}

export function argumentsCodex({ dossier, references = [] }) {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-s',
    'workspace-write',
    '-C',
    dossier,
    '--enable',
    'image_generation',
    '--disable',
    'computer_use',
    '--disable',
    'browser_use',
    ...references.flatMap((r) => ['-i', r]),
    '-'
  ]
}

export function promptPourCodex({ prompt, n = 1, fond, ratio }) {
  const fichiers = Array.from({ length: n }, (_, i) => `image-${i + 1}.png`)
  return [
    `Use your built-in image generation tool to create ${n === 1 ? 'one image' : `${n} distinct images`}.`,
    'Do not draw it with code, scripts, SVG or any other program: only the image generation tool.',
    fond === 'transparent' ? 'The background must be fully transparent (PNG with alpha).' : '',
    ratio ? `Aspect ratio: ${ratio}.` : '',
    'Any attached images are references: follow their style, palette and lighting.',
    `Save the result in the current directory as: ${fichiers.join(', ')}.`,
    'When done, answer with the file names only.',
    '',
    'Image description:',
    prompt
  ]
    .filter((l, i, t) => l !== '' || (i > 0 && t[i - 1] !== ''))
    .join('\n')
}

/** Le flux `codex exec --json` : fil, limite d'usage et sa reprise, commandes lancées, messages. */
export function lireJournal(lignes) {
  const r = { fil: null, limite: null, echec: false, commandes: [], messages: [], erreurs: [] }
  for (const l of lignes) {
    let ev
    try {
      ev = JSON.parse(l)
    } catch {
      continue
    }
    if (ev.type === 'thread.started') r.fil = ev.thread_id ?? null
    if (ev.type === 'turn.failed') r.echec = true
    const message =
      ev.type === 'error' ? ev.message : ev.type === 'turn.failed' ? ev.error?.message : null
    if (message) {
      r.erreurs.push(message)
      if (/usage limit/i.test(message) && !r.limite) {
        const reprise = /try again at (.+?)\.?$/i.exec(message)?.[1] ?? null
        r.limite = { reprise }
      }
    }
    const item = ev.type === 'item.completed' ? ev.item : null
    if (item?.type === 'command_execution') r.commandes.push(item.command)
    if (item?.type === 'agent_message' && item.text) r.messages.push(item.text)
  }
  return r
}

/** Même convention que generer-image.mjs : une image → <sortie>, plusieurs → <sortie>-1.png, -2.png… */
export function nomsDeSortie(sortie, n) {
  if (n <= 1) return [sortie]
  return Array.from({ length: n }, (_, i) =>
    sortie.replace(/(\.\w+)?$/, (ext) => `-${i + 1}${ext || '.png'}`)
  )
}

/** Le binaire natif de Codex (le wrapper codex.js le relancerait), puis le wrapper, puis la commande nue. */
function commandeCodex() {
  if (process.platform !== 'win32') return { cmd: 'codex', args: [] }
  let dossier
  try {
    dossier = dirname(
      execFileSync('where', ['codex.cmd'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
    )
  } catch {
    return null
  }
  const paquet = join(dossier, 'node_modules', '@openai', 'codex')
  const natif = join(
    paquet,
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  )
  if (existsSync(natif)) return { cmd: natif, args: [] }
  const entree = join(paquet, 'bin', 'codex.js')
  if (existsSync(entree)) return { cmd: process.execPath, args: [entree] }
  return null
}

function imagesNeuves(dossier, depuis) {
  if (!existsSync(dossier)) return []
  const out = []
  const parcourir = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) parcourir(p)
      else if (EXTENSIONS.test(e.name) && statSync(p).mtimeMs >= depuis) out.push(p)
    }
  }
  parcourir(dossier)
  return out.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

async function principal() {
  const args = process.argv.slice(2)
  const opt = (n, d) => {
    const i = args.indexOf(`--${n}`)
    return i >= 0 ? args[i + 1] : d
  }
  const prompt = opt('prompt')
  const sortie = opt('sortie')
  const n = Math.min(4, Math.max(1, Number(opt('n', '1')) || 1))
  if (!prompt || !sortie) {
    console.error(
      'usage : --prompt "<texte>" --sortie <fichier.png> [--reference <image>]... [--fond transparent] [--ratio 2:3] [--n 3]'
    )
    process.exit(2)
  }
  const references = args.flatMap((a, i) =>
    a === '--reference' && args[i + 1] ? [resolve(args[i + 1])] : []
  )
  const manquante = references.find((r) => !existsSync(r))
  if (manquante) {
    console.error(`référence introuvable : ${manquante}`)
    process.exit(2)
  }

  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  let auth = null
  try {
    auth = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf8'))
  } catch {
    auth = null
  }
  const connexion = connexionChatgpt(auth)
  if (!connexion.ok) {
    console.error(connexion.motif)
    process.exit(5)
  }
  const codex = commandeCodex()
  if (!codex) {
    console.error('Codex introuvable (npm i -g @openai/codex)')
    process.exit(3)
  }

  const dossier = mkdtempSync(join(tmpdir(), 'image-chatgpt-'))
  const debut = Date.now()
  const delai = Number(opt('delai', '600')) * 1000
  const lignes = []
  const code = await new Promise((fin) => {
    const enfant = spawn(codex.cmd, [...codex.args, ...argumentsCodex({ dossier, references })], {
      cwd: dossier,
      env: envSansCleApi(process.env),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let reste = ''
    enfant.stdout.on('data', (b) => {
      reste += b.toString('utf8')
      const morceaux = reste.split(/\r?\n/)
      reste = morceaux.pop() ?? ''
      lignes.push(...morceaux)
    })
    enfant.stderr.on('data', () => {})
    const minuteur = setTimeout(() => enfant.kill(), delai)
    enfant.on('close', (c) => {
      clearTimeout(minuteur)
      if (reste) lignes.push(reste)
      fin(c)
    })
    enfant.stdin.end(promptPourCodex({ prompt, n, fond: opt('fond'), ratio: opt('ratio') }))
  })

  const journal = lireJournal(lignes)
  if (journal.limite) {
    console.error(
      `limite d'usage du compte ChatGPT atteinte (Codex)${journal.limite.reprise ? ` — reprise : ${journal.limite.reprise}` : ''}`
    )
    process.exitCode = 6
    return
  }
  // Ses images : d'abord celles qu'il a écrites dans le dossier, sinon celles qu'il a rangées chez lui.
  let images = imagesNeuves(dossier, debut)
  if (!images.length) images = imagesNeuves(join(codexHome, 'generated_images'), debut)
  if (!images.length) {
    console.error(
      `aucune image rendue (code ${code}) : ${[...journal.erreurs, ...journal.messages].join(' | ').slice(0, 600)}`
    )
    process.exitCode = 4
    return
  }
  const cibles = nomsDeSortie(sortie, Math.min(n, images.length))
  cibles.forEach((c, i) => copyFileSync(images[i], c))
  console.log(
    JSON.stringify({
      sorties: cibles,
      voie: 'chatgpt-codex',
      fil: journal.fil,
      // Une commande lancée peut vouloir dire une image DESSINÉE par script au lieu d'être générée : à relire.
      commandesLancees: journal.commandes
    })
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await principal()
