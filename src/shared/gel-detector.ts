/**
 * Noyau PUR du detecteur de GEL du process main.
 *
 * « Ce programme ne repond pas » n'est PAS une lenteur : c'est la boucle d'evenements du process
 * main bloquee assez longtemps pour que Windows cesse de voir la fenetre pomper ses messages. Les
 * jalons de tour (`turn-timing.jsonl`) ne peuvent pas l'attraper — ils n'enregistrent que des tours
 * qui SE TERMINENT, et un main bloque ne termine rien.
 *
 * Le principe est celui d'un battement regulier : un minuteur arme a periode FIXE. S'il se reveille
 * en retard, ce retard EST la duree pendant laquelle la boucle a ete tenue. Aucune supposition, une
 * soustraction. L'operation declaree au moment du gel est jointe pour NOMMER le coupable au lieu de
 * le deduire.
 */

/** Retard au-dela duquel un battement manque devient un GEL journalise (et non du bruit d'ordonnancement). */
export const SEUIL_GEL_MS = 1000

/** Periode du battement. Assez courte pour dater un gel, assez longue pour ne rien couter. */
export const PERIODE_BATTEMENT_MS = 500

/**
 * Part du retard qui doit avoir ete brulee par NOTRE process pour que le gel lui soit imputable.
 * En dessous, le temps a passe ailleurs : la boucle n'etait pas tenue, elle n'etait pas ordonnancee.
 */
const PART_CPU_IMPUTABLE = 0.5

/**
 * Origine d'un gel.
 *  · `boucle-tenue` — notre process a brule le temps : c'est NOTRE code qui figeait la fenetre.
 *  · `process-prive-de-cpu` — le retard s'est ecoule sans que nous consommions de CPU (machine
 *    saturee, mise en veille, process desordonnance). Reel pour l'utilisateur, mais NON imputable a
 *    une operation : l'operation declaree a cet instant n'est qu'une coincidence.
 *
 * Limite assumee : un blocage synchrone d'ENTREE-SORTIE ne brule pas de CPU non plus. Il n'est pas
 * perdu pour autant — `instrumenterCanauxIpc` le chronometre DIRECTEMENT et le journalise sous le
 * suffixe `(sync)`, sans dependre de cette heuristique.
 */
export type CauseGel = 'boucle-tenue' | 'process-prive-de-cpu' | 'entree-sortie-bloquante'

/**
 * Part du blocage que le TEMOIN doit avoir subie pour que la contention machine soit credible.
 * En dessous, le temoin s'est reveille A L'HEURE : la machine nous ordonnancait bien, donc le thread
 * principal etait coince dans un appel bloquant — c'est NOTRE code, pas la machine.
 */
const PART_TEMOIN_EN_RETARD = 0.5

export interface Gel {
  /** Horodatage ISO du reveil tardif. */
  ts: string
  /** Duree REELLE pendant laquelle la boucle d'evenements est restee tenue. */
  blocageMs: number
  /** Ce que le main disait faire au moment du gel — `inconnu` si rien n'etait declare. */
  operation: string
  /** Absent sur les gels journalises avant l'introduction de la preuve par le CPU. */
  cause?: CauseGel
  /**
   * TEMOIN DE VIE — ce n'est PAS un gel, c'est la preuve que l'instrument tourne.
   *
   * Defaut vecu le 2026-09-05 (conv-303) : apres un redemarrage, `gels.jsonl` n'a plus rien ecrit
   * pendant que l'application etait sollicitee. Deux lectures possibles, et AUCUN moyen de les
   * distinguer : « plus aucun blocage » (le correctif marche) ou « plus rien ne s'ecrit » (la
   * mesure est morte). Un journal muet est donc indecidable, et une preuve indecidable ne vaut
   * rien. Le detecteur pose desormais UNE ligne a chaque demarrage : si elle manque, l'instrument
   * est en panne ; si elle est seule, l'application n'a vraiment pas gele.
   */
  temoin?: 'demarrage'
  /**
   * PISTE, pas verdict — renseigne uniquement quand `operation` vaut `inconnu`. C'est la derniere
   * operation qui s'est REFERMEE pendant la fenetre figee : elle a donc reellement tourne pendant
   * le gel. Une operation refermee AVANT la fenetre n'est jamais reportee ici (l'erreur d'alibi
   * deja payee sur `timer:balayage:copiesAbandonnees`).
   */
  indice?: string
  /**
   * MORT PAR MILLE COUPURES — les contributeurs CUMULES pendant la fenetre figee.
   *
   * Mesure du 2026-09-02 : sept gels de 9,1 a 12,6 s, tous `operation:'inconnu'` avec la cause
   * `entree-sortie-bloquante`, alors que node:fs et node:child_process sont instrumentes. Raison :
   * l'instrumentation ne journalise qu'un appel dont la duree SEULE depasse le seuil. Cent lectures
   * de 100 ms tiennent la boucle 10 s sans qu'aucune ne soit nommee. On cumule donc par appel, et
   * on ne NOMME que si le cumul explique une part reelle du gel — sinon c'est une accusation en
   * l'air, la meme faute d'alibi que sur `indice`.
   */
  accumulation?: AccesCumule[]
  /**
   * TOUR de chat en cours au moment du gel — absent hors tour et sur toutes les lignes deja ecrites.
   *
   * Mesure du 2026-09-02 : aucune ligne de `gels.jsonl` ne portait d'identite. On lisait « la fenetre
   * a ete figee 33 s » sans pouvoir dire pendant QUOI, alors que l'app savait quel tour tournait.
   * Rapprocher a l'horodatage devient faux des que deux conversations travaillent en meme temps.
   */
  conversationId?: string
  turnId?: string
  /**
   * QUI a lance l'appel bloquant — les premieres frames applicatives de la pile, hors node interne.
   *
   * Mesure du 2026-09-03 (`gels.jsonl`) : les gels les plus longs disent `execFileSync git rev-parse
   * x60` sans dire d'ou ils partent, et l'`indice` ne nomme qu'un IPC ouvert, pas l'appelant. Sans
   * cette ligne, chaque diagnostic recommence par une fouille du depot. Elle n'est capturee que
   * quand un appel depasse deja le seuil : cout nul sur le chemin normal.
   */
  appelant?: string
}

/** Temps synchrone total passe dans UN appel, sur la fenetre d'un battement. */
export interface AccesCumule {
  operation: string
  cumulMs: number
  appels: number
  /**
   * QUI a lance ces appels — l'appelant qui pese le PLUS dans ce cumul.
   *
   * Mesure du 2026-09-03 : les gels reels ne sont presque jamais UN appel long, mais un cumul
   * (`execFileSync git for-each-ref` x27 = 2 252 ms). Le champ `appelant` du gel, pose seulement sur
   * l'appel unique hors seuil, ne les couvrait donc pas : ils restaient anonymes, et le diagnostic
   * repartait en fouille du depot. Un seul appelant est garde par operation — le plus couteux.
   */
  appelant?: string
}

export interface ResumeGels {
  gels: number
  /** Le pire blocage observe, en ms. */
  pireMs: number
  /** Somme des blocages : le temps total ou l'application etait figee. */
  cumulMs: number
  /** Operations classees par temps de gel CUMULE, du pire au moins pire. */
  parOperation: Array<{ operation: string; gels: number; cumulMs: number; pireMs: number }>
  /** Lignes du journal qu'on n'a pas su relire — comptees, jamais jetees en silence. */
  lignesIllisibles: number
  /**
   * Demarrages de l'instrument observes dans la fenetre lue.
   *
   * A ZERO alors que la fenetre couvre un lancement, la mesure est MORTE : un journal sans gel ne
   * prouve alors rien. Compte a part, jamais melange aux lignes illisibles — un temoin de vie est
   * une ligne parfaitement lisible qui ne porte simplement aucun blocage.
   */
  demarrages: number
  /** Gels REELS mais non imputables a notre boucle — exclus de l'attribution, jamais caches. */
  gelsNonImputables: number
  /** Temps fige total non imputable a notre code. */
  msNonImputables: number
}

/**
 * Classe un reveil tardif : y a-t-il gel, et est-il IMPUTABLE a notre boucle ?
 *
 * Mesure du 2026-08-28 (20:37 -> 21:42) : un « gel » de 16 a 22 s toutes les minutes, reparti au
 * hasard sur `inactif`, `demarrage:interface chargee`, `os:models:quotas`, `os:pilotChat`. Une
 * boucle tenue par notre propre code ne change pas de coupable a chaque minute. Le CPU consomme
 * pendant le retard tranche : brule chez nous => c'est nous ; pas brule => c'est la machine.
 */
/** Part du gel qu'un cumul doit expliquer pour etre NOMME comme contributeur. */
const PART_CUMUL_IMPUTABLE = 0.25

/** Nombre de contributeurs reportes : au-dela, ce n'est plus une piste mais un listing. */
const CONTRIBUTEURS_REPORTES = 3

/**
 * Classe les appels bloquants d'une fenetre figee et rend ceux qui l'EXPLIQUENT.
 *
 * Rend `undefined` — jamais une liste vide, jamais une liste faible — quand le cumul n'atteint pas
 * `PART_CUMUL_IMPUTABLE` du blocage : un gel de 12 s que 200 ms d'entrees-sorties n'expliquent pas
 * doit rester ANONYME plutot que de designer un innocent.
 */
export function nommerAccumulation(
  entrees: readonly AccesCumule[],
  blocageMs: number,
  partMinimale = PART_CUMUL_IMPUTABLE
): AccesCumule[] | undefined {
  if (blocageMs <= 0) return undefined
  const retenues = entrees.filter((e) => e.cumulMs > 0 && e.appels > 0)
  if (retenues.length === 0) return undefined
  const cumulTotal = retenues.reduce((somme, e) => somme + e.cumulMs, 0)
  if (cumulTotal < blocageMs * partMinimale) return undefined
  return [...retenues]
    .sort((a, b) => b.cumulMs - a.cumulMs || a.operation.localeCompare(b.operation))
    .slice(0, CONTRIBUTEURS_REPORTES)
}

export function classerGel(
  ecouleMs: number,
  cpuMsConsomme: number,
  periodeMs = PERIODE_BATTEMENT_MS,
  seuilMs = SEUIL_GEL_MS,
  retardTemoinMs?: number
): { blocageMs: number; cause: CauseGel } {
  const blocageMs = blocageDepuisReveil(ecouleMs, periodeMs, seuilMs)
  if (blocageMs > 0 && cpuMsConsomme >= blocageMs * PART_CPU_IMPUTABLE)
    return { blocageMs, cause: 'boucle-tenue' }
  /*
   * Sans temoin, le classement d'origine est STRICTEMENT conserve : les journaux anterieurs restent
   * relisibles et aucun gel ancien ne change de cause retroactivement.
   */
  if (
    blocageMs > 0 &&
    retardTemoinMs !== undefined &&
    retardTemoinMs < blocageMs * PART_TEMOIN_EN_RETARD
  )
    return { blocageMs, cause: 'entree-sortie-bloquante' }
  return { blocageMs, cause: 'process-prive-de-cpu' }
}

/**
 * Calcule le blocage a partir d'un reveil de minuteur.
 *
 * Un minuteur arme pour `periode` qui se reveille apres `ecoule` a ete retenu de `ecoule - periode`.
 * En dessous du seuil, il n'y a PAS de gel : rendre 0 evite de peindre en rouge l'ordonnancement
 * normal du systeme.
 */
export function blocageDepuisReveil(
  ecouleMs: number,
  periodeMs = PERIODE_BATTEMENT_MS,
  seuilMs = SEUIL_GEL_MS
): number {
  const retard = Math.round(ecouleMs - periodeMs)
  return retard >= seuilMs ? retard : 0
}

/** Agrege un journal de gels JSONL. Une ligne illisible est COMPTEE, jamais silencieusement jetee. */
export function resumerGels(lignes: readonly string[]): ResumeGels {
  const parOp = new Map<string, { gels: number; cumulMs: number; pireMs: number }>()
  let gels = 0
  let pireMs = 0
  let cumulMs = 0
  let lignesIllisibles = 0
  let demarrages = 0
  let gelsNonImputables = 0
  let msNonImputables = 0
  for (const ligne of lignes) {
    const brut = ligne.trim()
    if (!brut) continue
    let gel: Partial<Gel>
    try {
      gel = JSON.parse(brut) as Partial<Gel>
    } catch {
      lignesIllisibles += 1
      continue
    }
    // Le temoin de vie se compte AVANT le filtre sur la duree : il ne porte aucun blocage, et le
    // ranger dans les lignes illisibles ferait passer la preuve que l'instrument vit pour une
    // corruption du journal.
    if (gel.temoin === 'demarrage') {
      demarrages += 1
      continue
    }
    const ms =
      typeof gel.blocageMs === 'number' && Number.isFinite(gel.blocageMs) ? gel.blocageMs : 0
    if (ms <= 0) {
      lignesIllisibles += 1
      continue
    }
    // Un gel prouve NON imputable est compte a part : il est reel, mais l'operation declaree a cet
    // instant n'est qu'une coincidence — l'attribuer ferait chasser un alibi.
    if (gel.cause === 'process-prive-de-cpu') {
      gelsNonImputables += 1
      msNonImputables += ms
      continue
    }
    const nomDeclare =
      typeof gel.operation === 'string' && gel.operation ? gel.operation : 'inconnu'
    /*
     * La PISTE fait partie du nom du groupe, sinon elle n'arrive jamais sous les yeux : la vue
     * agrege par operation, et les 35 gels anonymes du journal reel se fondraient en une seule
     * ligne « inconnu » muette. Un gel anonyme SANS piste reste, lui, dans le groupe nu — on ne
     * lui prete pas la piste du voisin.
     */
    const operation =
      nomDeclare === 'inconnu' && typeof gel.indice === 'string' && gel.indice
        ? `inconnu (piste: ${gel.indice})`
        : nomDeclare
    gels += 1
    cumulMs += ms
    if (ms > pireMs) pireMs = ms
    const agg = parOp.get(operation) ?? { gels: 0, cumulMs: 0, pireMs: 0 }
    agg.gels += 1
    agg.cumulMs += ms
    if (ms > agg.pireMs) agg.pireMs = ms
    parOp.set(operation, agg)
  }
  const parOperation = [...parOp.entries()]
    .map(([operation, a]) => ({ operation, ...a }))
    .sort((a, b) => b.cumulMs - a.cumulMs)
  return {
    gels,
    demarrages,
    pireMs,
    cumulMs,
    parOperation,
    lignesIllisibles,
    gelsNonImputables,
    msNonImputables
  }
}

/**
 * NOMME un acces synchrone susceptible de tenir la boucle.
 *
 * Le temoin prouve QUE le main est coince dans une entree-sortie ; il ne dit pas LAQUELLE. Un
 * nom utile doit repondre a deux questions : quel appel, et surtout — disque local ou partage
 * RESEAU. Un `readFileSync` sur `//ged2` peut tenir la boucle des secondes quand le partage rame ;
 * le meme appel sur `C:` coute des millisecondes. Le chemin est CONDENSE (racine + fichier) :
 * l'agregation par operation doit regrouper les acces d'un meme partage, pas les eparpiller.
 */
/**
 * LA CLE DE CUMUL D'UN APPEL — assez fine pour nommer un coupable, assez grosse pour agreger.
 *
 * Mesure du 2026-09-03 (`gels.jsonl`, 536 gels) : `execFileSync` porte a lui seul 348 s de fenetre
 * morte sur 2 409 appels, dans TOUS les gisements — mais sous ce nom unique, rien ne dit QUELLE
 * commande. L'`indice` (l'IPC ouvert au moment du gel) ne le dit pas non plus : c'est un contexte,
 * pas un appelant, et 405 gels n'en ont aucun. On garde donc le programme et sa SOUS-COMMANDE
 * (`git diff`, `git cherry`, `git for-each-ref`) — jamais les arguments suivants, qui portent des
 * chemins et des SHA et feraient exploser le nombre de cles pour aucune information de plus.
 */
export function cleDeCumul(api: string, args: readonly unknown[]): string {
  if (!/^(execFile|spawn|exec)Sync$/.test(api)) return api
  const programme = args[0]
  if (typeof programme !== 'string' || !programme) return api
  const nom = programme.split(/[\\/]/).pop() || programme
  const suite = args[1]
  /*
   * La sous-commande est un MOT (`diff`, `cherry`, `for-each-ref`) : ni une option, ni sa valeur
   * (`-C /repo`), ni un chemin, ni un SHA. Le filtre garde donc les seuls jetons alphabetiques.
   */
  const sousCommande = Array.isArray(suite)
    ? suite.find((a) => typeof a === 'string' && /^[a-z][a-z0-9-]*$/.test(a))
    : undefined
  return typeof sousCommande === 'string' ? `${api} ${nom} ${sousCommande}` : `${api} ${nom}`
}

/**
 * LES FRAMES APPLICATIVES d'une pile, condensees en une ligne — jamais le bruit de node.
 *
 * On garde `fichier:ligne` des trois premieres frames hors `node:` et hors le detecteur lui-meme :
 * c'est ce qui nomme un appelant sans faire exploser la taille d'une ligne de journal.
 */
export function appelantApplicatif(pile: string | undefined, maxFrames = 3): string | undefined {
  if (!pile) return undefined
  const frames = pile
    .split(/\r?\n/)
    .slice(1)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.startsWith('at '))
    .filter((ligne) => !/\(node:|node:internal/.test(ligne))
    .filter((ligne) => !/gel-main|gel-detector/.test(ligne))
    .map((ligne) => {
      const emplacement = /\(?([^()\s]+:\d+:\d+)\)?$/.exec(ligne)?.[1]
      if (!emplacement) return undefined
      return emplacement.split(/[\\/]/).slice(-2).join('/')
    })
    .filter((frame): frame is string => frame !== undefined)
  return frames.length ? frames.slice(0, maxFrames).join(' < ') : undefined
}

export function nommerAccesBloquant(api: string, cible?: unknown): string {
  if (typeof cible !== 'string' || !cible) return `io:disque:${api}`
  const normalise = cible.split(String.fromCharCode(92)).join('/')
  const reseau = normalise.startsWith('//')
  const segments = normalise.split('/').filter(Boolean)
  const racine = reseau ? `//${segments.slice(0, 2).join('/')}` : (segments[0] ?? '')
  const fichier = segments[segments.length - 1] ?? ''
  const intermediaire = reseau ? segments.length > 3 : segments.length > 2
  const condense = intermediaire ? `${racine}/…/${fichier}` : `${racine}/${fichier}`
  return `io:${reseau ? 'reseau' : 'disque'}:${api} ${condense}`
}
