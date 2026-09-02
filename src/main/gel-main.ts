import { appendFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import {
  classerGel,
  nommerAccumulation,
  resumerGels,
  nommerAccesBloquant,
  PERIODE_BATTEMENT_MS,
  SEUIL_GEL_MS,
  type AccesCumule,
  type Gel,
  type ResumeGels
} from '../shared/gel-detector'

/**
 * BATTEMENT du process main — l'instrument qui attrape « ce programme ne repond pas ».
 *
 * Un minuteur arme a periode fixe. Tant que la boucle d'evenements tourne, il se reveille a
 * l'heure. Des qu'un appel synchrone la tient (lecture disque reseau, `spawnSync git`, scan de
 * dossier), le reveil arrive en retard — et ce retard est, a la milliseconde pres, la duree pendant
 * laquelle la fenetre etait figee. Journalise dans `<appdata>/autowin-os/gels.jsonl`, best-effort,
 * jamais bloquant.
 */

let dossier: string | undefined
let minuteur: NodeJS.Timeout | undefined

/*
 * PILE, et non scalaire. Mesure du 2026-08-28 : la premiere version remettait 'inactif' des la fin
 * de la lecture la plus INTERNE, si bien que les quatre gels reels captes (pire : 33 335 ms) sont
 * tous ressortis sous 'inconnu' / 'inactif' — l'instrument prouvait le gel sans jamais nommer le
 * coupable. Une operation imbriquee doit rendre la main a celle qui l'ENGLOBE, pas au vide.
 */
const pile: string[] = []

/*
 * DERNIERE OPERATION REFERMEE. Mesure du 2026-09-01 sur le journal reel : 35 gels sur 54 sortent
 * en `inconnu` (97,4 s de fenetre figee sur 124 s) et ne portent AUCUN autre champ — l'instrument
 * prouve le gel et n'offre aucune piste. On retient donc le nom ET l'instant de la derniere
 * operation refermee ; seule celle refermee PENDANT la fenetre figee sera reportee.
 */
let dernierFerme: { nom: string; a: number } | undefined

/*
 * CUMUL DES APPELS BLOQUANTS DE LA FENETRE COURANTE — le seul moyen de nommer une mort par mille
 * coupures. `instrumenterAccesBloquants` ne journalisait qu'un appel dont la duree SEULE depasse le
 * seuil ; cent lectures de 100 ms tiennent la boucle 10 s en restant invisibles. La cle est le nom
 * de l'API SEUL (pas le chemin) : la cardinalite reste bornee quoi que fasse l'application.
 */
const cumulFenetre = new Map<string, { cumulMs: number; appels: number }>()

/** Ajoute le temps synchrone d'un appel a la fenetre courante. */
export function cumulerAccesBloquant(api: string, dureeMs: number): void {
  if (dureeMs <= 0) return
  const cle = api || 'inconnu'
  const courant = cumulFenetre.get(cle)
  if (courant) {
    courant.cumulMs += dureeMs
    courant.appels += 1
    return
  }
  cumulFenetre.set(cle, { cumulMs: dureeMs, appels: 1 })
}

/** Rend le cumul de la fenetre et la REMET A ZERO — un cumul lu deux fois accuserait deux fois. */
export function preleverAccesCumules(): AccesCumule[] {
  const entrees: AccesCumule[] = [...cumulFenetre].map(([operation, { cumulMs, appels }]) => ({
    operation,
    cumulMs: Math.round(cumulMs),
    appels
  }))
  cumulFenetre.clear()
  return entrees
}

/**
 * VRAI une fois la phase de demarrage close — un jalon de demarrage n'a alors plus rien a etiqueter.
 *
 * Mesure du 2026-09-02 : `ready-to-show` est emis APRES `did-finish-load`, donc APRES
 * `cloreDemarrage()`. Son jalon reposait une etiquette que plus rien ne depilait, et 56 gels
 * s'etalant sur pres de 24 h sont ressortis sous 'demarrage:ready-to-show'.
 */
let demarrageClos = false

/** Ce que le main declare faire ICI et MAINTENANT — joint au gel pour NOMMER le coupable. */
export function marquerOperation(nom: string): void {
  if (demarrageClos && nom.startsWith('demarrage:')) return
  pile.length = 0
  if (nom) pile.push(nom)
}

/** Empile une operation et rend la fonction qui la depile — sur d'usage en `finally`. */
export function ouvrirOperation(nom: string): () => void {
  pile.push(nom || 'inconnu')
  let ferme = false
  return () => {
    if (ferme) return
    ferme = true
    const i = pile.lastIndexOf(nom || 'inconnu')
    if (i >= 0) pile.splice(i, 1)
    dernierFerme = { nom: nom || 'inconnu', a: Date.now() }
  }
}

/** Joue `action` en declarant `nom`, quoi qu'il arrive (succes, jet, rejet). */
/*
 * SEUL LE SEGMENT SYNCHRONE COMPTE — meme regle que pour les canaux IPC ci-dessous, appliquee ici
 * le 2026-08-31. La version precedente refermait l'operation au REGLEMENT de la promesse : une
 * action asynchrone restait donc declaree pendant toute son attente, alors qu'une promesse en
 * attente ne tient AUCUNEMENT la boucle d'evenements. Preuve dans gels.jsonl :
 * `timer:balayage:copiesAbandonnees` est arme toutes les HEURES et porte pourtant 28 gels, dont une
 * rafale de cinq entre 10:47:54 et 10:48:14 — il ramassait les gels causes par un AUTRE code. Un
 * alibi, pas un coupable : et pendant ce temps les vrais blocages (34 a 56 s) tombaient en
 * 'inconnu'. On ne declare donc que ce qui s'execute AVANT le premier await.
 */
export function pendantOperation<T>(nom: string, action: () => T): T {
  const fermer = ouvrirOperation(nom)
  try {
    return action()
  } finally {
    fermer()
  }
}

/**
 * CLOT la phase de demarrage. Mesure du 2026-08-30 : `marquerOperation('demarrage:...')` EMPILE un
 * jalon que rien ne depilait — la pile gardait donc 'demarrage:interface chargee' indefiniment, et
 * 49 des 173 gels du journal ont ete attribues au demarrage alors qu'ils survenaient des HEURES
 * plus tard (rafales de 6 a 10 s a 10h41 sur une app demarree a 7h). L'instrument prouvait le gel
 * sans jamais nommer le coupable. Une phase qui se termine rend la pile au vide.
 */
export function cloreDemarrage(): void {
  pile.length = 0
  demarrageClos = true
}

/** Rend l'operation la plus INTERNE encore ouverte (utile aux tests et au diagnostic). */
export function operationDeclaree(): string {
  return pile.length > 0 ? (pile[pile.length - 1] as string) : 'inconnu'
}

/*
 * UN SEUL PUITS D'ECRITURE. Le battement et les mesures DIRECTES doivent aboutir au meme endroit :
 * deux chemins d'ecriture, c'est un test qui observe l'un pendant que le produit alimente l'autre.
 */
let puits: (gel: Gel) => void = journaliser

/** Depose un gel dans le journal — expose pour les mesures DIRECTES (segments synchrones). */
export function journaliserGel(gel: Gel): void {
  puits(gel)
}

function journaliser(gel: Gel): void {
  if (!dossier) return
  const racine = dossier
  void mkdir(racine, { recursive: true })
    .then(() => appendFile(join(racine, 'gels.jsonl'), JSON.stringify(gel) + '\n', 'utf8'))
    .catch(() => {
      /* observabilite best-effort : un journal muet ne doit jamais casser l'application */
    })
}

/**
 * Demarre le battement. Sans dossier, le detecteur reste INERTE (aucun minuteur arme) — un test ou
 * un demarrage sans espace de donnees ne doit pas payer un timer.
 */
export function demarrerDetecteurDeGel(
  dir: string,
  periodeMs = PERIODE_BATTEMENT_MS,
  ecrire: (gel: Gel) => void = journaliser,
  seuilMs = SEUIL_GEL_MS
): () => void {
  dossier = dir
  puits = ecrire
  /*
   * POINT D'ANCRAGE GLOBAL — pour que les attentes qui ne passent par AUCUNE API instrumentee
   * puissent quand meme se DECLARER. `instrumenterEntreesSortiesDuMain` ne patche que `node:fs` et
   * `node:child_process` ; une attente `Atomics.wait` (verrou de sequence de trace) leur est
   * invisible, et ressortait donc en `operation:'inconnu'` — le cas des sept plus gros gels du
   * 2026-08-31. Un module bas niveau ne doit pas importer le detecteur (cycle, et la trace ne doit
   * jamais dependre de l'observabilite) : il lit ce point d'ancrage s'il existe, sinon il n'y a
   * simplement pas de nom.
   */
  ;(
    globalThis as { __autowinGel__?: { ouvrirOperation: (nom: string) => () => void } }
  ).__autowinGel__ = { ouvrirOperation }
  let precedent = Date.now()
  /*
   * PREUVE PAR LE CPU. Un reveil tardif dit que le temps a passe, pas OU il a passe. On releve donc
   * le CPU consomme par NOTRE process pendant l'intervalle : brule chez nous => la boucle etait
   * tenue par notre code ; pas brule => nous etions desordonnances (machine saturee, veille) et
   * l'operation declaree a cet instant n'est qu'une coincidence.
   */
  let cpuPrecedent = process.cpuUsage()
  const temoin = demarrerTemoin(periodeMs)
  minuteur = setInterval(() => {
    const maintenant = Date.now()
    const delta = process.cpuUsage(cpuPrecedent)
    cpuPrecedent = process.cpuUsage()
    const cpuMs = (delta.user + delta.system) / 1000
    const { blocageMs, cause } = classerGel(
      maintenant - precedent,
      cpuMs,
      periodeMs,
      seuilMs,
      temoin?.retardMaxDepuisLaDerniereLecture()
    )
    const debutFenetre = precedent
    precedent = maintenant
    // PRELEVE A CHAQUE REVEIL, gel ou pas : un cumul qui traine d'une fenetre a l'autre attribuerait
    // a un gel des appels qui l'ont precede — l'erreur d'alibi, deja payee sur `indice`.
    const cumules = preleverAccesCumules()
    if (blocageMs > 0) {
      const operation = operationDeclaree()
      /*
       * L'indice n'est servi QUE faute de mieux, et QUE si l'operation s'est refermee dans la
       * fenetre figee : hors de cette fenetre, c'est un alibi, pas un suspect.
       */
      const indice =
        operation === 'inconnu' && dernierFerme && dernierFerme.a >= debutFenetre
          ? dernierFerme.nom
          : undefined
      const accumulation = nommerAccumulation(cumules, blocageMs)
      ecrire({
        ts: new Date(maintenant).toISOString(),
        blocageMs,
        operation,
        cause,
        ...(indice ? { indice } : {}),
        ...(accumulation ? { accumulation } : {})
      })
    }
  }, periodeMs)
  minuteur.unref?.()
  return () => {
    if (minuteur) clearInterval(minuteur)
    minuteur = undefined
    temoin?.arreter()
    puits = journaliser
  }
}

/*
 * TEMOIN ORDONNANCE — ce qui permet enfin de distinguer « la machine ne nous donne pas de CPU » de
 * « NOTRE thread principal est coince dans un appel bloquant ».
 *
 * Mesure conv-1539 (2026-08-30) : cinq gels de 11,7 a 14,9 s, espaces d'environ une minute, tous
 * classes `process-prive-de-cpu` — donc « pas notre code ». Or une lecture SYNCHRONE sur le partage
 * reseau //ged2 produit exactement cette signature : la boucle est tenue par nous, sans bruler un
 * cycle. Le CPU seul ne peut pas trancher. Un second thread, lui, le peut : s'il bat A L'HEURE
 * pendant que le main est en retard, l'ordonnanceur nous servait bien — le main etait bloque.
 *
 * La mesure transite par un SharedArrayBuffer et non par `postMessage` : un message devrait passer
 * par la boucle d'evenements du main, precisement celle qui est figee. La memoire partagee se lit
 * sans elle.
 */
const CASE_RETARD_MAX = 0

function demarrerTemoin(
  periodeMs: number
): { retardMaxDepuisLaDerniereLecture: () => number; arreter: () => void } | undefined {
  try {
    const tampon = new SharedArrayBuffer(4)
    const vue = new Int32Array(tampon)
    const worker = new Worker(
      `const { workerData } = require('worker_threads')
const vue = new Int32Array(workerData.tampon)
let precedent = Date.now()
setInterval(() => {
  const maintenant = Date.now()
  const retard = maintenant - precedent - workerData.periodeMs
  precedent = maintenant
  if (retard > 0 && retard > Atomics.load(vue, 0)) Atomics.store(vue, 0, retard)
}, workerData.periodeMs)`,
      { eval: true, workerData: { tampon, periodeMs } }
    )
    // Un instrument d'observabilite ne doit JAMAIS retenir l'application ouverte.
    worker.unref()
    worker.on('error', () => {
      /* best-effort : sans temoin, le classement retombe sur l'heuristique CPU seule */
    })
    return {
      retardMaxDepuisLaDerniereLecture: () => Atomics.exchange(vue, CASE_RETARD_MAX, 0),
      arreter: () => void worker.terminate()
    }
  } catch {
    /* SharedArrayBuffer ou worker indisponible : on garde le classement historique. */
    return undefined
  }
}

export interface RapportGels extends ResumeGels {
  /** FAUX quand aucun journal n'existe : la vue le DIT au lieu d'afficher un zero rassurant. */
  disponible: boolean
  source: string
}

/** Lecture SEULE du journal, bornee aux derniers gels : un gel d'il y a trois semaines ne decrit rien. */
export function lireGels(dir: string, derniers = 200): RapportGels {
  const source = join(dir, 'gels.jsonl')
  if (!existsSync(source)) return { ...resumerGels([]), disponible: false, source }
  const lignes = readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean)
  const fenetre = derniers > 0 ? lignes.slice(-derniers) : lignes
  return { ...resumerGels(fenetre), disponible: true, source }
}

/**
 * Fait DECLARER son canal a chaque handler IPC, en une seule couture.
 *
 * Les 149 \`ipcMain.handle\` du main sont la porte d'entree de tout ce que le renderer demande. Les
 * instrumenter un par un serait 149 occasions d'en oublier un ; on enrobe donc l'enregistrement
 * lui-meme. Le handler d'origine est appele tel quel : aucune valeur, aucun rejet n'est modifie.
 */
export function instrumenterCanauxIpc(ipc: {
  handle: (canal: string, ecouteur: (...a: never[]) => unknown) => void
}): void {
  const original = ipc.handle.bind(ipc)
  ipc.handle = (canal: string, ecouteur: (...a: never[]) => unknown): void =>
    original(canal, (...args: never[]) => {
      /*
       * SEUL LE SEGMENT SYNCHRONE COMPTE — mesure du 2026-08-28 (conv-1511).
       *
       * Un gel est, par definition, la boucle d'evenements TENUE : une promesse en attente ne tient
       * rien. La premiere version refermait l'operation au REGLEMENT de la promesse ; un handler
       * async lent (`os:models:quotas`, qui attend un `fetch` reseau) restait donc declare pendant
       * toute son attente et ramassait le nom de blocages causes par un AUTRE code. Il est ressorti
       * treize fois en tete du journal — un alibi, pas un coupable ; la lecture disque qu'on lui
       * imputait a ete chronometree a 30 ms.
       *
       * On ne declare donc que ce qui s'execute AVANT le premier await : le seul segment qui puisse
       * reellement figer la fenetre.
       */
      const fermer = ouvrirOperation(`ipc:${canal}`)
      const depart = Date.now()
      try {
        return ecouteur(...args)
      } finally {
        fermer()
        /*
         * MESURE DIRECTE, plutot qu'attribution par coincidence.
         *
         * Le battement dit QUE la boucle a ete tenue ; il designe l'operation ouverte a cet
         * instant, ce qui reste une CORRELATION. Ici on chronometre le segment synchrone lui-meme :
         * s'il depasse le seuil, c'est une PREUVE que ce canal a tenu la boucle pendant ce temps —
         * le suffixe `(sync)` distingue cette mesure directe de l'attribution du battement.
         */
        const dureeMs = Date.now() - depart
        if (dureeMs >= SEUIL_GEL_MS) {
          journaliserGel({
            ts: new Date().toISOString(),
            blocageMs: dureeMs,
            operation: `ipc:${canal} (sync)`,
            // Chronometrage DIRECT du segment synchrone : imputable par construction, sans
            // dependre de l'heuristique CPU (un blocage d'entree-sortie ne brule pas de CPU).
            cause: 'boucle-tenue'
          })
        }
      }
    })
}

/**
 * INSTRUMENTE des appels SYNCHRONES d'entree-sortie sur un hote (module `fs`, `child_process`…).
 *
 * Le temoin ordonnance a prouve (conv-1539, gel de 22 652 ms) que nos gels sont des
 * `entree-sortie-bloquante` : la boucle est tenue par NOTRE code sans bruler de CPU. L'heuristique
 * ne peut pas aller plus loin ; seule une mesure DIRECTE du segment synchrone peut nommer l'appel.
 * On enrobe donc chaque fonction visee : au-dela du seuil, on journalise `io:<reseau|disque>:<api>
 * <chemin condense>` avec la cause prouvee par construction. La valeur et les jets d'origine
 * passent intacts, et `defaire()` restaure les fonctions d'origine (aucune fuite entre tests).
 */
export function instrumenterAccesBloquants<H extends Record<string, unknown>>(
  hote: H,
  fonctions: readonly (keyof H & string)[],
  seuilMs = SEUIL_GEL_MS,
  ecrire: (gel: Gel) => void = journaliserGel
): () => void {
  const originales = new Map<string, unknown>()
  for (const nom of fonctions) {
    const originale = hote[nom]
    if (typeof originale !== 'function') continue
    originales.set(nom, originale)
    const fn = originale as (...a: unknown[]) => unknown
    const instrumentee = function instrumentee(this: unknown, ...args: unknown[]): unknown {
      const depart = Date.now()
      try {
        return fn.apply(this, args)
      } finally {
        const dureeMs = Date.now() - depart
        cumulerAccesBloquant(nom, dureeMs)
        if (dureeMs >= seuilMs) {
          ecrire({
            ts: new Date().toISOString(),
            blocageMs: dureeMs,
            operation: nommerAccesBloquant(nom, args[0]),
            cause: 'entree-sortie-bloquante'
          })
        }
      }
    }
    /*
     * L'ENROBAGE REND LA MEME SURFACE D'API — mesure du 2026-08-31 (conv-9).
     *
     * `fs.realpathSync` porte une SOUS-FONCTION `realpathSync.native`. Un enrobage nu ne la
     * transporte pas : des l'appel de `instrumenterEntreesSortiesDuMain` au demarrage, les dix
     * sites `realpathSync.native(...)` du main tombaient sur « node_fs.realpathSync.native is not a
     * function » — `os:semanticTimeline` mort, telemetrie annoncee indisponible a l'utilisateur.
     * OBSERVER UN APPEL NE DOIT JAMAIS AMPUTER SA SURFACE : on recopie ses proprietes propres, hors
     * identite de fonction (`length`, `name`, `prototype`, que l'enrobage porte deja).
     *
     * La sous-fonction ainsi transportee reste l'ORIGINALE : elle n'est pas chronometree, donc un
     * blocage sur `realpathSync.native` reste invisible au journal. Limite assumee ici — mieux vaut
     * un angle mort d'observabilite qu'une API cassee.
     */
    for (const cle of Object.getOwnPropertyNames(fn)) {
      if (cle === 'length' || cle === 'name' || cle === 'prototype') continue
      const descripteur = Object.getOwnPropertyDescriptor(fn, cle)
      if (descripteur) Object.defineProperty(instrumentee, cle, descripteur)
    }
    ;(hote as Record<string, unknown>)[nom] = instrumentee
  }
  return () => {
    for (const [nom, originale] of originales) (hote as Record<string, unknown>)[nom] = originale
  }
}

/**
 * Cable l'instrumentation sur les entrees-sorties SYNCHRONES reellement utilisees par le main.
 *
 * On patche les OBJETS de module (`node:fs`, `node:child_process`) : c'est par eux que passent les
 * appels du bundle, et cela evite d'instrumenter 149 sites d'appel un par un — la meme couture
 * unique que pour les canaux IPC. `defaire()` restaure tout.
 */
export function instrumenterEntreesSortiesDuMain(
  seuilMs = SEUIL_GEL_MS,
  ecrire: (gel: Gel) => void = journaliserGel
): () => void {
  const requiert = createRequire(import.meta.url)
  const defaires: Array<() => void> = []
  const cibles: Array<[string, readonly string[]]> = [
    [
      'node:fs',
      [
        'readFileSync',
        'writeFileSync',
        'appendFileSync',
        'readdirSync',
        'statSync',
        'lstatSync',
        'existsSync',
        'copyFileSync',
        'renameSync',
        'rmSync',
        'mkdirSync',
        'realpathSync',
        /*
         * ANGLE MORT COMBLE le 2026-08-31. Les deux plus gros gels du journal (32 751 ms et
         * 33 137 ms, 09:55 et 09:57 locales) sont sortis en 'inconnu' AVEC la cause
         * 'entree-sortie-bloquante' — donc le temoin n'etait PAS en retard : la machine allait
         * bien, c'est NOTRE boucle qui etait tenue par une entree-sortie. Aucun des appels
         * instrumentes ne les a signales, la liste ne couvrait donc pas le chemin coupable.
         * Les descripteurs bruts et les operations d'entree ci-dessous ferment ce trou.
         */
        'openSync',
        'fstatSync',
        'readSync',
        'writeSync',
        'closeSync',
        'writevSync',
        'accessSync',
        'unlinkSync',
        'rmdirSync',
        'readlinkSync',
        'opendirSync',
        'cpSync',
        'utimesSync',
        'truncateSync'
      ]
    ],
    ['node:child_process', ['execSync', 'execFileSync', 'spawnSync']]
  ]
  for (const [module, fonctions] of cibles) {
    try {
      const hote = requiert(module) as Record<string, unknown>
      defaires.push(instrumenterAccesBloquants(hote, fonctions, seuilMs, ecrire))
    } catch {
      /* observabilite best-effort : un module absent ne doit jamais casser le demarrage */
    }
  }
  return () => {
    for (const defaire of defaires) defaire()
  }
}
