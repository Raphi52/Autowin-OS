/**
 * ARCHIVE DES CARTES DE SOURCES DU PROCESSUS PRINCIPAL — pour que `/gel` remonte un gel ANCIEN.
 *
 * Pourquoi (conv-1055, 2026-10-22) : `gels-classement.mjs` ne lisait que les `.map` présents dans
 * `out/main/`. Or chaque construction les réécrit : `index.js.map` sous le même nom, les morceaux
 * sous un nouveau nom haché. Le gel du 21/10 à 20:14 (60,1 s de `git status`) citait
 * `chunks/worktree-manager-HqcvLEtO.js`, et `out/main/chunks/` ne contenait plus que `CmgMSe9l` :
 * la colonne Source restait « (non résolu) ». Les piles ne sont pas non plus traduites à la
 * capture : `process.setSourceMapsEnabled` n'agit que sur les fichiers chargés APRÈS lui (doc
 * Node), et `gel-main.ts` l'appelle depuis le bundle déjà chargé — aucune des 11 887 lignes de
 * `gels.jsonl` ne porte un chemin `src/`.
 *
 * Donc on garde, à chaque construction, les cartes de CE bundle, datées par l'écriture du `.js`
 * qu'elles décrivent. Le classement prend ensuite, pour un gel, la dernière construction ÉCRITE
 * AVANT le démarrage de l'app qui a gelé : c'est le code qu'elle avait chargé.
 *
 * Disposition : `<archive>/index.jsonl` (une ligne par construction : `construitMs` + clé de frame
 * → empreinte) et `<archive>/<empreinte>.map.gz`. Une carte identique d'une construction à l'autre
 * (morceau inchangé) n'est stockée qu'une fois. Rétention bornée : ~2,7 Mo compressés par
 * construction (mesuré le 2026-10-22), 30 constructions et 30 jours au plus.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

/** Relatif à la racine du dépôt — à côté de `gels.jsonl`, dans les données de l'app (non suivies). */
export const DOSSIER_ARCHIVE_PAR_DEFAUT = '.autowin-data/autowin-os/gels-cartes'
const INDEX = 'index.jsonl'
const VERROU = 'index.lock'
const JOUR_MS = 86_400_000
/** Un verrou plus vieux appartient à une construction tuée en route : on le reprend. */
const VERROU_ORPHELIN_MS = 60_000

/**
 * UNE construction à la fois dans l'archive (revue de conv-1055) : deux builds simultanés du même
 * dépôt (serveur de dev + build, deux fils) liraient le même index, et le second effacerait des
 * cartes que le premier vient d'y inscrire. Création exclusive (`wx`), atomique entre processus.
 */
function sousVerrou(dossierArchive, action) {
  const verrou = join(dossierArchive, VERROU)
  const attente = new Int32Array(new SharedArrayBuffer(4))
  for (let essai = 0; essai < 100; essai += 1) {
    try {
      closeSync(openSync(verrou, 'wx'))
    } catch (erreur) {
      if (erreur?.code !== 'EEXIST') throw erreur
      let repris = false
      try {
        if (Date.now() - statSync(verrou).mtimeMs > VERROU_ORPHELIN_MS) {
          repris = reprendreVerrouOrphelin(verrou)
        }
      } catch {
        /* verrou rendu entre-temps : on retente */
      }
      if (!repris) Atomics.wait(attente, 0, 0, 100)
      continue
    }
    try {
      return action()
    } finally {
      rmSync(verrou, { force: true })
    }
  }
  throw new Error(`archive occupée depuis 10 s (${verrou})`)
}

/**
 * Retire un verrou ORPHELIN sans voler un verrou VIVANT (seconde revue de conv-1055). Effacer
 * directement ce qu'on a vu vieux ouvrait une course : A efface l'orphelin et pose le sien, puis B,
 * qui avait vu le même orphelin, efface celui de A — les deux construisaient sous « verrou ». Ici le
 * verrou est d'abord DÉPLACÉ sous un nom unique (un seul processus réussit ce déplacement), puis sa
 * date est relue SUR LE FICHIER DÉPLACÉ : encore vieille, c'est bien l'orphelin, on l'efface ; récente,
 * c'est le verrou que A vient de poser, on le remet sans rien écraser (`link` échoue si la place est
 * reprise). Rend `true` si un orphelin a été retiré.
 *
 * LIMITES ASSUMÉES (troisième revue de conv-1055), toutes deux sans casse : le classement retombe
 * sur `out/` et un build qui attend plus de 10 s n'archive pas, avec un avertissement. (1) Si A
 * finit pendant les microsecondes où B tient son verrou déplacé, B remet un verrou sans détenteur :
 * les builds suivants attendent qu'il vieillisse (60 s). (2) Un TROISIÈME build peut prendre la place
 * libre dans cette même fenêtre, ou `link` peut être refusé (volume FAT/exFAT, certains partages) :
 * A et un autre travaillent alors en même temps, et l'archive peut perdre une entrée. Il faut un
 * orphelin et plusieurs builds simultanés ; le dossier de données est sur NTFS.
 */
export function reprendreVerrouOrphelin(verrou, maintenantMs = Date.now()) {
  const ecarte = `${verrou}.${process.pid}.${randomBytes(4).toString('hex')}.orphelin`
  try {
    renameSync(verrou, ecarte)
  } catch {
    return false // déjà repris, ou rendu par son détenteur : la création exclusive retentera
  }
  let orphelin = true
  try {
    orphelin = maintenantMs - statSync(ecarte).mtimeMs > VERROU_ORPHELIN_MS
  } catch {
    /* illisible juste après notre propre déplacement : on le traite en orphelin */
  }
  if (!orphelin) {
    try {
      linkSync(ecarte, verrou)
    } catch {
      /* place prise par un troisième, ou lien refusé : limite (2) ci-dessus */
    }
  }
  rmSync(ecarte, { force: true })
  return orphelin
}

/**
 * Les cartes d'un `out/main` : clé = la forme des frames du journal (`main/index.js`,
 * `chunks/x.js`, cf. `fichierDuBundle`), avec l'instant d'écriture du `.js` décrit.
 */
export function cartesDuBundle(dossierMain) {
  const cartes = []
  const parcourir = (dossier, prefixe) => {
    if (!existsSync(dossier)) return
    for (const nom of readdirSync(dossier)) {
      if (!nom.endsWith('.js.map')) continue
      const js = join(dossier, nom.slice(0, -'.map'.length))
      if (!existsSync(js)) continue
      cartes.push({
        cle: `${prefixe}/${nom.slice(0, -'.map'.length)}`,
        chemin: join(dossier, nom),
        ecritMs: statSync(js).mtimeMs
      })
    }
  }
  parcourir(dossierMain, 'main')
  parcourir(join(dossierMain, 'chunks'), 'chunks')
  return cartes
}

/** Les constructions archivées, de la plus ancienne à la plus récente. Ligne illisible ignorée. */
export function lireArchive(dossierArchive) {
  const index = join(dossierArchive, INDEX)
  if (!existsSync(index)) return []
  const entrees = []
  for (const ligne of readFileSync(index, 'utf8').split(/\r?\n/)) {
    if (!ligne.trim()) continue
    try {
      const e = JSON.parse(ligne)
      if (Number.isFinite(e?.construitMs) && e.fichiers && typeof e.fichiers === 'object') {
        entrees.push(e)
      }
    } catch {
      /* une ligne tronquée par un arrêt brutal ne doit pas rendre l'archive entière illisible */
    }
  }
  return entrees.sort((a, b) => a.construitMs - b.construitMs)
}

/**
 * Archive les cartes de `dossierMain` (`out/main`). Rend ce qui a été fait, pour le journal de build.
 * `maintenantMs` et les bornes sont des paramètres : la rétention se teste sans attendre un mois.
 */
export function archiverCartes({
  dossierMain,
  dossierArchive,
  maintenantMs = Date.now(),
  garderJours = 30,
  garderMax = 30
}) {
  const cartes = cartesDuBundle(dossierMain)
  if (!cartes.length) return { cartes: 0, nouvelles: 0, supprimees: 0 }
  mkdirSync(dossierArchive, { recursive: true })
  return sousVerrou(dossierArchive, () =>
    inscrireConstruction({ cartes, dossierArchive, maintenantMs, garderJours, garderMax })
  )
}

function inscrireConstruction({ cartes, dossierArchive, maintenantMs, garderJours, garderMax }) {
  const fichiers = {}
  let nouvelles = 0
  for (const carte of cartes) {
    const contenu = readFileSync(carte.chemin)
    const empreinte = createHash('sha256').update(contenu).digest('hex').slice(0, 20)
    const cible = join(dossierArchive, `${empreinte}.map.gz`)
    if (!existsSync(cible)) {
      writeFileSync(`${cible}.${process.pid}.tmp`, gzipSync(contenu))
      renameSync(`${cible}.${process.pid}.tmp`, cible)
      nouvelles += 1
    }
    fichiers[carte.cle] = empreinte
  }
  // Datée par le `.js` le plus récent : c'est lui que le prochain démarrage chargera.
  const construitMs = Math.max(...cartes.map((c) => c.ecritMs))
  const entrees = [...lireArchive(dossierArchive), { construitMs, fichiers }]
    .sort((a, b) => a.construitMs - b.construitMs)
    .filter((e) => e.construitMs >= maintenantMs - garderJours * JOUR_MS)
    .slice(-garderMax)
  const index = join(dossierArchive, INDEX)
  writeFileSync(
    `${index}.${process.pid}.tmp`,
    entrees.map((e) => JSON.stringify(e)).join('\n') + '\n'
  )
  renameSync(`${index}.${process.pid}.tmp`, index)
  // Une carte qu'aucune construction gardée ne cite part : c'est la seule suppression, et elle ne
  // touche que les fichiers de cette archive.
  const citees = new Set(entrees.flatMap((e) => Object.values(e.fichiers)))
  let supprimees = 0
  for (const nom of readdirSync(dossierArchive)) {
    const m = /^([0-9a-f]+)\.map\.gz$/.exec(nom)
    if (m && !citees.has(m[1])) {
      rmSync(join(dossierArchive, nom), { force: true })
      supprimees += 1
    }
  }
  return { cartes: cartes.length, nouvelles, supprimees }
}

/**
 * La carte du code CHARGÉ à `chargeMs` pour la frame `cle` : celle de la dernière construction
 * écrite au plus tard à cet instant. `undefined` si l'archive ne remonte pas jusque-là.
 */
export function carteArchivee(entrees, cle, chargeMs) {
  if (!Number.isFinite(chargeMs)) return undefined
  for (let i = entrees.length - 1; i >= 0; i -= 1) {
    const e = entrees[i]
    if (e.construitMs > chargeMs) continue
    // La dernière construction AVANT le chargement est celle qui tournait : si elle ne contient
    // pas ce morceau, une construction plus ancienne qui le contiendrait décrirait un autre code.
    const empreinte = e.fichiers[cle]
    return empreinte ? { empreinte, construitMs: e.construitMs } : undefined
  }
  return undefined
}

/** Le contenu JSON d'une carte archivée. */
export function lireCarteArchivee(dossierArchive, empreinte) {
  return JSON.parse(
    gunzipSync(readFileSync(join(dossierArchive, `${empreinte}.map.gz`))).toString()
  )
}

/**
 * Le greffon de construction (cible `main` de electron.vite.config.ts). Une archive en panne ne
 * casse JAMAIS la construction : elle le DIT dans la sortie du build, et le classement retombe
 * sur les cartes de `out/` comme avant.
 */
export function pluginArchiveCartesGels({ dossierArchive, racine = process.cwd() } = {}) {
  return {
    name: 'autowin-archive-cartes-gels',
    writeBundle(options) {
      if (!options?.dir) return
      // Seul le bundle que l'app CHARGE (`package.json` → `./out/main/index.js`) est archivé : une
      // construction écrite ailleurs (`--outDir`) daterait dans l'archive un code qui n'a jamais
      // tourné, et le classement l'attribuerait au démarrage suivant.
      if (resolve(options.dir) !== resolve(racine, 'out', 'main')) {
        console.log(`[gels] cartes non archivées : sortie hors de out/main (${options.dir})`)
        return
      }
      try {
        const r = archiverCartes({
          dossierMain: options.dir,
          dossierArchive: dossierArchive ?? join(racine, DOSSIER_ARCHIVE_PAR_DEFAUT)
        })
        if (r.cartes) {
          console.log(
            `[gels] cartes de sources archivées : ${r.cartes} (${r.nouvelles} nouvelles, ${r.supprimees} retirées)`
          )
        }
      } catch (erreur) {
        this.warn(
          `[gels] archive des cartes de sources impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
        )
      }
    }
  }
}
