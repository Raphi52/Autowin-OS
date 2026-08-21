import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * REGISTRE PERSISTANT DES MURS — pour qu'un echec du tour 1 soit encore connu au tour 5.
 *
 * L'auto-kaizen en cours de tour (`chat-turn-messages.ts`, `signatureDEchec`) sait deja reconnaitre
 * qu'un mur se rejoue et escalader la consigne. Mais son registre vivait dans le TOUR : deux tours
 * de suite, l'agent pouvait remanger exactement le meme mur en croyant chaque fois le decouvrir —
 * la premiere consigne, celle qui dit simplement « corrige et poursuis », se rejouait a l'infini.
 * C'est le meme angle mort que l'index de sessions avant `chat-session-store` : une donnee qu'on
 * possedait deja, jetee a chaque frontiere.
 *
 * FAIL-OPEN ASSUME, meme raisonnement que le store de sessions : ceci est un CACHE D'INDICE, pas une
 * autorite. Oublier un mur coute UNE reprise de plus — cher, jamais faux. Un fichier corrompu vaut
 * donc « aucun mur connu », et surtout PAS une exception qui casserait le tour de l'utilisateur.
 * Inversement, l'escalade ne detruit rien : au pire elle demande de changer d'approche a tort.
 */

export type MursIndex = Record<string, string[]>

/**
 * Le registre est BORNE par conversation. Sans cap, une conversation longue et bruyante ferait
 * grossir le fichier sans fin pour un gain nul : au-dela de quelques dizaines de murs distincts, ce
 * n'est plus un indice, c'est un journal. Les plus RECENTS survivent — un mur rencontre a l'instant
 * pese plus qu'un mur d'il y a deux heures.
 */
export const CAP_MURS_PAR_CONVERSATION = 40

export function mursStorePath(base = ensureAutowinAppData()): string {
  return join(base, 'murs-rencontres.json')
}

function estListeDeMurs(valeur: unknown): valeur is string[] {
  return Array.isArray(valeur) && valeur.every((m) => typeof m === 'string' && !!m)
}

function lireIndex(base: string): MursIndex {
  const chemin = mursStorePath(base)
  if (!existsSync(chemin)) return {}
  let brut: unknown
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    return {}
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const entrees = Object.entries(brut as Record<string, unknown>)
  if (entrees.some(([, valeur]) => !estListeDeMurs(valeur))) return {}
  return Object.fromEntries(entrees) as MursIndex
}

/** Ecriture ATOMIQUE : une interruption ne doit pas laisser un index tronque, relu comme corrompu. */
function ecrire(index: MursIndex, base: string): void {
  const chemin = mursStorePath(base)
  mkdirSync(base, { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, `${JSON.stringify(index, null, 1)}\n`, 'utf8')
  renameSync(temporaire, chemin)
}

/** Les murs deja rencontres dans CETTE conversation. Une conversation inconnue n'en a aucun. */
export function chargerMurs(conversationId: string, base = ensureAutowinAppData()): string[] {
  if (!conversationId) return []
  return lireIndex(base)[conversationId] ?? []
}

/** Enregistre un mur. Idempotent : le meme mur deux fois reste une seule entree. */
export function enregistrerMur(
  conversationId: string,
  signature: string,
  base = ensureAutowinAppData()
): void {
  if (!conversationId || !signature) return
  const index = lireIndex(base)
  const connus = index[conversationId] ?? []
  if (connus.includes(signature)) return
  index[conversationId] = [...connus, signature].slice(-CAP_MURS_PAR_CONVERSATION)
  ecrire(index, base)
}

/** Oublie les murs d'une conversation. Sans effet si elle est inconnue. */
export function oublierMurs(conversationId: string, base = ensureAutowinAppData()): void {
  const index = lireIndex(base)
  if (!(conversationId in index)) return
  delete index[conversationId]
  if (Object.keys(index).length === 0) {
    const chemin = mursStorePath(base)
    try {
      if (existsSync(chemin)) unlinkSync(chemin)
    } catch {
      /* best-effort : un index vide laisse sur disque est inoffensif */
    }
    return
  }
  ecrire(index, base)
}
