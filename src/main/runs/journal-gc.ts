import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ramasse-miettes des journaux de sortie brute (`run-stdout/`).
 *
 * Pourquoi : mesure du 2026-07-29 sur un poste en usage reel — 435 fichiers, 10,6 Mo, dont 31 vides,
 * accumules en 2 jours SANS aucune suppression. Un journal est ecrit a CHAQUE spawn de CLI : la
 * croissance est proportionnelle a l'usage et rien ne la borne.
 *
 * Ce qu'un journal sert encore, une fois son run termine : le diagnostic post-mortem (c'est
 * exactement ce qui a permis d'identifier le `spawn claude ENOENT` du jour). Rien ne le REJOUE — seul
 * le tail live le consomme. On garde donc une fenetre recente, et on jette au-dela.
 *
 * LE risque : un CLI spawne DETACHE continue d'ecrire dans son journal alors que l'app est fermee.
 * Supprimer ce fichier casse un run vivant — le tail de reprise ne trouve plus rien et le run parait
 * muet a jamais.
 *
 * CE QUE `mtime` NE DIT PAS (defaut reel corrige le 2026-07-29, signale par un audit adverse) : la
 * premiere version tenait pour acquis qu'« un ecrivain actif est, par construction, un fichier
 * recemment modifie ». C'est FAUX sur deux points. (a) Un journal vient d'etre CREE et rien n'a
 * encore ete ecrit dessus : `mtime` est l'instant de creation, pas la derniere activite — un CLI en
 * phase de demarrage, d'authentification ou d'attente d'outil paraissait donc inactif depuis
 * 11 minutes alors qu'il vivait. (b) Un raisonnement long n'emet aucun token pendant des minutes.
 * Une inactivite de 10 min ne prouve RIEN. On exige desormais `assumeDeadMs` (6 h) pour toute
 * suppression, y compris d'un journal vide et y compris sous le plafond.
 *
 * ET CE QUE L'OS NE PROTEGE PAS : la version precedente se rassurait en supposant qu'un fichier tenu
 * par un enfant vivant resisterait a la suppression sous Windows. C'est faux — libuv ouvre avec
 * FILE_SHARE_DELETE, donc la suppression REUSSIT pendant que l'enfant ecrit encore. Il n'y a aucun
 * filet au niveau de l'OS : la seule protection est la regle ci-dessus.
 *
 * Le PLAN est pur (entrees -> chemins a supprimer) : la politique est testable sans toucher au
 * disque, et `collectStdoutJournals` ne fait que l'appliquer.
 */

export interface JournalEntry {
  path: string
  /** Taille en octets — un journal vide n'a aucune valeur de diagnostic. */
  size: number
  /** Derniere ecriture (ms epoch) : sert a la fois d'age et de detection d'ecrivain actif. */
  modifiedMs: number
}

export interface JournalGcPolicy {
  /** Instant de reference (injecte → test deterministe). */
  nowMs: number
  /** Au-dela de cet age, un journal ne sert plus au diagnostic. */
  maxAgeMs?: number
  /** Plafond dur : on ne garde que les N plus recents, meme s'ils sont jeunes. */
  maxFiles?: number
  /** Un fichier touche depuis moins longtemps que ca est presume EN COURS D'ECRITURE. */
  minIdleMs?: number
  /**
   * En dessous de cette inactivite, on refuse de supprimer, MEME un journal vide, MEME sous le
   * plafond : le run est presume encore vivant. Voir la note de tete sur ce que mtime ne dit pas.
   */
  assumeDeadMs?: number
}

/** 3 jours : large de quoi diagnostiquer la veille et l'avant-veille, sans accumuler. */
export const DEFAULT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
/** 200 journaux ≈ quelques Mo : la fenetre reste consultable a la main. */
export const DEFAULT_MAX_FILES = 200
/**
 * 6 h sans une seule ecriture : seuil au-dela duquel on accepte de presumer le run mort.
 *
 * HEURISTIQUE ASSUMEE, pas une preuve. Le seul signal disponible ici est `mtime`, et il ne distingue
 * pas un run fini d'un run qui reflechit. 10 min etaient largement insuffisantes (un raisonnement
 * long, une attente d'outil ou une phase d'authentification n'ecrivent rien) ; 6 h depassent
 * confortablement tout tour reel sans laisser un journal mort trainer des jours.
 * La vraie correction serait un signal de VIVACITE explicite (PID ou registre des runs en cours) —
 * signalee comme reste-a-faire, non implementee ici.
 */
export const DEFAULT_ASSUME_DEAD_MS = 6 * 60 * 60 * 1000

/**
 * Decide quels journaux supprimer. PUR.
 *
 * Ordre des regles : la garde « ecrivain actif » passe AVANT tout le reste — un journal vivant n'est
 * jamais candidat, meme vide, meme si le plafond est depasse.
 */
export function planJournalGc(entries: JournalEntry[], policy: JournalGcPolicy): string[] {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxFiles = policy.maxFiles ?? DEFAULT_MAX_FILES
  // `minIdleMs` ne decide plus seul d'une suppression : il ne prouvait pas qu'un run etait fini (cf.
  // note de tete). Il reste un PLANCHER — un appelant qui l'aurait regle plus haut que le seuil de
  // mort presumee garde sa prudence — et c'est `assumeDeadMs` qui autorise reellement a supprimer.
  const assumeDeadMs = Math.max(
    policy.assumeDeadMs ?? DEFAULT_ASSUME_DEAD_MS,
    policy.minIdleMs ?? 0
  )
  const idleFor = (entry: JournalEntry): number => policy.nowMs - entry.modifiedMs
  // Seuls les journaux presumes MORTS sont touchables. `minIdleMs` ne suffisait pas : un CLI detache
  // qui reflechit longtemps est inactif sans etre fini.
  const touchable = entries.filter((entry) => idleFor(entry) >= assumeDeadMs)
  const doomed = new Set<string>()

  for (const entry of touchable) {
    if (idleFor(entry) > maxAgeMs) doomed.add(entry.path)
  }

  // Plafond : on compte ce qui SURVIT (actifs inclus — ils occupent bien une place) et on sacrifie
  // les plus anciens des seuls fichiers presumes morts. Un journal vide n'a aucune valeur de
  // diagnostic : a age egal il part AVANT un journal qui porte de la sortie.
  const survivors = entries.filter((entry) => !doomed.has(entry.path))
  if (survivors.length > maxFiles) {
    const removable = survivors
      .filter((entry) => idleFor(entry) >= assumeDeadMs)
      .sort((a, b) => (a.size === 0) === (b.size === 0) ? a.modifiedMs - b.modifiedMs : a.size === 0 ? -1 : 1)
    for (const entry of removable.slice(0, survivors.length - maxFiles)) doomed.add(entry.path)
  }

  return [...doomed]
}

export interface JournalGcOutcome {
  removed: number
  freedBytes: number
}

/**
 * Applique le plan au disque. Best-effort assume : l'echec d'UNE suppression n'interrompt pas la
 * passe — le prochain demarrage reessaiera. Un dossier absent n'est pas une erreur (premier lancement).
 *
 * NE PAS croire qu'un enfant vivant protege son fichier : libuv ouvre en FILE_SHARE_DELETE, la
 * suppression reussit meme fd ouvert. La surete vient UNIQUEMENT de `planJournalGc`.
 */
export function collectStdoutJournals(
  root: string,
  policy: Partial<JournalGcPolicy> = {}
): JournalGcOutcome {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return { removed: 0, freedBytes: 0 }
  }

  const entries: JournalEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.stdout.jsonl')) continue
    const path = join(root, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      entries.push({ path, size: stat.size, modifiedMs: stat.mtimeMs })
    } catch {
      /* disparu entre le listing et le stat : rien a faire */
    }
  }

  const sizeOf = new Map(entries.map((entry) => [entry.path, entry.size]))
  let removed = 0
  let freedBytes = 0
  for (const path of planJournalGc(entries, { nowMs: Date.now(), ...policy })) {
    try {
      rmSync(path, { force: true })
      removed += 1
      freedBytes += sizeOf.get(path) ?? 0
    } catch {
      /* verrouille ou deja parti : le prochain passage s'en chargera */
    }
  }
  return { removed, freedBytes }
}
