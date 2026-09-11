#!/usr/bin/env node
/**
 * REJOUE LE COUT DES TOURS DE CHAT DEJA PASSES dans `cost.jsonl`.
 *
 * Le compteur de cout n'etait alimente que par l'orchestration : les tours de chat du superviseur
 * s'arretaient dans `activity/<conv>.jsonl` (evenements `chat-usage`). Le cablage pose dans
 * `src/main/chat/run-pilot-chat.ts` regle le FUTUR ; ce script rattrape le PASSE.
 *
 * Sans doublon : chaque ligne ecrite porte `backfillSource` (conversation + horodatage de
 * l'evenement d'origine). Une relance ignore tout ce qui porte deja cette cle, et ignore aussi les
 * lignes `role: supervisor` ecrites en direct par l'app au meme horodatage.
 *
 * Par defaut : SIMULATION (rien n'est ecrit). `--apply` ecrit vraiment.
 *
 * Usage :
 *   node scripts/backfill-cout-chat.mjs [--data <racine>] [--apply]
 */
import { readFileSync, appendFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dataArg = args.indexOf('--data')
const root =
  dataArg >= 0 && args[dataArg + 1]
    ? args[dataArg + 1]
    : join(process.cwd(), '.autowin-data', 'autowin-os')

const activityDir = join(root, 'activity')
const costPath = join(root, 'cost.jsonl')
if (!existsSync(activityDir)) {
  console.error(`Aucun journal d'activite dans ${activityDir}`)
  process.exit(1)
}

const lignesDe = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    : []

// --- Etat AVANT
const avant = lignesDe(costPath)
const totalDe = (lignes) => lignes.reduce((s, t) => s + (Number(t.costUsd) || 0), 0)
const dejaVu = new Set()
for (const t of avant) {
  if (t.backfillSource) dejaVu.add(t.backfillSource)
  if (t.role === 'supervisor' && t.conversationId && t.ts)
    dejaVu.add(`${t.conversationId}|${t.ts}`)
}

// --- Candidats : les `chat-usage` du journal d'activite (deja deltaises a l'ecriture)
const candidats = []
for (const fichier of readdirSync(activityDir)) {
  if (!fichier.endsWith('.jsonl')) continue
  const conversationId = fichier.replace(/\.jsonl$/, '')
  for (const e of lignesDe(join(activityDir, fichier))) {
    if (e.kind !== 'chat-usage') continue
    const cle = `${conversationId}|${e.ts}`
    if (dejaVu.has(cle)) continue
    dejaVu.add(cle)
    candidats.push({
      provider: e.provider || 'claude',
      role: 'supervisor',
      ...(e.model ? { model: e.model } : {}),
      inputTokens: Number(e.inputTokens) || 0,
      outputTokens: Number(e.outputTokens) || 0,
      ...(e.cacheReadTokens ? { cacheReadTokens: Number(e.cacheReadTokens) } : {}),
      ...(e.cacheCreationTokens ? { cacheCreationTokens: Number(e.cacheCreationTokens) } : {}),
      // Un tour NON tarife reste non tarife : poser 0 le ferait passer pour gratuit.
      ...(Number(e.costUsd) > 0 ? { costUsd: Number(e.costUsd) } : {}),
      conversationId,
      ...(e.turnId ? { turnId: e.turnId } : {}),
      ts: e.ts,
      backfillSource: cle
    })
  }
}

const ajoute = totalDe(candidats)
const tarifes = candidats.filter((t) => t.costUsd !== undefined).length

console.log(`Source      : ${activityDir}`)
console.log(`Cible       : ${costPath}`)
console.log(`AVANT       : ${avant.length} tours, ${totalDe(avant).toFixed(2)} USD`)
console.log(`A rejouer   : ${candidats.length} tours de chat (${tarifes} tarifes), ${ajoute.toFixed(2)} USD`)

if (!apply) {
  console.log(
    `APRES (simu): ${avant.length + candidats.length} tours, ${(totalDe(avant) + ajoute).toFixed(2)} USD`
  )
  console.log('\nSIMULATION — rien ecrit. Relance avec --apply pour appliquer.')
  process.exit(0)
}

if (candidats.length === 0) {
  console.log('Rien a rejouer : tout est deja compte.')
  process.exit(0)
}

if (existsSync(costPath)) copyFileSync(costPath, `${costPath}.avant-backfill`)
appendFileSync(costPath, candidats.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8')

const apres = lignesDe(costPath)
console.log(`APRES       : ${apres.length} tours, ${totalDe(apres).toFixed(2)} USD`)
console.log(`Sauvegarde  : ${costPath}.avant-backfill`)
