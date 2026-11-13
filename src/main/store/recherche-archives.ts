import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

/**
 * LE TEXTE DES FILS ARCHIVÉS, hors de la mémoire.
 *
 * Un fil archivé garde en mémoire son résumé et le squelette de ses messages (identité, rôle, date) ;
 * le `content` de chaque message se relit ici, message par message, au moment où un lecteur le demande
 * (recherche, carte des besoins, kaizen). Il pesait 56 Mo de tas sur le corpus réel (1 109 archives,
 * 11 362 messages, 25 M caractères).
 *
 * Donnée DÉRIVÉE : la source de vérité reste `conversations.json.archive/`. La base est recréée si elle
 * manque ou est illisible, et un fil dont l'empreinte du texte a changé y est réécrit (« en retard »).
 */
export interface TexteDesArchives {
  /**
   * Range le texte d'un fil archivé, message par message (`undefined` : message sans texte). Ne réécrit
   * rien si la base a déjà ce texte à l'identique. Rend `false` si la base n'a pas pu l'écrire : l'appelant
   * garde alors le texte en mémoire.
   */
  ranger(id: string, contenus: readonly (string | undefined)[]): boolean
  /** Le texte du message `rang` du fil `id`, ou `undefined` s'il n'en a pas. */
  lire(id: string, rang: number): string | undefined
  /** Le fil n'est plus archivé (ravivé ou supprimé) : son texte quitte la base. */
  retirer(id: string): void
  /** Retire les fils que la base garde mais que l'archive n'a plus (démarrage). */
  elaguer(gardes: ReadonlySet<string>): void
  fermer(): void
}

/** Sans disque (tests, store de normalisation) : le texte reste en mémoire, comme avant la base. */
export function texteEnMemoire(): TexteDesArchives {
  const textes = new Map<string, readonly (string | undefined)[]>()
  return {
    ranger: (id, contenus) => {
      textes.set(id, [...contenus])
      return true
    },
    lire: (id, rang) => textes.get(id)?.[rang],
    retirer: (id) => void textes.delete(id),
    elaguer: (gardes) => {
      for (const id of textes.keys()) if (!gardes.has(id)) textes.delete(id)
    },
    fermer: () => textes.clear()
  }
}

/** Version du schéma : la changer fait recréer la base au démarrage suivant. */
const VERSION_SCHEMA = 1

/** Empreinte exacte du texte d'un fil : la base est « en retard » dès qu'elle diffère. */
function empreinteDuTexte(contenus: readonly (string | undefined)[]): string {
  const hache = createHash('sha1')
  for (const contenu of contenus) {
    // Séparateur hors texte, et un marqueur distinct pour « pas de texte » (≠ chaîne vide).
    hache.update(contenu === undefined ? '\u0000-' : `\u0000+${contenu}`)
  }
  return `${contenus.length}:${hache.digest('hex')}`
}

function ouvrir(chemin: string, verifierSchema: boolean): DatabaseSync {
  const base = new DatabaseSync(chemin)
  try {
    // Donnée dérivée : aucune synchronisation forcée du disque, une base perdue se reconstruit.
    // Réglage propre à chaque connexion, donc reposé à chaque ouverture.
    // Journal en MÉMOIRE : la base est rouverte à chaque tranche de travail, et l'ouverture à côté d'un
    // fichier de journal (créé, effacé ou gardé) montait jusqu'à 18 ms sous Windows, contre moins de 3 ms
    // sans (mesuré). Une coupure en pleine écriture peut alors abîmer la base : elle est recréée (`abimee`).
    base.exec('PRAGMA synchronous = OFF; PRAGMA journal_mode = MEMORY')
    if (!verifierSchema) return base
    const version = (base.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version !== VERSION_SCHEMA) {
      base.exec('DROP TABLE IF EXISTS texte; DROP TABLE IF EXISTS fils;')
    }
    base.exec(`
      CREATE TABLE IF NOT EXISTS fils (id TEXT PRIMARY KEY, empreinte TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS texte (
        fil TEXT NOT NULL, rang INTEGER NOT NULL, contenu TEXT, PRIMARY KEY (fil, rang)
      );
      PRAGMA user_version = ${VERSION_SCHEMA};
    `)
    return base
  } catch (erreur) {
    base.close()
    throw erreur
  }
}

/** Codes primaires de SQLite pour une base abîmée (https://www.sqlite.org/rescode.html). */
const SQLITE_CORRUPT = 11
const SQLITE_NOTADB = 26

/** Efface la base et ses fichiers annexes : elle n'est qu'une copie dérivée. */
function effacer(chemin: string): void {
  for (const fichier of [chemin, `${chemin}-journal`, `${chemin}-wal`, `${chemin}-shm`]) {
    rmSync(fichier, { force: true })
  }
}

/**
 * La base sur le disque. `verifierSchema` (première ouverture de la session) : illisible, abîmée ou d'un
 * autre schéma, elle est effacée puis recréée. Rend `undefined` si même la recréation échoue.
 */
export function ouvrirTexteDesArchives(
  chemin: string,
  verifierSchema = true,
  /** SQLite dit la base abîmée (SQLITE_CORRUPT, SQLITE_NOTADB) en cours de vie. */
  abimee?: () => void
): TexteDesArchives | undefined {
  let base: DatabaseSync
  try {
    base = ouvrir(chemin, verifierSchema)
  } catch (erreur) {
    console.warn('[archives] base du texte illisible, recréée :', erreur)
    try {
      effacer(chemin)
      base = ouvrir(chemin, true)
    } catch (encore) {
      console.warn('[archives] base du texte impossible :', encore)
      return undefined
    }
  }
  // Chaque requête n'est préparée qu'à son premier usage : la base est rouverte souvent.
  const requete = (sql: string): (() => StatementSync) => {
    let preparee: StatementSync | undefined
    return () => (preparee ??= base.prepare(sql))
  }
  const lireEmpreinte = requete('SELECT empreinte FROM fils WHERE id = ?')
  const ecrireEmpreinte = requete('INSERT OR REPLACE INTO fils (id, empreinte) VALUES (?, ?)')
  const viderTexte = requete('DELETE FROM texte WHERE fil = ?')
  const viderFil = requete('DELETE FROM fils WHERE id = ?')
  const ecrireTexte = requete('INSERT INTO texte (fil, rang, contenu) VALUES (?, ?, ?)')
  const lireTexte = requete('SELECT rang, contenu FROM texte WHERE fil = ?')
  const tousLesFils = requete('SELECT id FROM fils')
  /** Une erreur en cours de vie : signalée une fois, sans casser le lecteur. */
  let signalee = false
  const signaler = (quoi: string, erreur: unknown): void => {
    const code = (erreur as { errcode?: unknown } | undefined)?.errcode
    if (typeof code === 'number' && [SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff))
      abimee?.()
    if (signalee) return
    signalee = true
    console.warn(`[archives] base du texte : ${quoi} impossible`, erreur)
  }
  /**
   * Le texte du DERNIER fil lu, en entier : les lecteurs balaient un fil message après message, et une
   * requête par fil coûte quatre fois moins qu'une par message (63 ms contre 270 pour tout le corpus,
   * mesuré). Il ne vit que le temps de cette connexion, refermée dès que le travail en cours rend la main.
   */
  let filLu: { id: string; contenus: (string | undefined)[] } | undefined
  const retirer = (id: string): void => {
    if (filLu?.id === id) filLu = undefined
    viderTexte().run(id)
    viderFil().run(id)
  }
  return {
    ranger: (id, contenus) => {
      const empreinte = empreinteDuTexte(contenus)
      try {
        const connue = lireEmpreinte().get(id) as { empreinte: string } | undefined
        if (connue?.empreinte === empreinte) return true
        if (filLu?.id === id) filLu = undefined
        base.exec('BEGIN')
        try {
          viderTexte().run(id)
          contenus.forEach((contenu, rang) => ecrireTexte().run(id, rang, contenu ?? null))
          ecrireEmpreinte().run(id, empreinte)
          base.exec('COMMIT')
        } catch (erreur) {
          base.exec('ROLLBACK')
          throw erreur
        }
        return true
      } catch (erreur) {
        signaler('écriture', erreur)
        return false
      }
    },
    lire: (id, rang) => {
      try {
        if (filLu?.id !== id) {
          const contenus: (string | undefined)[] = []
          for (const ligne of lireTexte().all(id) as { rang: number; contenu: string | null }[]) {
            contenus[ligne.rang] = ligne.contenu ?? undefined
          }
          filLu = { id, contenus }
        }
        return filLu.contenus[rang]
      } catch (erreur) {
        signaler('lecture', erreur)
        return undefined
      }
    },
    retirer: (id) => {
      try {
        retirer(id)
      } catch (erreur) {
        signaler('retrait', erreur)
      }
    },
    elaguer: (gardes) => {
      try {
        for (const { id } of tousLesFils().all() as { id: string }[]) {
          if (!gardes.has(id)) retirer(id)
        }
      } catch (erreur) {
        signaler('élagage', erreur)
      }
    },
    fermer: () => {
      filLu = undefined
      try {
        base.close()
      } catch {
        /* déjà fermée */
      }
    }
  }
}

/** Le fichier de la base, à côté du snapshot : `conversations.json.archive-texte.sqlite`. */
export function cheminTexteDesArchives(cheminSnapshot: string): string {
  return `${cheminSnapshot}.archive-texte.sqlite`
}

/**
 * La base, ouverte à l'usage et REFERMÉE dès que le travail synchrone en cours rend la main : sous Windows,
 * un fichier SQLite ouvert empêche d'effacer ou de déplacer le dossier de données. Une recherche menée par
 * tranches la rouvre donc une fois par tranche (1,2 ms en moyenne, moins de 3 ms au pire avec le journal en mémoire, mesuré).
 */
export function texteDesArchivesSurDisque(cheminSnapshot: string): TexteDesArchives {
  let base: TexteDesArchives | undefined
  let schemaVerifie = false
  /** Abîmée en cours de vie : effacée à la fermeture, recréée à l'ouverture suivante. */
  let aEffacer = false
  /** Base impossible à ouvrir : le texte reste en mémoire pour toute la session, la recherche ne perd rien. */
  let secours: TexteDesArchives | undefined
  const ouverte = (): TexteDesArchives => {
    if (secours) return secours
    if (base) return base
    const chemin = cheminTexteDesArchives(cheminSnapshot)
    const ouverteIci = ouvrirTexteDesArchives(chemin, !schemaVerifie, () => {
      aEffacer = true
    })
    if (!ouverteIci) return (secours = texteEnMemoire())
    schemaVerifie = true
    base = ouverteIci
    setImmediate(() => {
      ouverteIci.fermer()
      if (base === ouverteIci) base = undefined
      if (!aEffacer) return
      // Le texte des fils déjà rangés est perdu pour cette session (leur recherche ne les trouve plus) ;
      // au démarrage suivant, la base vide est reconstruite depuis l'archive.
      aEffacer = false
      schemaVerifie = false
      try {
        effacer(chemin)
      } catch (erreur) {
        console.warn('[archives] base du texte abîmée impossible à effacer :', erreur)
      }
    })
    return ouverteIci
  }
  return {
    ranger: (id, contenus) => ouverte().ranger(id, contenus),
    lire: (id, rang) => ouverte().lire(id, rang),
    retirer: (id) => ouverte().retirer(id),
    elaguer: (gardes) => ouverte().elaguer(gardes),
    fermer: () => {
      base?.fermer()
      base = undefined
    }
  }
}
