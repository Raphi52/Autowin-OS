/**
 * PURGE UNIQUE (one-shot) des satellites disque laissés par des conversations déjà supprimées.
 *
 * Pourquoi une seule fois : la fuite venait de la commande agent `remove_conversation`, qui
 * retirait la conversation sans ses satellites. Ce trou est bouché (bus.onConversationRemoved) ;
 * il ne reste que l'arriéré. Aucun besoin de tâche récurrente.
 *
 * Usage :  node scripts/purge-orphelins-conversations.mjs [--apply] [--base <racine appdata>]
 * Sans --apply : dry-run, n'efface rien.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const baseArg = args.indexOf('--base')
const base =
  baseArg >= 0
    ? args[baseArg + 1]
    : join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'), 'autowin-os')

const conversationsPath = join(base, 'conversations.json')
if (!existsSync(conversationsPath)) {
  console.error(`conversations.json introuvable sous ${base}`)
  process.exit(2)
}

/** Ids VIVANTS = fichier de base, puis journal rejoué (upsert ajoute, delete retire). */
const vivants = new Set()
for (const c of JSON.parse(readFileSync(conversationsPath, 'utf8'))) {
  if (c && typeof c.id === 'string') vivants.add(c.id)
}
const journal = `${conversationsPath}.journal.jsonl`
if (existsSync(journal)) {
  for (const ligne of readFileSync(journal, 'utf8').split(/\r?\n/)) {
    if (!ligne) continue
    let rec
    try {
      rec = JSON.parse(ligne)
    } catch {
      continue // ligne tronquée en fin de journal : ignorée, comme au chargement
    }
    if (rec?.op === 'upsert' && typeof rec.conversation?.id === 'string') vivants.add(rec.conversation.id)
    else if (rec?.op === 'delete' && typeof rec.id === 'string') vivants.delete(rec.id)
  }
}

/** Un satellite orphelin ne se reconnaît QUE par un id de conversation reconstituable depuis son nom. */
const cibles = [
  { dir: 'causal-trace', id: (n) => n.replace(/^\./, '').replace(/\.(jsonl|sequence)$/, '') },
  { dir: 'chat-artifacts', id: (n) => n },
  { dir: 'prompt-observability', id: (n) => n.replace(/\.jsonl$/, '') },
  { dir: 'turn-journals', id: (n) => n }
]

let octets = 0
let entrees = 0
const taille = (p) => {
  const s = statSync(p)
  if (!s.isDirectory()) return s.size
  let total = 0
  for (const e of readdirSync(p)) total += taille(join(p, e))
  return total
}

for (const cible of cibles) {
  const racine = join(base, cible.dir)
  if (!existsSync(racine)) continue
  let n = 0
  let o = 0
  for (const nom of readdirSync(racine)) {
    const id = cible.id(nom)
    if (!/^conv-/.test(id) || vivants.has(id)) continue
    const chemin = join(racine, nom)
    o += taille(chemin)
    n += 1
    if (apply) rmSync(chemin, { recursive: true, force: true })
  }
  console.log(`${cible.dir.padEnd(22)} ${String(n).padStart(6)} orphelin(s)  ${(o / 1e6).toFixed(1)} Mo`)
  entrees += n
  octets += o
}
console.log(
  `${apply ? 'SUPPRIMÉ' : 'DRY-RUN (rien effacé, relancer avec --apply)'} : ${entrees} entrée(s), ${(octets / 1e6).toFixed(1)} Mo — ${vivants.size} conversations vivantes`
)
