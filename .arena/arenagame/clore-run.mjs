#!/usr/bin/env node
// Clôt le RUN.md d'un bras arenagame au moment où check.mjs le note.
// Usage : node clore-run.mjs <note-<b>.json> <out-<b>-1.json>
//
// Pourquoi (2026-09-23) : les bras n'écrivent jamais `status:` dans leur RUN.md. Autowin lit alors
// `unknown`, que `isBlocked` (src/shared/run-blocked.ts) compte comme BLOQUÉ : 46 essais terminés et
// notés remontaient comme runs bloqués dans l'état de l'app et masquaient les vrais blocages.
//
// Statut : `green` si check.mjs a atteint son critère (`critere: true`, auto >= seuil), `red` sinon
// (note absente ou illisible comprise). Le verdict vient du correcteur, jamais du bras.
//
// Lien bras -> RUN.md : le nom du dossier de run est choisi par l'agent (ce n'est PAS le session_id).
// La seule source déterministe est le journal de session Claude
// (~/.claude/projects/<cwd>/<session_id>.jsonl), qui garde chaque appel d'outil avec son horodatage.
//
// Un RUN.md compte comme ÉCRIT par la session s'il est la cible :
//  (1) d'un outil d'écriture (Write, Edit, MultiEdit) — jamais Read : lire le RUN.md d'un autre bras
//      ne le rend pas sien (t4 a-1 a relu celui de a-2) ;
//  (2) d'une commande Bash ou PowerShell qui écrit : redirection `>`/`>>`, Add-Content, Set-Content,
//      Out-File, New-Item, Tee-Object, tee, touch, sed/perl -i, [IO.File]::Write*/Append*, destination
//      de cp/mv/Copy-Item/Move-Item. Chemin littéral, variable affectée dans la même commande, ou
//      préfixe ~, $HOME, $env:USERPROFILE, %USERPROFILE% (développés en homedir()).
// Pourquoi (2) (2026-09-25) : en t4, a-1, b-1 et c-1 tenaient leur RUN.md par
// `Add-Content "$env:USERPROFILE\.claude\runs\…\RUN.md"`. L'ancienne recherche du seul `"file_path"`
// les ratait (essais/t4-2026-09-24/RUN.md, point 2 : « non localisé ») et Autowin les comptait bloqués.
// Garde « pendant la session » : le fichier doit avoir été modifié APRÈS un appel qui le vise.
// Limite : un chemin relatif (après un `cd`) ou construit par une fonction (Join-Path) n'est pas suivi.
//
// RANGEMENT (voie 3, choix de l'utilisateur du 2026-09-25) : une fois le statut posé, le dossier du
// RUN.md quitte ~/.claude/runs pour <dossier du out.json>/runs/<même chemin relatif>.
// Pourquoi : le statut ne suffit pas. `isBlocked` (src/shared/run-blocked.ts:18) bloque aussi toute DoD
// incomplète, et un bras coche rarement toutes ses cases : le 2026-09-25, les 7 runs bloqués d'Autowin
// étaient 7 bras d'essai. Un bras est un objet de mesure, pas un travail de l'utilisateur ; son verdict
// vit dans note-*.json. Écartées : faire cocher les cases par check.mjs (il ne rejoue aucune preuve du
// bras : 0/6, 1/8, 1/8 cases identiques sur t4) et une exception « essai » dans isBlocked (elle aurait
// passé au vert m2 c-1, dont le RUN.md dit « NON TENU »).
// Copie vérifiée fichier par fichier PUIS suppression de la source (C: -> D: interdit un rename).
// Jamais d'écrasement : destination déjà présente = dossier laissé en place. Jamais la racine des runs.
// Un second appel (lance-bras.sh puis nuit.sh) retrouve le RUN.md déjà rangé et y repose le statut.
// Le nettoyage de la skill n'efface que les chemins de manifeste.txt : <série>/runs/ survit.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

const [noteF, outF] = process.argv.slice(2)
if (!noteF || !outF) {
  console.error('usage : clore-run.mjs <note.json> <out.json>')
  process.exit(2)
}
const lire = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const note = lire(noteF)
const statut = note?.critere === true ? 'green' : 'red'
const out = lire(outF)
const sid = out?.session_id
if (!sid) {
  console.log(`clore-run : pas de session_id dans ${outF} — aucun RUN.md clos`)
  process.exit(0)
}

const HOME = homedir()
const projets = join(HOME, '.claude', 'projects')
// Racine des runs : ~/.claude/runs, ou celle d'un bras ISOLÉ (conv-826, 2026-09-26) — lance-bras.sh le fait tourner
// hors du dépôt, lui ferme ~/.claude/runs et écrit dans out.json la racine où vit son RUN.md (`runs_racine`).
const racineRuns = resolve(out?.runs_racine ? String(out.runs_racine) : join(HOME, '.claude', 'runs')).toLowerCase() + sep
let journal = null
for (const d of existsSync(projets) ? readdirSync(projets) : []) {
  const f = join(projets, d, `${sid}.jsonl`)
  if (existsSync(f)) {
    journal = f
    break
  }
}
if (!journal) {
  console.log(`clore-run : journal de session ${sid} introuvable — aucun RUN.md clos`)
  process.exit(0)
}

/** Découpe une commande shell en instructions (listes de mots), guillemets et échappements résolus. */
function instructions(commande, ps) {
  let c = commande.replace(/\r\n/g, '\n')
  // Corps des here-strings PowerShell et des heredocs bash : c'est du CONTENU écrit, jamais une cible.
  if (ps) c = c.replace(/@(['"])[ \t]*\n[\s\S]*?\n\1@/g, "''")
  else c = c.replace(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n[\s\S]*?\n\t*\2[ \t]*(?=\n|$)/g, '$3')
  const esc = ps ? '`' : '\\'
  const res = []
  let mots = []
  let mot = ''
  let ouvert = false
  let q = null
  const finMot = () => {
    if (ouvert) mots.push(mot)
    mot = ''
    ouvert = false
  }
  const finInstr = () => {
    finMot()
    if (mots.length) res.push(mots)
    mots = []
  }
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]
    if (q === "'") {
      if (ch !== "'") mot += ch
      else if (ps && c[i + 1] === "'") mot += c[++i]
      else q = null
    } else if (q === '"') {
      if (ch === '"') q = null
      else if (ch === esc && i + 1 < c.length && (ps || '$`"\\\n'.includes(c[i + 1]))) mot += c[++i]
      else mot += ch
    } else if (ch === "'" || ch === '"') {
      q = ch
      ouvert = true
    } else if (ch === esc && i + 1 < c.length) {
      if (c[++i] === '\n') finMot()
      else {
        mot += c[i]
        ouvert = true
      }
    } else if (ch === '#' && !ouvert) {
      while (i + 1 < c.length && c[i + 1] !== '\n') i++
    } else if (ch === ' ' || ch === '\t') finMot()
    else if (ch === '\n' || ch === ';') finInstr()
    else if (ch === '|' || (ch === '&' && c[i + 1] === '&')) {
      if (c[i + 1] === ch) i++
      finInstr()
    } else if (ch === '>') {
      // `2>`, `&>`, `*>` : le préfixe fait partie de l'opérateur.
      if (ouvert && /^[\d&*]$/.test(mot)) {
        mot = ''
        ouvert = false
      } else finMot()
      if (c[i + 1] === '>') i++
      mots.push('>')
    } else {
      mot += ch
      ouvert = true
    }
  }
  finInstr()
  return res
}

const ECRIT = /^(add-content|set-content|out-file|new-item|tee-object|clear-content|ac|sc|tee|touch)$/i
const EN_PLACE = /^(sed|perl)$/i
const COPIE = /^(cp|mv|install|copy-item|move-item|cpi|mi|copy|move)$/i
const CONTENU = /^-(va|inp)/i // -Value / -InputObject : ce qui est écrit, pas où
const ECRIT_NET = /::(?:write|append)all(?:text|lines|bytes)\(([^,)]*)/i

/** Mots désignant un fichier ÉCRIT par une instruction (variables déjà substituées). */
function cibles(mots) {
  const res = []
  for (let i = 0; i + 1 < mots.length; i++) if (mots[i] === '>') res.push(mots[i + 1])
  for (const m of mots) {
    const n = ECRIT_NET.exec(m)
    if (n) res.push(n[1].trim())
  }
  const j = mots.findIndex((m) => ECRIT.test(m) || EN_PLACE.test(m) || COPIE.test(m))
  if (j === -1) return res
  const suite = mots.slice(j + 1, mots.includes('>') ? mots.indexOf('>') : undefined)
  if (COPIE.test(mots[j])) {
    const args = suite.filter((m) => !m.startsWith('-') && !['{', '}', '(', ')'].includes(m))
    if (args.length) res.push(args.at(-1))
  } else if (!EN_PLACE.test(mots[j]) || suite.some((m) => /^(-i|--in-place)/.test(m))) {
    for (let k = 0; k < suite.length; k++) {
      if (CONTENU.test(suite[k])) k++
      else res.push(suite[k])
    }
  }
  return res
}

/** RUN.md que les commandes Bash / PowerShell de la session écrivent : chemin -> horodatage de l'appel. */
function ecritsParShell(commande, ps) {
  const vars = new Map()
  const cle = (n) => (ps ? n.toLowerCase() : n)
  const sub = (m) => m.replace(/\$\{(\w+)\}|\$(\w+)(?![\w:])/g, (x, a, b) => vars.get(cle(a ?? b)) ?? x)
  const res = []
  for (const brut of instructions(commande, ps)) {
    const mots = brut.map(sub)
    // Affectations : `$p = "…"`, `$p="…"` (PowerShell) ; `p=…`, `export p=…` (bash).
    const a = ps && /^\$(\w+)$/.test(brut[0]) && mots[1] === '=' ? [brut[0].slice(1), mots[2]] : null
    const b = /^(\$?)([A-Za-z_]\w*)=(.*)$/s.exec(brut[brut[0] === 'export' ? 1 : 0] ?? '')
    if (a) vars.set(cle(a[0]), a[1] ?? '')
    else if (b && (b[1] === '$') === ps) vars.set(cle(b[2]), sub(b[3]))
    res.push(...cibles(mots))
  }
  return res
}

/** Développe le dossier personnel et les chemins MSYS (/c/…) ; null si ce n'est pas un RUN.md absolu. */
function cheminRun(m) {
  const p = m
    .replace(/^(?:~|\$\{?home\}?|\$env:(?:userprofile|home)|%userprofile%)(?=[\\/])/i, () => HOME)
    .replace(/^\/([a-z])(?=\/)/i, '$1:')
  return /(^|[\\/])RUN\.md$/i.test(p) && isAbsolute(p) ? resolve(p) : null
}

// chemin -> horodatage du PREMIER appel qui l'écrit (un seul suffit à prouver l'écriture).
const vises = new Map()
for (const ligne of readFileSync(journal, 'utf8').split('\n')) {
  let o
  try {
    o = JSON.parse(ligne)
  } catch {
    continue
  }
  const contenu = o?.message?.content
  if (!Array.isArray(contenu)) continue
  const t = Date.parse(o.timestamp)
  for (const u of contenu) {
    if (u?.type !== 'tool_use' || !u.input) continue
    let mots = []
    if (['Write', 'Edit', 'MultiEdit'].includes(u.name)) mots = [u.input.file_path ?? '']
    else if (u.name === 'Bash' || u.name === 'PowerShell') mots = ecritsParShell(String(u.input.command ?? ''), u.name === 'PowerShell')
    for (const m of mots) {
      const p = cheminRun(m)
      if (p && !(vises.get(p) <= t)) vises.set(p, t)
    }
  }
}
// Rangement : <dossier du out.json>/runs/<chemin relatif sous la racine des runs>.
const rangement = join(dirname(resolve(outF)), 'runs')
const estRacine = (d) => resolve(d).toLowerCase() + sep === racineRuns
const chemins = new Set()
for (const [p, t] of vises) {
  // Portée stricte : seuls les RUN.md de la racine des runs, jamais un fichier du dépôt.
  if (!p.toLowerCase().startsWith(racineRuns)) continue
  // Déjà rangé par un appel précédent pour cette même session : le statut y est reposé.
  const range = join(rangement, p.slice(racineRuns.length))
  const ici = existsSync(p) ? p : existsSync(range) ? range : null
  if (!ici) continue
  // Pendant la session : modifié après l'appel (2 s de marge pour la granularité du système de fichiers).
  if (Number.isFinite(t) && statSync(ici).mtimeMs < t - 2000) continue
  chemins.add(ici)
}

/** Déplace le dossier du RUN.md sous `rangement` — jamais d'écrasement, jamais la racine des runs. */
function ranger(p) {
  const dossier = dirname(p)
  if (!p.toLowerCase().startsWith(racineRuns) || estRacine(dossier)) return
  const dest = join(rangement, dossier.slice(racineRuns.length))
  if (existsSync(dest)) {
    console.log(`clore-run : ${dest} existe déjà — ${dossier} laissé en place`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(dossier, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  // La source ne part qu'une fois CHAQUE fichier retrouvé à l'identique dans la copie.
  for (const f of readdirSync(dossier, { recursive: true })) {
    const a = join(dossier, String(f))
    const b = join(dest, String(f))
    if (statSync(a).isFile() && !(existsSync(b) && readFileSync(a).equals(readFileSync(b)))) {
      console.log(`clore-run : copie incomplète (${a}) — ${dossier} laissé en place`)
      return
    }
  }
  rmSync(dossier, { recursive: true })
  // Le dossier de session qui ne contenait que ce sujet est retiré ; un voisin le garde en place.
  const parent = dirname(dossier)
  if (!estRacine(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
  console.log(`clore-run : ${dossier} rangé dans ${dest}`)
}
if (chemins.size === 0) console.log(`clore-run : aucun RUN.md écrit par la session ${sid}`)

for (const p of chemins) {
  const md = readFileSync(p, 'utf8')
  const nl = md.includes('\r\n') ? '\r\n' : '\n'
  const lignes = md.split(/\r?\n/)
  // `status:` n'est lu que dans l'en-tête, avant le premier `## ` (src/main/dashboards/runs.ts parseRun).
  let fin = lignes.findIndex((l) => l.startsWith('## '))
  if (fin === -1) fin = lignes.length
  const i = lignes.slice(0, fin).findIndex((l) => /^\s*status:/i.test(l))
  // VERDICT DU BRAS (conv-826, 2026-09-26) : le `status:` que le bras a posé lui-même est recopié UNE fois dans
  // `status_bras:` avant d'être remplacé par celui de check.mjs. Sans lui, nuit-2026-09-26 m2 a-1 (`red` posé à
  // 09:05:21) ressortait `green` et le verdict déclaré — comparé à check.mjs par la note « preuve honnête » — était
  // perdu. Premier passage seulement : ensuite le `status:` est le nôtre (second appel lance-bras.sh puis nuit.sh).
  // `status_bras:` ne répond pas à `^\s*status:` : Autowin (src/main/dashboards/runs.ts) lit toujours check.mjs.
  // Un RUN.md trouvé déjà RANGÉ a été clos avant ce correctif : son `status:` est celui de clore-run, le verdict du
  // bras est perdu → `inconnu`, jamais notre propre statut. Limite : clos avant ce correctif mais resté sous
  // ~/.claude/runs (rangement refusé), il recevrait le statut de clore-run.
  const brasLu = !lignes.slice(0, fin).some((l) => /^\s*status_bras:/i.test(l))
  const dejaRange = !p.toLowerCase().startsWith(racineRuns)
  const verdictBras = dejaRange ? 'inconnu' : i !== -1 ? lignes[i].replace(/^\s*status:\s*/i, '').trim() || 'aucun' : 'aucun'
  let pos
  if (i !== -1) {
    lignes[i] = `status: ${statut}`
    pos = i
  } else {
    const ancre = lignes.slice(0, fin).findIndex((l) => /^\s*regime:/i.test(l))
    const apres = ancre !== -1 ? ancre : lignes.slice(0, fin).findIndex((l) => /^\s*session:/i.test(l))
    lignes.splice(apres + 1, 0, `status: ${statut}`)
    pos = apres + 1
  }
  if (brasLu) lignes.splice(pos + 1, 0, `status_bras: ${verdictBras}`)
  writeFileSync(p, lignes.join(nl), 'utf8')
  console.log(`clore-run : ${p} -> status: ${statut}`)
  ranger(p)
}
