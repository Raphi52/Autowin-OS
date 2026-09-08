/**
 * AVANCEMENT D'UN BANC D'ARENE PENDANT QU'IL TOURNE.
 *
 * Constat utilisateur du 2026-09-08 (conv-355) : « ca fait 10 mins que le bloc reflexion est vide
 * je sais meme pas ce qu'il fout ». Cause reelle : un banc d'arene lance ses N bras dans UNE SEULE
 * commande (`lance.sh` : une sous-shell par bras, puis `wait`). Le battement d'outil du CLI ne peut
 * donc dire qu'une chose — « Bash en cours - 2 min » — pendant toute la duree du banc, alors que
 * l'avancement EXISTE deja sur disque : `statut.txt` recoit une ligne `<bras> exit=<code> wall=<n>s`
 * des qu'un bras finit, et `prompt-<bras>.txt` dit combien de bras etaient attendus.
 *
 * Ce module ne fait que RELIRE ces fichiers. Il n'ecrit rien, ne lance rien, et rend `null` des que
 * la commande observee n'est pas un banc : un battement ordinaire doit rester inchange.
 */
import { readFileSync, readdirSync } from 'node:fs'

/** Retrouve le dossier du banc cite par une commande de fond, ou `null` si ce n'en est pas une. */
export function dossierBancDepuisCommande(commande: string): string | null {
  // Chemin jusqu'au segment `arena-bench-<nom>` inclus, quel que soit le separateur.
  const sep = String.fromCharCode(92)
  const motif = new RegExp("([A-Za-z]:)?[" + sep + "/][^\"' ]*arena-bench-[A-Za-z0-9._-]+")
  const m = motif.exec(commande)
  return m ? m[0].split(sep).join('/') : null
}

type LigneStatut = { bras: string; exit: number; wall: number }

function lireStatut(dossier: string): LigneStatut[] {
  let brut = ''
  try {
    brut = readFileSync(`${dossier}/statut.txt`, 'utf8')
  } catch {
    return []
  }
  const lignes: LigneStatut[] = []
  for (const l of brut.split('\n')) {
    const m = new RegExp('^([^ ]+) +exit=(-?[0-9]+) +wall=([0-9]+)s$').exec(l.trim())
    if (m) lignes.push({ bras: m[1], exit: Number(m[2]), wall: Number(m[3]) })
  }
  return lignes
}

function brasAttendus(dossier: string): string[] {
  try {
    return readdirSync(dossier)
      .map((f) => /^prompt-([A-Za-z0-9._-]+)\.txt$/.exec(f)?.[1])
      .filter((b): b is string => Boolean(b))
      .sort()
  } catch {
    return []
  }
}

/**
 * Rend une ligne lisible du type `4 bras : c fini 92 s · a, b, x en cours`, ou `null` si le dossier
 * n'a pas la forme d'un banc (aucun `prompt-*.txt`) — auquel cas il n'y a rien d'honnete a afficher.
 */
export function avancementBanc(dossier: string): string | null {
  const attendus = brasAttendus(dossier)
  if (attendus.length === 0) return null
  const finis = lireStatut(dossier)
  const parBras = new Map(finis.map((f) => [f.bras, f]))
  const termines = attendus
    .filter((b) => parBras.has(b))
    .map((b) => {
      const f = parBras.get(b)!
      return `${b} ${f.exit === 0 ? 'fini' : `ECHEC (${f.exit})`} ${f.wall} s`
    })
  const encours = attendus.filter((b) => !parBras.has(b))
  const morceaux: string[] = []
  if (termines.length > 0) morceaux.push(termines.join(', '))
  if (encours.length > 0) morceaux.push(`${encours.join(', ')} en cours`)
  return `${attendus.length} bras : ${morceaux.join(' · ')}`
}

/** Point d'entree du battement : enrichit le statut d'un `Bash` qui pilote un banc d'arene. */
export function avancementDepuisCommande(commande: string): string | null {
  const dossier = dossierBancDepuisCommande(commande)
  return dossier ? avancementBanc(dossier) : null
}
