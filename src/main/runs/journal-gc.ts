import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { JOURNAL_RETENTION_MS } from './turn-journal'

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
  /**
   * LE SIGNAL DE VIVACITE EXPLICITE annonce en tete comme reste-a-faire, et livre le 2026-09-06.
   *
   * Journaux qu'un point de reprise REFERENCE encore. Ces fichiers sont intouchables quel que soit
   * leur age et quel que soit le plafond : ce n'est plus une heuristique de date, c'est une
   * reference. Pourquoi ca compte, mesure : le journal de l'agent `build` de conv-43 a ete supprime
   * a 43 h alors que sa reservation d'appel n'etait pas soldee. Le sidecar `.exit.json`, hors du
   * menage, a survecu — donc le run pouvait prouver que l'appel avait FINI, mais plus jamais lire
   * son resultat. Il est reste bloque, reelu premier a chaque demarrage, et clos rouge six fois.
   */
  protectedPaths?: Iterable<string>
}

/** Forme minimale d'un point de reprise : evite de faire dependre ce module pur du checkpoint. */
export interface JournalReference {
  /** Renseigne = run deja conclu : plus rien a solder, son journal peut partir. */
  terminal?: unknown
  usage?: { activeCalls?: number }
  agents?: { active?: boolean; journalPath?: string }[]
}

/**
 * Journaux a proteger : ceux des agents encore ACTIFS d'un point de reprise NON terminal dont un
 * appel provider reste a solder. Protection par reference, pas par age.
 */
export function journauxReferencesParUneReservation(states: readonly JournalReference[]): string[] {
  const proteges: string[] = []
  for (const state of states) {
    if (state.terminal !== undefined) continue
    if ((state.usage?.activeCalls ?? 0) <= 0) continue
    for (const agent of state.agents ?? []) {
      if (agent.active !== true || !agent.journalPath) continue
      if (!proteges.includes(agent.journalPath)) proteges.push(agent.journalPath)
    }
  }
  return proteges
}

/**
 * Compare deux chemins de fichier de facon stable. Les chemins d'un checkpoint sont ecrits par un
 * AUTRE process : separateurs et casse de lecteur peuvent differer de ceux du listing de dossier.
 * Une comparaison naive laisserait donc passer le fichier a proteger.
 */
function cleDeChemin(path: string): string {
  return resolve(path).toLowerCase()
}

/**
 * Meme fenetre que le journal de tour (7 jours) — et non 3, comme jusqu'au 2026-09-02.
 *
 * Le journal de tour porte le LIEN vers ces sorties brutes et se garde 7 jours : couper les brutes a
 * 3 jours laissait, du 4e au 7e jour, une trace qui renvoie vers un fichier supprime. La duree n'est
 * donc plus decidee ici, elle est IMPORTEE de la source unique.
 */
export const DEFAULT_MAX_AGE_MS = JOURNAL_RETENTION_MS
/** 200 journaux ≈ quelques Mo : la fenetre reste consultable a la main. */
const DEFAULT_MAX_FILES = 200
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
  // REFERENCE AVANT AGE. Un journal qu'un point de reprise attend encore n'est jamais candidat,
  // meme mort depuis des jours, meme au-dela du plafond : le supprimer rend son run insolvable.
  const proteges = new Set<string>()
  for (const path of policy.protectedPaths ?? []) proteges.add(cleDeChemin(path))
  const referenceVivante = (entry: JournalEntry): boolean =>
    proteges.size > 0 && proteges.has(cleDeChemin(entry.path))
  // Seuls les journaux presumes MORTS sont touchables. `minIdleMs` ne suffisait pas : un CLI detache
  // qui reflechit longtemps est inactif sans etre fini.
  const touchable = entries.filter(
    (entry) => idleFor(entry) >= assumeDeadMs && !referenceVivante(entry)
  )
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
      .filter((entry) => idleFor(entry) >= assumeDeadMs && !referenceVivante(entry))
      .sort((a, b) => (a.size === 0) === (b.size === 0) ? a.modifiedMs - b.modifiedMs : a.size === 0 ? -1 : 1)
    for (const entry of removable.slice(0, survivors.length - maxFiles)) doomed.add(entry.path)
  }

  return [...doomed]
}

/** `x.stdout.jsonl.exit.json` → `x.stdout.jsonl` : la preuve de sortie porte le nom de son journal. */
const SUFFIXE_PREUVE = '.exit.json'

/**
 * Decide quelles PREUVES DE SORTIE (`.exit.json`) supprimer. PUR.
 *
 * Mesure du 2026-10-19 (conv-359) : 3 452 preuves dans `run-stdout`, dont 3 341 sans leur journal et
 * 2 915 de plus de 7 jours — rien ne les nettoyait, le menage ne prenait que les journaux. Une preuve
 * ne vaut qu'AVEC son journal : elle dit qu'un appel a fini, le journal dit ce qu'il a rendu (seule,
 * elle a laisse le run de conv-43 « fini mais illisible » — voir `protectedPaths`). Regle :
 * - preuve dont le journal existe encore : intouchable, elle partira apres lui ;
 * - preuve dont le journal est PROTEGE par une reservation : intouchable, meme journal absent ;
 * - preuve orpheline : supprimee une fois plus vieille que la fenetre des journaux (7 jours), la
 *   meme que celle du journal de tour qui pourrait encore y renvoyer.
 */
export function planExitProofGc(
  proofs: readonly JournalEntry[],
  journauxPresents: Iterable<string>,
  policy: JournalGcPolicy
): string[] {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const presents = new Set<string>()
  for (const path of journauxPresents) presents.add(cleDeChemin(path))
  for (const path of policy.protectedPaths ?? []) presents.add(cleDeChemin(path))
  return proofs
    .filter((proof) => {
      if (!proof.path.endsWith(SUFFIXE_PREUVE)) return false
      if (presents.has(cleDeChemin(proof.path.slice(0, -SUFFIXE_PREUVE.length)))) return false
      return policy.nowMs - proof.modifiedMs > maxAgeMs
    })
    .map((proof) => proof.path)
}

export interface JournalGcOutcome {
  /** Fichiers supprimes : journaux, sorties d'erreur et preuves de sortie orphelines. */
  removed: number
  freedBytes: number
}

/**
 * Applique le plan au disque. Best-effort assume : l'echec d'UNE suppression n'interrompt pas la
 * passe — le prochain demarrage reessaiera. Un dossier absent n'est pas une erreur (premier lancement).
 *
 * NE PAS croire qu'un enfant vivant protege son fichier : libuv ouvre en FILE_SHARE_DELETE, la
 * suppression reussit meme fd ouvert. La surete vient UNIQUEMENT de `planJournalGc`.
 *
 * ASYNCHRONE, et lancee APRES l'affichage de la fenetre (index.ts, `interfaceVisible`) : mesure du
 * 2026-10-19 (`gels.jsonl`, conv-359), ce passage faisait 209 `statSync` au demarrage, 8 s de fenetre
 * figee sur le disque D: sature. Les fichiers sont lus UN PAR UN (jamais en rafale) : sur un disque
 * mecanique, des lectures paralleles se gênent au lieu d'aller plus vite. Le plan est calcule sur un
 * inventaire qui peut avoir vieilli de quelques secondes : chaque fichier est donc relu juste avant
 * sa suppression, et epargne s'il a bouge depuis (un run repris a recommence a y ecrire).
 */
export async function collectStdoutJournals(
  root: string,
  policy: Partial<JournalGcPolicy> = {}
): Promise<JournalGcOutcome> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return { removed: 0, freedBytes: 0 }
  }

  const entries: JournalEntry[] = []
  const proofs: JournalEntry[] = []
  for (const name of names) {
    // Les DEUX sorties d'un run detache. Mesure conv-131 : seul `.stdout.jsonl` entrait dans le
    // nettoyage, si bien que les `.stderr.log` s'accumulaient sans limite d'age ni de nombre.
    // Et leurs preuves de sortie, dans le meme cas jusqu'au 2026-10-19 (`planExitProofGc`).
    const preuve = name.endsWith(SUFFIXE_PREUVE)
    if (!preuve && !name.endsWith('.stdout.jsonl') && !name.endsWith('.stderr.log')) continue
    const path = join(root, name)
    try {
      const infos = await stat(path)
      if (!infos.isFile()) continue
      const lu = { path, size: infos.size, modifiedMs: infos.mtimeMs }
      if (preuve) proofs.push(lu)
      else entries.push(lu)
    } catch {
      /* disparu entre le listing et le stat : rien a faire */
    }
  }

  const nowMs = Date.now()
  const inventaire = new Map(entries.map((entry) => [entry.path, entry]))
  const journauxSupprimes = new Set<string>()
  let removed = 0
  let freedBytes = 0
  for (const path of planJournalGc(entries, { nowMs, ...policy })) {
    try {
      const avant = inventaire.get(path)
      const maintenant = await stat(path)
      if (maintenant.mtimeMs !== avant?.modifiedMs || maintenant.size !== avant?.size) continue
      await rm(path, { force: true })
      journauxSupprimes.add(path)
      removed += 1
      freedBytes += avant?.size ?? 0
    } catch {
      /* verrouille ou deja parti : le prochain passage s'en chargera */
    }
  }

  // APRES les journaux : une preuve dont le journal vient de partir est orpheline des CE passage.
  // Une preuve n'est ecrite qu'une fois, a la fin de son appel : pas de relecture avant suppression.
  const journauxPresents = entries
    .map((entry) => entry.path)
    .filter((path) => !journauxSupprimes.has(path))
  const tailles = new Map(proofs.map((proof) => [proof.path, proof.size]))
  for (const path of planExitProofGc(proofs, journauxPresents, { nowMs, ...policy })) {
    try {
      await rm(path, { force: true })
      removed += 1
      freedBytes += tailles.get(path) ?? 0
    } catch {
      /* verrouille ou deja parti : le prochain passage s'en chargera */
    }
  }
  return { removed, freedBytes }
}
