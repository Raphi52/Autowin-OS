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
// (~/.claude/projects/<cwd>/<session_id>.jsonl), qui garde le chemin exact de chaque fichier écrit.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

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
const sid = lire(outF)?.session_id
if (!sid) {
  console.log(`clore-run : pas de session_id dans ${outF} — aucun RUN.md clos`)
  process.exit(0)
}

const projets = join(homedir(), '.claude', 'projects')
const racineRuns = resolve(join(homedir(), '.claude', 'runs')).toLowerCase() + sep
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

const chemins = new Set()
for (const m of readFileSync(journal, 'utf8').matchAll(/"file_path":"((?:[^"\\]|\\.)*?RUN\.md)"/g)) {
  const p = resolve(JSON.parse(`"${m[1]}"`))
  // Portée stricte : seuls les RUN.md de la racine des runs, jamais un fichier du dépôt.
  if (p.toLowerCase().startsWith(racineRuns) && existsSync(p)) chemins.add(p)
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
  if (i !== -1) lignes[i] = `status: ${statut}`
  else {
    const ancre = lignes.slice(0, fin).findIndex((l) => /^\s*regime:/i.test(l))
    const apres = ancre !== -1 ? ancre : lignes.slice(0, fin).findIndex((l) => /^\s*session:/i.test(l))
    lignes.splice(apres + 1, 0, `status: ${statut}`)
  }
  writeFileSync(p, lignes.join(nl), 'utf8')
  console.log(`clore-run : ${p} -> status: ${statut}`)
}
