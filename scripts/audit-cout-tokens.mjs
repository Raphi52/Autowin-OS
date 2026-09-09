#!/usr/bin/env node
// Vérifie, sur les données réelles de l'app, chaque chiffre du repérage « coût en tokens ».
// Aucun chiffre du rapport ne doit être recopié à la main : il est REMESURÉ ici.
// Usage : node scripts/audit-cout-tokens.mjs [--data <dossier de données>] [--repo <racine du dépôt>]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (nom, defaut) => {
  const i = args.indexOf(nom)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}
const dataDir = resolve(opt('--data', 'D:/AutoWinOS/.autowin-data/autowin-os'))
const repoDir = resolve(opt('--repo', process.cwd()))

const lignesJson = (fichier) => {
  const out = []
  if (!existsSync(fichier)) return out
  for (const l of readFileSync(fichier, 'utf8').split('\n')) {
    const t = l.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      /* ligne tronquée : ignorée, jamais devinée */
    }
  }
  return out
}

const fichiersConv = (sous) => {
  const d = join(dataDir, sous)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => f.startsWith('conv-') && f.endsWith('.jsonl'))
    .map((f) => join(d, f))
}

// --- Mesures -----------------------------------------------------------------
const roles = JSON.parse(readFileSync(join(dataDir, 'roles.json'), 'utf8'))
const sourceRoles = readFileSync(join(repoDir, 'src/main/roles.ts'), 'utf8')
const defautCode = /claude:\s*\{[^}]*model:\s*'([^']+)'/.exec(sourceRoles)?.[1] ?? null

let routeOpus = 0
let routeCout = 0
let routeTotal = 0
let usageIn = 0
let usageRead = 0
let usageCreate = 0
for (const f of fichiersConv('activity')) {
  for (const d of lignesJson(f)) {
    if (d.kind === 'conversation-route') {
      routeTotal += 1
      if (d.model === 'claude-opus-5') {
        routeOpus += 1
        routeCout += d.costUsd || 0
      }
    } else if (d.kind === 'chat-usage') {
      usageIn += d.inputTokens || 0
      usageRead += d.cacheReadTokens || 0
      usageCreate += d.cacheCreationTokens || 0
    }
  }
}

let sysOrch = 0
let nbOrch = 0
for (const f of fichiersConv('prompt-observability')) {
  for (const d of lignesJson(f)) {
    if (d.actor !== 'orchestrator') continue
    nbOrch += 1
    sysOrch += (d.system || '').length
  }
}
const moyenneSystemOrch = nbOrch ? Math.round(sysOrch / nbOrch) : 0
const partCacheLu = usageIn ? (usageRead / usageIn) * 100 : 0

// --- Assertions --------------------------------------------------------------
const constats = [
  {
    nom: 'le routeur tourne sur opus-5 à cause du fichier de réglages, pas du défaut du code',
    ok:
      roles.orchestrator?.model === 'claude-opus-5' &&
      defautCode !== null &&
      defautCode !== 'claude-opus-5',
    vu: `roles.json=${roles.orchestrator?.model} / défaut src/main/roles.ts=${defautCode}`
  },
  {
    nom: 'le classement des conversations pèse ≥ 1000 appels opus-5 et ≥ 25 $',
    ok: routeOpus >= 1000 && routeCout >= 25,
    vu: `${routeOpus} appels opus-5 sur ${routeTotal} classements, ${routeCout.toFixed(2)} $`
  },
  {
    nom: "le coût d'écriture du cache n'est pas mesuré localement (donc le gain d'un cache 1 h reste une hypothèse)",
    ok: usageCreate === 0,
    vu: `cacheCreationTokens cumulés = ${usageCreate}`
  },
  {
    nom: 'les tokens d’entrée sont déjà lus depuis le cache à ≥ 95 %',
    ok: partCacheLu >= 95,
    vu: `${partCacheLu.toFixed(1)} % (${usageRead} lus / ${usageIn} entrants)`
  },
  {
    nom: 'la consigne fixe envoyée à chaque tour du chat dépasse 50 000 caractères en moyenne',
    ok: moyenneSystemOrch >= 50000,
    vu: `${moyenneSystemOrch} caractères sur ${nbOrch} appels`
  }
]

let rouge = 0
for (const c of constats) {
  console.log(`${c.ok ? 'OK  ' : 'ROUGE'} ${c.nom}\n      mesuré : ${c.vu}`)
  if (!c.ok) rouge += 1
}
console.log(
  rouge === 0 ? 'TOUS LES CHIFFRES DU RAPPORT SONT REMESURÉS' : `${rouge} constat(s) faux`
)
process.exit(rouge === 0 ? 0 : 1)
