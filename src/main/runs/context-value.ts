import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * LE PRIMITIF DU RLM — « le contexte est une valeur, pas un flux ».
 *
 * Aujourd'hui, un tour d'Autowin OS reconstruit son contexte a chaque iteration (`buildTurnMessages`,
 * `agent-pilot.ts:525`) et sa seule continuite vit chez le CLI provider via `--resume`, dans une
 * `Map` MEMOIRE (`agent-pilot.ts:309`). Consequences : un redemarrage de l'app perd tout, et un
 * fan-out donne a chaque membre le contexte COMPLET (`orchestrator.ts:2871`).
 *
 * MESURE qui justifie ce module (magasin `prompt-observability`, 688 appels REELS, 2026-08-11) :
 *   acteur `subagent`   : 243 431 485 tokens d'entree NON caches / 302 352 327 de cache lu -> 55,4 % caches
 *   acteur `orchestrator`: 30,8 % caches
 *   acteur `judge`      : 10,6 % caches
 * Soit **44,6 % de l'entree des sous-agents re-payee**, environ 450 k tokens non caches par appel sur
 * 541 appels. Ce n'est pas une optimisation theorique.
 * ⚠️ Reserve honnete : ces pourcentages supposent que `usage.inputTokens` compte l'entree NON cachee.
 * Si le provider comptait les lectures de cache DEDANS, ils seraient fausses par double comptage.
 * Non verifie hors-modele.
 *
 * CE QUE CE MODULE FAIT, et rien de plus : il transforme un texte en VALEUR adressable, persistee,
 * decoupable. Il n'appelle aucun provider, ne construit aucun prompt, ne decide d'aucune politique.
 * C'est deliberement une brique pure : elle est donc entierement testable, et le jour ou le pilote de
 * tour l'utilisera, la brique ne sera pas ce qu'il faudra debugger.
 *
 * CONTENT-ADDRESSED, et c'est le point : deux contenus identiques donnent le MEME handle, donc N
 * membres d'un fan-out partagent UNE copie au lieu de N. C'est la propriete qui attaque directement
 * les 44,6 %.
 */

/** Handle : il DECRIT la valeur sans la transporter. C'est ce qu'on passe a un sous-agent. */
export interface ContextValueHandle {
  /** Identifiant opaque et sur (derive du sha) — jamais un chemin. */
  id: string
  sha256: string
  bytes: number
  /** ESTIMATION grossiere (~4 octets/token). Le nom du champ dit qu'on ne pretend pas mesurer. */
  tokensEstimate: number
}

export function contextValueRoot(base = ensureAutowinAppData()): string {
  return join(base, 'context-values')
}

/**
 * Un handle est un IDENTIFIANT, jamais un chemin. On le contraint a une forme stricte AVANT de
 * toucher au disque : accepter `../../secrets` transformerait un magasin de valeurs en lecture de
 * fichier arbitraire. Meme discipline que la validation de chemin du gateway d'outils.
 */
const HANDLE = /^ctx-[0-9a-f]{16}-[0-9a-f]{8}$/

function fichierDe(id: string, base: string): string {
  if (!HANDLE.test(id))
    throw new Error(`handle de contexte invalide: forme attendue ctx-<hex16>-<hex8>`)
  return join(contextValueRoot(base), `${id}.txt`)
}

function estimerTokens(bytes: number): number {
  return Math.max(1, Math.round(bytes / 4))
}

/**
 * Ecrit la valeur et rend son handle. Idempotent par construction : le meme contenu retombe sur le
 * meme fichier, donc reecrire ne duplique rien.
 */
export function putContextValue(text: string, base = ensureAutowinAppData()): ContextValueHandle {
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex')
  const bytes = Buffer.byteLength(text, 'utf8')
  const id = `ctx-${sha256.slice(0, 16)}-${sha256.slice(16, 24)}`
  const racine = contextValueRoot(base)
  mkdirSync(racine, { recursive: true })
  const chemin = join(racine, `${id}.txt`)
  if (!existsSync(chemin)) writeFileSync(chemin, text, 'utf8')
  return { id, sha256, bytes, tokensEstimate: estimerTokens(bytes) }
}

/**
 * Relit une valeur depuis son handle SEUL — donc depuis un processus qui ne partage aucun etat
 * memoire avec celui qui l'a ecrite. C'est la propriete « survit au redemarrage ».
 *
 * L'integrite est REVERIFIEE a chaque lecture : le handle porte le sha, donc un fichier altere sous
 * nos pieds est detecte au lieu d'etre servi. Un magasin de contexte qui sert une valeur falsifiee
 * empoisonnerait un prompt sans que rien ne le signale.
 */
export function loadContextValue(id: string, base = ensureAutowinAppData()): string {
  const chemin = fichierDe(id, base)
  if (!existsSync(chemin)) throw new Error(`valeur de contexte inconnue: ${id}`)
  const texte = readFileSync(chemin, 'utf8')
  const attendu = createHash('sha256').update(texte, 'utf8').digest('hex')
  if (!id.startsWith(`ctx-${attendu.slice(0, 16)}-${attendu.slice(16, 24)}`)) {
    throw new Error(`integrite de la valeur de contexte rompue (sha divergent): ${id}`)
  }
  return texte
}

/**
 * Purge par age. Le magasin est un CACHE : une valeur perdue se recalcule, donc la purge est sans
 * danger — contrairement a un journal, qu'on ne purge pas a la legere.
 */
export function pruneContextValues(base = ensureAutowinAppData(), jours = 30): number {
  const racine = contextValueRoot(base)
  if (!existsSync(racine)) return 0
  const limite = Date.now() - jours * 24 * 3600 * 1000
  let supprimes = 0
  for (const nom of readdirSync(racine)) {
    const chemin = join(racine, nom)
    try {
      if (statSync(chemin).mtimeMs < limite) {
        unlinkSync(chemin)
        supprimes += 1
      }
    } catch {
      /* purge best-effort : un fichier verrouille n'est pas une erreur de purge */
    }
  }
  return supprimes
}
