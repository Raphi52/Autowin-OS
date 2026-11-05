/**
 * CORRECTIONS DE L'UTILISATEUR — mesurer si elles révèlent des idées fausses de l'agent (lecture seule).
 *
 * Piste n° 17 du scout du 05/11 (conv-1602), lot 8 (conv-1622). Le scout l'avait écartée sur un
 * décompte brut (7 saisies sur 11 850 commencent par « non »). Ce script la remet à l'épreuve :
 * il extrait chaque correction avec la réponse de l'agent qu'elle corrige, pour qu'on puisse
 * LIRE les cas à la main plutôt que se fier à un motif de texte.
 *
 * Il ne modifie rien : `saisies-utilisateur.jsonl` et `conversations.json` (+ archives) sont lus.
 * Limite connue : le journal `conversations.json.journal.jsonl` n'est pas rejoué ; une correction
 * trop récente pour être dans l'instantané sort sans réponse d'agent (`reponseAgent: null`).
 *
 * Usage : node scripts/corrections-utilisateur.mjs [--racine <dossier autowin-os>] [--json] [--cas]
 *   (sans option : le décompte ; --cas ajoute chaque correction et la réponse qu'elle corrige ;
 *    --json sort tout en JSON).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ajouterArchives, texteDuMessage } from './conversations-sur-disque.mjs'

/**
 * Tournures qui CORRIGENT l'agent. Ancrées : « non » seul au début d'une saisie, jamais au milieu
 * (« non invasif hdesk stp » est une consigne, pas une correction — mesuré le 05/11).
 */
export const MOTIFS = [
  {
    nom: 'non-initial',
    re: /^\s*(non|nan|nope)\b(?!\s+(invasif|bloquant|destructif|persistant))/i
  },
  { nom: 'pas-du-tout', re: /^\s*pas du tout\b/i },
  {
    nom: 'c-est-faux',
    re: /\bc['’]est (totalement |complètement |archi )?faux\b|\bce n['’]est pas vrai\b/i
  },
  // \b ne voit pas la fin d'un mot en « é » : on borne par « pas une lettre » (conv-1602).
  { nom: 'tu-inventes', re: /\btu inventes\b|\bt['’]inventes\b|\bt['’]as invent[ée](?!\p{L})/iu },
  { nom: 'pourquoi-en-parler', re: /\bpourquoi (tu|vous) (me |m['’]en |nous )?(en )?parle/i },
  {
    nom: 'pas-compris',
    re: /\bt['’]as pas compris\b|\btu n['’]as pas compris\b|\bc['’]est pas ce que j['’]ai (dit|demandé)\b/i
  }
]

/** Premier motif de correction que `texte` déclenche, ou null. Les très longues saisies sont des consignes collées. */
export function motifDeCorrection(texte) {
  if (typeof texte !== 'string' || texte.length > 600) return null
  // Les consignes d'app (/commandes, plans de lots) commencent par « / » ou citent des données.
  if (/^\s*\//.test(texte)) return null
  for (const { nom, re } of MOTIFS) if (re.test(texte)) return nom
  return null
}

const normaliser = (t) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** Réponse de l'agent juste avant le message utilisateur dont le texte est `texte` (ou le plus proche en temps). */
export function reponseCorrigee(conversation, texte, ts) {
  const messages = conversation?.messages ?? []
  const cible = normaliser(texte)
  let meilleur = -1
  let ecart = Infinity
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (normaliser(texteDuMessage(m)) !== cible) continue
    const e = Math.abs((m.ts ?? 0) - ts)
    if (e < ecart) {
      ecart = e
      meilleur = i
    }
  }
  if (meilleur < 0) return null
  for (let j = meilleur - 1; j >= 0; j--) {
    if (messages[j].role === 'assistant') return texteDuMessage(messages[j])
    if (messages[j].role === 'user') break
  }
  return null
}

/** Lit les saisies et rend chaque correction avec la réponse de l'agent qu'elle corrige. */
export function extraireCorrections(saisies, conversationsParId) {
  const sortie = []
  for (const s of saisies) {
    const motif = motifDeCorrection(s.texte)
    if (!motif) continue
    const reponse = reponseCorrigee(conversationsParId.get(s.conversationId), s.texte, s.ts)
    sortie.push({
      conversationId: s.conversationId,
      ts: s.ts,
      voie: s.voie ?? null,
      motif,
      correction: s.texte,
      reponseAgent: reponse
    })
  }
  return sortie
}

export function lireSaisies(fichier) {
  return readFileSync(fichier, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((ligne) => {
      try {
        return [JSON.parse(ligne)]
      } catch {
        return [] // ligne coupée à l'écriture : ignorée, jamais devinée
      }
    })
}

export function lireConversations(racine) {
  const fichier = join(racine, 'conversations.json')
  const parId = new Map()
  if (existsSync(fichier)) {
    const brut = JSON.parse(readFileSync(fichier, 'utf8'))
    const liste = Array.isArray(brut)
      ? brut
      : Array.isArray(brut?.conversations)
        ? brut.conversations
        : Object.values(brut)
    for (const c of liste) if (c?.id) parId.set(c.id, c)
  }
  return ajouterArchives(parId, fichier)
}

/** Décompte : total de saisies, corrections par motif, corrections dont la réponse d'agent a été retrouvée. */
export function compter(saisies, corrections) {
  const parMotif = {}
  for (const c of corrections) parMotif[c.motif] = (parMotif[c.motif] ?? 0) + 1
  return {
    saisies: saisies.length,
    corrections: corrections.length,
    avecReponseAgent: corrections.filter((c) => c.reponseAgent).length,
    parMotif
  }
}

function principal() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--racine')
  const racine = i >= 0 ? args[i + 1] : join(process.cwd(), '.autowin-data', 'autowin-os')
  const saisies = lireSaisies(join(racine, 'saisies-utilisateur.jsonl'))
  const corrections = extraireCorrections(saisies, lireConversations(racine))
  const decompte = compter(saisies, corrections)
  if (args.includes('--json')) {
    console.log(JSON.stringify({ decompte, corrections }, null, 2))
    return
  }
  console.log(JSON.stringify(decompte))
  if (args.includes('--cas')) {
    for (const c of corrections) {
      console.log(`\n=== ${c.conversationId} [${c.motif}] ${new Date(c.ts).toISOString()}`)
      console.log(`AGENT : ${normaliser(c.reponseAgent ?? '(introuvable)').slice(-500)}`)
      console.log(`USER  : ${normaliser(c.correction).slice(0, 400)}`)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal()
