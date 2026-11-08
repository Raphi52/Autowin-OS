import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

/**
 * PROFIL CPU DU PROCESSUS PRINCIPAL PENDANT UN GEL — ce qui nomme les gels « inconnu ».
 *
 * Le détecteur (`gel-main.ts`) ne nomme que les appels disque et processus synchrones qu'il a
 * instrumentés, et le segment synchrone des canaux IPC. Un gel de pur calcul JavaScript ressort en
 * `operation: 'inconnu'`, cause `boucle-tenue`, sans appelant. Mesure du 2026-11-06 : 16 gels sur 20
 * de ce type en quarante minutes, de 30 à 58 s chacun. Un profil pris à la main pendant l'un d'eux
 * a nommé la fonction en une minute (99 % du temps dans une seule pile) : c'est l'instrument qui
 * manquait, pas une hypothèse de plus.
 *
 * POURQUOI UN THREAD À PART. Le battement du principal s'arrête justement pendant le gel : aucun code
 * du principal ne peut démarrer le profileur à ce moment-là. Un worker, lui, voit le battement
 * s'arrêter (mémoire partagée, lue sans passer par la boucle figée) et parle à l'inspecteur du
 * principal (`Session.connectToMainThread`). V8 traite ses ordres par interruption, au milieu du
 * JavaScript qui tient la boucle : mesuré sur Electron 44, `Profiler.start` est acquitté 17 à 39 ms
 * après la détection, pendant une boucle de 3 s, et la fonction qui gèle est dans le profil.
 *
 * ANGLE MORT DU PROFIL, ET SA PARADE. Un profileur démarré PENDANT le gel ne connaît pas le code
 * compilé avant lui pour la boucle en cours (compilation « à la volée » d'une boucle longue, OSR) :
 * mesuré le 2026-11-06, la boucle qui gèle y sort sans nom ni ligne, et la même boucle lancée avec
 * `--no-use-osr` y est nommée. Or un gel de 30 s est justement une boucle longue. Le worker relève
 * donc AUSSI la pile JavaScript du principal toutes les `pileMs` (`Runtime.evaluate`, servi par la
 * même interruption) : elle donne la fonction, le fichier et la ligne quel que soit le niveau de
 * compilation. Le profil garde ce que la pile ne voit pas : ramasse-miettes, fonctions natives.
 *
 * Limite assumée : un principal bloqué dans un appel NATIF synchrone (lecture disque) ne traite
 * les ordres qu'au retour. Le profil ne couvre alors rien du gel et il est jeté — ce cas-là est déjà
 * nommé par l'instrumentation des entrées-sorties.
 *
 * Aucun port réseau : la session est interne au processus. Le profileur ne tourne QUE pendant un
 * silence du battement, puis il est désactivé.
 */

/** Dossier des profils, à côté de `gels.jsonl`. */
export const DOSSIER_DES_PROFILS = 'gels-profils'
/** Une ligne par profil gardé : `gels-profils/index.jsonl`. */
export const INDEX_DES_PROFILS = 'index.jsonl'

export interface ReglagesProfilPendantGel {
  /** Période d'écriture du battement par le principal. */
  battementMs: number
  /** Période de lecture du battement par le worker. */
  tickMs: number
  /** Silence du battement à partir duquel le profileur démarre. */
  silenceAvantProfilMs: number
  /** Durée minimale du gel pour que le profil soit gardé ; en dessous, il est jeté. */
  gelGardeMs: number
  /** Part du gel que le profil doit couvrir au minimum (profil démarré trop tard = jeté). */
  couvertureMinMs: number
  /** Intervalle d'échantillonnage du profileur, en microsecondes. */
  intervalleUs: number
  /** Nombre de profils gardés sur le disque ; les plus anciens sont effacés. */
  profilsGardes: number
  /** Période des relevés de pile pendant un gel. */
  pileMs: number
  /** Nombre maximal de relevés de pile par gel. */
  pilesMax: number
  /**
   * Motif qui reconnaît NOTRE code dans un relevé (appliqué au chemin du fichier, séparateurs `/`).
   * Sans lui, une fonction de Node ou d'Electron nommerait le gel à la place de notre code.
   */
  motifNotreCode: string
}

/*
 * 10 ms d'échantillonnage : un gel de 10 s donne 1 000 échantillons, assez pour nommer une pile, et
 * un gel de 58 s reste sous le mégaoctet. Démarrer à 2 s de silence perd les deux premières
 * secondes, mais évite de profiler chaque petit à-coup ; un gel long garde la même pile d'un bout à
 * l'autre (mesuré : 99 % dans une seule pile sur 27,6 s).
 */
export const REGLAGES_PAR_DEFAUT: ReglagesProfilPendantGel = {
  battementMs: 250,
  tickMs: 250,
  silenceAvantProfilMs: 2_000,
  gelGardeMs: 10_000,
  couvertureMinMs: 1_000,
  intervalleUs: 10_000,
  profilsGardes: 30,
  pileMs: 250,
  pilesMax: 240,
  motifNotreCode: 'out/main/(chunks/)?[^/]+[.]js$'
}

/*
 * LE NOM DU GEL, écrit PENDANT le gel. Le fil principal est bloqué : c'est le worker qui lit les
 * relevés (V8 les sert par interruption), calcule la fonction qui tient la fenêtre, puis la publie
 * dans une petite mémoire partagée que le détecteur lit à la fin du gel. Sans ce nom publié tôt, la
 * ligne du journal part en « inconnu » : le profil complet n'existe qu'une fois le gel fini.
 * fix-ok: cause mesurée — les 10 gels profilés du 06/11 (gels.jsonl, 10:57:00.222Z et suivants)
 * sortent « inconnu », parce que nommerOperationDuGel ne lit que l'opération déclarée et
 * l'accumulation, jamais le profil ; le nom n'existait que dans le classement.
 *
 * LA MÊME RÈGLE que scripts/gels-profils.mjs (quiTientLaFenetre) : on descend l'arbre des appels
 * depuis le haut tant que le chemin le plus fréquent garde la MAJORITÉ stricte des relevés. Une
 * égalité ne désigne personne. Tout écart entre les deux serait un nom différent pour un même gel.
 *
 * Mémoire partagée : un en-tête de trois entiers (séquence, longueur du nom, génération du gel),
 * puis les octets du nom. La séquence est impaire pendant une écriture, pour qu'un lecteur qui
 * tombe au milieu la rejette au lieu de lire un mélange.
 */
const NOM_OCTETS_MAX = 256
const TETE_NOM_OCTETS = 16

/** Règle de nommage, en JavaScript pur : elle tourne dans le worker, sans module de l'application. */
export const CODE_DU_NOMMAGE = String.raw`
function creerNommageDuGel(motifSource) {
  const notre = new RegExp(motifSource)
  let arbre = { enfants: new Map() }
  let releves = 0
  return {
    reinitialiser() {
      arbre = { enfants: new Map() }
      releves = 0
    },
    ajouter(frames) {
      releves += 1
      const chaine = []
      for (const texte of frames) {
        const m = /^(.*) (\S+):(\d+):(\d+)$/.exec(texte)
        if (!m) continue
        const fichier = m[2].replace(/\\/g, '/')
        if (!notre.test(fichier)) continue
        // fix-ok: cause mesurée — 6 gels sur 10 du 06/11 sortent « (anonyme) » seul (relevés
        // réels), nom qui ne désigne rien. La position dans le bundle reste la seule piste.
        const i = fichier.lastIndexOf('/out/')
        const court = i >= 0 ? fichier.slice(i + 5) : fichier
        chaine.push({
          fonction: m[1],
          frame: fichier + ':' + m[3] + ':' + m[4],
          lieu: court + ':' + m[3] + ':' + m[4]
        })
      }
      let noeud = arbre
      for (const f of chaine.reverse()) {
        let enfant = noeud.enfants.get(f.frame)
        if (!enfant) {
          enfant = { fonction: f.fonction, lieu: f.lieu, n: 0, enfants: new Map() }
          noeud.enfants.set(f.frame, enfant)
        }
        enfant.n += 1
        noeud = enfant
      }
    },
    nom() {
      if (!releves) return undefined
      let noeud = arbre
      let coupable
      for (;;) {
        const suivant = [...noeud.enfants.values()].sort((a, b) => b.n - a.n)[0]
        if (!suivant || (coupable && suivant.n * 2 <= releves)) break
        coupable = suivant
        noeud = suivant
      }
      if (!coupable) return undefined
      return coupable.fonction === '(anonyme)' ? '(anonyme) ' + coupable.lieu : coupable.fonction
    }
  }
}
`

/**
 * Code du worker, évalué tel quel (CommonJS) : il ne doit dépendre d'aucun module de l'app, et il
 * écrit sur le disque depuis SON thread — jamais depuis le principal, qui sort à peine d'un gel.
 */
export const CODE_DU_PROFILEUR = `
const { workerData } = require('node:worker_threads')
const inspector = require('node:inspector')
const fs = require('node:fs')
const path = require('node:path')
const r = workerData.reglages
const dossier = workerData.dossier
${CODE_DU_NOMMAGE}
const battement = new BigInt64Array(workerData.tampon)
const entete = new Int32Array(workerData.tamponNom, 0, 3)
const octetsDuNom = new Uint8Array(workerData.tamponNom, ${TETE_NOM_OCTETS})
const nommage = creerNommageDuGel(r.motifNotreCode)
let numeroGel = 0
// Publie le nom du gel (texte vide = aucun nom). Séquence impaire pendant l'écriture, cf. en-tête.
function publierLeNom(texte, gel) {
  const octets = new TextEncoder().encode(texte).subarray(0, octetsDuNom.length)
  Atomics.add(entete, 0, 1)
  octetsDuNom.set(octets, 0)
  Atomics.store(entete, 1, octets.length)
  Atomics.store(entete, 2, gel)
  Atomics.add(entete, 0, 1)
}
const session = new inspector.Session()
session.connectToMainThread()
const envoyer = (methode, params) =>
  new Promise((ok, ko) => session.post(methode, params || {}, (e, res) => (e ? ko(e) : ok(res))))
let etat = 'repos'
let debutGel = 0
let profilDepuis = 0
let tickPrecedent = Date.now()
let piles = []
let releveEnVol = false
let dernierReleve = 0
const iso = (ms) => new Date(ms).toISOString()
// Position de DÉBUT de chaque fonction (getEnclosing…), comme dans le profil : deux relevés de la
// même boucle pris à deux lignes différentes doivent compter pour la même fonction.
const RELEVE_DE_PILE = '(() => { const E = Error, l = E.stackTraceLimit, p = E.prepareStackTrace;' +
  ' E.stackTraceLimit = 60;' +
  ' const lieu = (x) => x.getEnclosingLineNumber ? x.getEnclosingLineNumber() + ":" + x.getEnclosingColumnNumber() : x.getLineNumber() + ":" + x.getColumnNumber();' +
  " E.prepareStackTrace = (_e, sites) => sites.filter((x) => x.getFileName()).map((x) => (x.getFunctionName() || '(anonyme)') + ' ' + x.getFileName() + ':' + lieu(x));" +
  ' try { return new E().stack } finally { E.stackTraceLimit = l; E.prepareStackTrace = p } })()'

function relever(maintenant) {
  if (releveEnVol || piles.length >= r.pilesMax || maintenant - dernierReleve < r.pileMs) return
  releveEnVol = true
  dernierReleve = maintenant
  const gelDuReleve = numeroGel
  envoyer('Runtime.evaluate', { expression: RELEVE_DE_PILE, returnByValue: true, silent: true })
    .then((res) => {
      const frames = res && res.result && res.result.value
      if (Array.isArray(frames) && frames.length) {
        piles.push({ a: iso(Date.now()), frames })
        // Un relevé qui revient APRES le début d'un gel suivant ne doit pas nommer ce gel-là.
        if (gelDuReleve === numeroGel) {
          nommage.ajouter(frames)
          publierLeNom(nommage.nom() ?? '', numeroGel)
        }
      }
    })
    .catch(() => {})
    .finally(() => { releveEnVol = false })
}

function garderLesDerniers() {
  const profils = fs.readdirSync(dossier).filter((f) => f.endsWith('.cpuprofile')).sort()
  const enTrop = profils.slice(0, Math.max(0, profils.length - r.profilsGardes))
  if (!enTrop.length) return
  for (const f of enTrop) {
    fs.rmSync(path.join(dossier, f), { force: true })
    fs.rmSync(path.join(dossier, f.replace(/.cpuprofile$/, '.piles.json')), { force: true })
  }
  const index = path.join(dossier, '${INDEX_DES_PROFILS}')
  const restants = new Set(profils.slice(enTrop.length))
  const lignes = fs.readFileSync(index, 'utf8').split('\\n').filter((l) => {
    try { return restants.has(JSON.parse(l).fichier) } catch { return false }
  })
  fs.writeFileSync(index, lignes.map((l) => l + '\\n').join(''))
}

function ecrire(profil, finGel, releves) {
  fs.mkdirSync(dossier, { recursive: true })
  const base = iso(debutGel).replace(/[:.]/g, '-')
  const fichier = base + '.cpuprofile'
  fs.writeFileSync(path.join(dossier, fichier), JSON.stringify(profil))
  fs.writeFileSync(path.join(dossier, base + '.piles.json'), JSON.stringify({ schema: 'autowin.gel-piles/v1', piles: releves }))
  const ligne = {
    schema: 'autowin.gel-profil/v1',
    debut: iso(profilDepuis),
    fin: iso(finGel),
    debutGel: iso(debutGel),
    gelMs: finGel - debutGel,
    fichier,
    piles: base + '.piles.json',
    releves: releves.length,
    echantillons: profil.samples ? profil.samples.length : 0,
    origine: 'detecteur'
  }
  fs.appendFileSync(path.join(dossier, '${INDEX_DES_PROFILS}'), JSON.stringify(ligne) + '\\n')
  garderLesDerniers()
}

setInterval(() => {
  const maintenant = Date.now()
  const ecartPropre = maintenant - tickPrecedent
  tickPrecedent = maintenant
  const dernier = Number(Atomics.load(battement, 0))
  const silence = maintenant - dernier
  if (etat === 'repos') {
    // Le worker lui-même en retard : veille ou machine saturée, pas un gel du principal.
    if (ecartPropre > r.tickMs * 4 + 1000) return
    if (silence < r.silenceAvantProfilMs) return
    etat = 'demarrage'
    debutGel = dernier
    piles = []
    dernierReleve = 0
    numeroGel += 1
    nommage.reinitialiser()
    publierLeNom('', numeroGel)
    relever(maintenant)
    envoyer('Profiler.enable')
      .then(() => envoyer('Profiler.setSamplingInterval', { interval: r.intervalleUs }))
      .then(() => envoyer('Profiler.start'))
      .then(() => { profilDepuis = Date.now(); etat = 'profil' })
      .catch(() => { etat = 'repos'; envoyer('Profiler.disable').catch(() => {}) })
    return
  }
  if (etat === 'arret') return
  // Battement encore arrêté : le gel continue, on relève sa pile.
  if (silence > r.battementMs * 4 + 200) {
    relever(maintenant)
    return
  }
  if (etat !== 'profil') return
  etat = 'arret'
  const finGel = dernier
  const releves = piles
  piles = []
  envoyer('Profiler.stop')
    .then((res) => {
      envoyer('Profiler.disable').catch(() => {})
      if (finGel - debutGel >= r.gelGardeMs && finGel - profilDepuis >= r.couvertureMinMs) {
        ecrire(res.profile, finGel, releves)
      }
    })
    .catch(() => {})
    .finally(() => { etat = 'repos' })
}, r.tickMs)
`

/** Lecteur du profileur en cours — `undefined` tant qu'aucun profileur ne tourne sur ce processus. */
let lecteurDuNomCourant: (() => string | undefined) | undefined

/**
 * Lecteur du nom publié par le worker. Un nom ne se rend qu'UNE fois : le détecteur le lit à chaque
 * réveil, et une lecture déjà faite pour ce gel ne rend plus rien — un gel sans nom ne doit jamais
 * hériter du nom d'un gel précédent.
 */
function creerLecteurDuNom(tampon: SharedArrayBuffer): () => string | undefined {
  const entete = new Int32Array(tampon, 0, 3)
  const octets = new Uint8Array(tampon, TETE_NOM_OCTETS)
  let generationLue = -1
  return () => {
    for (let essai = 0; essai < 3; essai++) {
      const sequence = Atomics.load(entete, 0)
      if (sequence % 2 !== 0) continue
      const longueur = Atomics.load(entete, 1)
      const generation = Atomics.load(entete, 2)
      const copie = octets.slice(0, longueur)
      if (Atomics.load(entete, 0) !== sequence) continue
      if (generation === generationLue) return undefined
      generationLue = generation
      return longueur > 0 ? new TextDecoder().decode(copie) : undefined
    }
    return undefined
  }
}

/**
 * Le nom de la fonction qui tient le gel en cours, tel que le worker l'a publié pendant le gel —
 * `undefined` s'il n'y en a pas, ou s'il a déjà été lu pour ce gel. Appelé à chaque réveil du
 * détecteur, pour que le nom rejoigne la ligne du gel et nulle part ailleurs.
 */
export function lireNomDuGelProfile(): string | undefined {
  return lecteurDuNomCourant?.()
}

/**
 * Démarre le profileur de gels pour le processus courant. Rend la fonction d'arrêt, ou `undefined`
 * si la plateforme ne le permet pas (pas de mémoire partagée, pas de worker). Un inspecteur absent
 * (binaire empaqueté qui l'a retiré) fait échouer le worker en silence : c'est un instrument
 * d'observabilité, il ne doit jamais empêcher l'app de tourner.
 */
export function demarrerProfilPendantGel(
  dir: string,
  reglages: Partial<ReglagesProfilPendantGel> = {}
): (() => void) | undefined {
  const r = { ...REGLAGES_PAR_DEFAUT, ...reglages }
  try {
    const tampon = new SharedArrayBuffer(8)
    const battement = new BigInt64Array(tampon)
    const battre = (): void => {
      Atomics.store(battement, 0, BigInt(Date.now()))
    }
    battre()
    const minuteur = setInterval(battre, r.battementMs)
    minuteur.unref?.()
    const tamponNom = new SharedArrayBuffer(TETE_NOM_OCTETS + NOM_OCTETS_MAX)
    const lecteur = creerLecteurDuNom(tamponNom)
    lecteurDuNomCourant = lecteur
    const worker = new Worker(CODE_DU_PROFILEUR, {
      eval: true,
      workerData: { tampon, tamponNom, dossier: join(dir, DOSSIER_DES_PROFILS), reglages: r }
    })
    // Un instrument d'observabilité ne doit JAMAIS retenir l'application ouverte.
    worker.unref()
    worker.on('error', () => {
      /* best-effort : sans inspecteur, les gels « inconnu » restent anonymes, rien de plus */
    })
    return () => {
      clearInterval(minuteur)
      if (lecteurDuNomCourant === lecteur) lecteurDuNomCourant = undefined
      void worker.terminate()
    }
  } catch {
    return undefined
  }
}
