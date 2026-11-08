/**
 * REGISTRE DES BUREAUX CACHÉS, CÔTÉ SCRIPTS : « quand t'ouvres des bureaux cachés je veux qu'ils
 * apparaissent tous dans l'onglet Bureaux cachés », et leurs captures n'ont plus à s'afficher dans le fil.
 *
 * Deux écritures, dans le même dossier que hdesk-lancer.ps1 (%LOCALAPPDATA%\autowin-hdesk) :
 * - la FICHE d'un bureau ouvert par un script (instance cachée d'Autowin, ui-capture) : sans elle, le
 *   bureau n'était relié à aucun fil, l'onglet ne s'ouvrait pas et le listait « travail non relié » ;
 * - le JOURNAL DES CAPTURES (`captures.jsonl`) : les fichiers image pris dans un bureau caché. Le fil
 *   le lit pour ne pas recopier ces images quand l'agent les ouvre (captures-de-bureau-cache.ts).
 *
 * Toute panne d'écriture est muette : une capture ou une instance ne doit jamais échouer pour ça.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const JOURNAL_CAPTURES = 'captures.jsonl'
/** Au-delà, le journal est ramené à ses dernières lignes : il ne sert qu'aux captures récentes. */
export const JOURNAL_OCTETS_MAX = 256 * 1024
export const JOURNAL_LIGNES_GARDEES = 200
const IDENTIFIANT = /^[a-zA-Z0-9_-]+$/

/** Même dossier que hdesk-lancer.ps1 et que l'app (`registreParDefaut`, hdesk-gestion.ts). */
export function dossierRegistre(env = process.env) {
  return join(env.LOCALAPPDATA ?? tmpdir(), 'autowin-hdesk')
}

/**
 * Le fil de l'agent qui a lancé le script : celui d'un run (AUTOWIN_CONVERSATION_ID), sinon celui
 * du chat (AUTOWIN_FIL_DU_CHAT, posé par le tour de chat). Rien d'autre qu'un identifiant.
 */
export function filDeLAgent(env = process.env) {
  for (const brut of [env.AUTOWIN_CONVERSATION_ID, env.AUTOWIN_FIL_DU_CHAT]) {
    const fil = String(brut ?? '').trim()
    if (fil && IDENTIFIANT.test(fil)) return fil
  }
  return undefined
}

/** Écrit la fiche que lit l'onglet : libellé, fil, date de lancement. Rend son chemin, ou null. */
export function inscrireFiche({
  id,
  travail,
  conversationId,
  pid,
  executable,
  registre = dossierRegistre(),
  maintenant = () => new Date()
}) {
  if (!IDENTIFIANT.test(String(id ?? ''))) return null
  const fiche = {
    id,
    travail: String(travail ?? '').trim() || 'Instance Autowin cachée',
    ...(conversationId ? { conversationId } : {}),
    lanceLe: maintenant().toISOString(),
    ...(typeof pid === 'number' ? { pid } : {}),
    ...(executable ? { executable } : {})
  }
  try {
    mkdirSync(registre, { recursive: true })
    const chemin = join(registre, `${id}.json`)
    writeFileSync(chemin, JSON.stringify(fiche))
    return chemin
  } catch {
    return null
  }
}

export function retirerFiche(id, registre = dossierRegistre()) {
  if (!IDENTIFIANT.test(String(id ?? ''))) return
  try {
    rmSync(join(registre, `${id}.json`), { force: true })
  } catch {
    // Fiche tenue à l'instant : l'app la purge au prochain passage, bureau fermé.
  }
}

/** Note un fichier image pris dans un bureau caché. Le chemin est rendu absolu. */
export function noterCapture(
  chemin,
  { id, registre = dossierRegistre(), maintenant = () => new Date() } = {}
) {
  if (!chemin) return false
  try {
    mkdirSync(registre, { recursive: true })
    const journal = join(registre, JOURNAL_CAPTURES)
    const ligne = JSON.stringify({
      chemin: resolve(chemin),
      ...(id && IDENTIFIANT.test(id) ? { id } : {}),
      quand: maintenant().toISOString()
    })
    appendFileSync(journal, `${ligne}\n`)
    let taille = 0
    try {
      taille = statSync(journal).size
    } catch {
      taille = 0
    }
    if (taille > JOURNAL_OCTETS_MAX) {
      const lignes = readFileSync(journal, 'utf8').split(/\r?\n/).filter(Boolean)
      writeFileSync(journal, `${lignes.slice(-JOURNAL_LIGNES_GARDEES).join('\n')}\n`)
    }
    return true
  } catch {
    return false
  }
}
