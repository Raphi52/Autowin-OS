#!/usr/bin/env node
/**
 * REJOUE LE COUT DES TOURS DE CHAT DEJA PASSES dans `cost.jsonl`.
 *
 * Le compteur de cout n'etait alimente que par l'orchestration : les tours de chat du superviseur
 * s'arretaient dans `activity/<conv>.jsonl` (evenements `chat-usage`). Le cablage pose dans
 * `src/main/chat/run-pilot-chat.ts` regle le FUTUR ; ce script rattrape le PASSE.
 *
 * Sans doublon : chaque ligne ecrite porte `backfillSource` (conversation + horodatage de
 * l'evenement d'origine). Une relance ignore tout ce qui porte deja cette cle. Un tour qui a DEJA
 * une ligne `role: supervisor` ecrite en direct (meme conversation, meme `turnId`) est ignore en
 * entier : le cablage direct compte chaque reglement du tour, du premier au dernier.
 *
 * Pourquoi le `turnId` et pas l'horodatage (residus 2026-10-22, conv-1062) : la ligne directe et
 * l'evenement `chat-usage` du meme reglement sont horodates a quelques millisecondes d'ecart
 * (conv-1000, tour dae33555 : `.956` contre `.960`). L'ancienne cle `conversation|ts` les
 * croyait distincts : 3 238 tours deja comptes passaient pour manquants (~3 000 $ en double).
 * L'horodatage ne sert plus que pour les evenements anciens sans `turnId`.
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
// Tours deja comptes EN DIRECT, par conversation + tour. Les lignes de rattrapage (`backfillSource`)
// en sont exclues : leur protection est la cle par evenement ci-dessus, et un tour ancien a moitie
// rattrape (arret au milieu) doit pouvoir finir de l'etre.
const toursComptes = new Set()
for (const t of avant) {
  if (t.backfillSource) dejaVu.add(t.backfillSource)
  if (t.role === 'supervisor' && t.conversationId && t.ts) dejaVu.add(`${t.conversationId}|${t.ts}`)
  if (t.role === 'supervisor' && !t.backfillSource && t.conversationId && t.turnId)
    toursComptes.add(`${t.conversationId}|${t.turnId}`)
}

// --- Candidats : les `chat-usage` du journal d'activite (deja deltaises a l'ecriture)
const candidats = []
for (const fichier of readdirSync(activityDir)) {
  if (!fichier.endsWith('.jsonl')) continue
  const conversationId = fichier.replace(/\.jsonl$/, '')
  for (const e of lignesDe(join(activityDir, fichier))) {
    if (e.kind !== 'chat-usage') continue
    if (e.turnId && toursComptes.has(`${conversationId}|${e.turnId}`)) continue
    // Un reglement VIDE (aucun token, aucun cout) : `ChatTurnCostRecorder.record` n'ecrit pas de
    // ligne pour lui en direct. Le rejouer ajouterait un faux « tour non tarife » (199 sur 201
    // restants le 2026-10-22 : tours coupes avant tout appel).
    const consommation =
      (Number(e.inputTokens) || 0) +
      (Number(e.outputTokens) || 0) +
      (Number(e.cacheReadTokens) || 0) +
      (Number(e.cacheCreationTokens) || 0) +
      (Number(e.costUsd) || 0)
    if (consommation <= 0) continue
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
console.log(
  `A rejouer   : ${candidats.length} tours de chat (${tarifes} tarifes), ${ajoute.toFixed(2)} USD`
)

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
