import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { deposerFichier, relireFichier } from '../ecriture-hors-fil'

/**
 * LE MEME INDEX JSON SUR DISQUE, ecrit une seule fois.
 *
 * `chat-session-store.ts` et `murs-store.ts` portaient, ligne pour ligne, la meme mecanique :
 * meme racine, meme lecture fail-open, meme ecriture atomique, meme oubli qui supprime le fichier
 * quand l'index se vide. Seules changeaient la valeur stockee et son garde de forme. Signale par
 * l'audit du 2026-08-21 ; ce module est la piece commune, les deux stores n'en gardent que leur
 * specialite (le type, son validateur, et pour les murs le plafond par conversation).
 *
 * FAIL-OPEN ASSUME, et c'est un choix, pas une negligence : ces index sont des CACHES. Perdre une
 * entree coute un renvoi d'historique ou une reprise de plus — cher, jamais faux. Une exception, en
 * revanche, casserait le tour de l'utilisateur pour un cache. Sur une autorite on ferme ; sur un
 * cache on ouvre. Le rejet porte sur l'index ENTIER des qu'une seule entree est malformee : un index
 * a moitie valide inviterait a s'appuyer sur une donnee douteuse, alors que le repli est toujours
 * correct.
 */
export interface IndexStore<V> {
  /** Chemin du fichier d'index sous la racine donnee. */
  chemin(base?: string): string
  /** Relit l'index. Toute anomalie rend `{}` — fichier absent, JSON invalide, une entree douteuse. */
  lire(base?: string): Record<string, V>
  /**
   * Ecriture ATOMIQUE (temporaire puis `rename`) : une interruption ne laisse jamais un index tronque.
   * Elle part hors du fil principal (conv-1368) : `renameSync` ici a fige la fenetre 23,7 s en 7 jours.
   */
  ecrire(index: Record<string, V>, base?: string): void
  /** Oublie une cle. Sans effet si elle est inconnue — oublier deux fois n'est pas une erreur. */
  oublier(cle: string, base?: string): void
}

export function creerIndexStore<V>(
  nomFichier: string,
  estValeur: (valeur: unknown) => valeur is V
): IndexStore<V> {
  const chemin = (base = ensureAutowinAppData()): string => join(base, nomFichier)

  const lire = (base = ensureAutowinAppData()): Record<string, V> => {
    let brut: unknown
    try {
      const texte = relireFichier(chemin(base))
      if (texte === undefined) return {}
      brut = JSON.parse(texte)
    } catch {
      return {}
    }
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {}
    const entrees = Object.entries(brut as Record<string, unknown>)
    if (entrees.some(([, valeur]) => !estValeur(valeur))) return {}
    return Object.fromEntries(entrees) as Record<string, V>
  }

  const ecrire = (index: Record<string, V>, base = ensureAutowinAppData()): void => {
    deposerFichier(chemin(base), `${JSON.stringify(index, null, 1)}\n`)
  }

  const oublier = (cle: string, base = ensureAutowinAppData()): void => {
    const index = lire(base)
    if (!(cle in index)) return
    delete index[cle]
    if (Object.keys(index).length === 0) {
      deposerFichier(chemin(base), null)
      return
    }
    ecrire(index, base)
  }

  return { chemin, lire, ecrire, oublier }
}
