#!/usr/bin/env node
/**
 * INVENTAIRE ET BALAYAGE DU DISQUE POUR LE `/gc` QUOTIDIEN.
 *
 * Mesuré le 07/11/2026 sur un poste de dev : le `/gc` ne regardait que `.autowin-data`, et ne
 * voyait pas les plus gros tas laissés par le travail des agents — 14 Go d'instances cachées de
 * capture (`Audit/headless-instances`), 11 Go de brouillons des fils (`.autowin-tmp`), 22 Go dans le
 * dossier temporaire de Windows (dont 13 Go de journaux d'Outlook inactifs depuis sept semaines),
 * 7,4 Go de sessions Claude dans `claude-accounts`. Le but n'est pas une liste de catégories de plus :
 * c'est que le disque ne se remplisse plus de restes.
 *
 * DEUX PRINCIPES, pour toutes les zones :
 *  1. On pèse TOUT, zone par zone et par type (images, vidéos, scripts, textes, journaux…), et on
 *     compare à la passe d'avant (`gc-inventaire.json`) : un tas qui grossit se voit, même si aucune
 *     règle ne le connaît encore.
 *  2. Un reste n'est candidat que dans une zone de RESTES (brouillons, instances de capture, fichiers
 *     ignorés par git dans le dépôt, temporaire de Windows, vieilles sessions) et seulement s'il est
 *     CALME : aucun de ses fichiers modifié depuis le délai de sa zone. Le reste est seulement pesé.
 *
 * CE QUI NE PART JAMAIS : un lien ou une jonction (jamais suivi), une copie git (dossier qui porte
 * `.git`), un environnement Python (`pyvenv.cfg`), un `node_modules`, un cache, les dossiers construits
 * ou propres du dépôt (`dist`, `out`, `entreprise`, `brain`, `.autowin-data`…), les identités de
 * `claude-accounts` (seuls ses `projects/` sont jugés), un reste qu'on n'a pas pu peser en entier.
 *
 * `--balayer` DÉPLACE les candidats dans la corbeille de LEUR disque, `gc-corbeille/AAAA-MM-JJ/`, avec
 * une ligne de `MANIFEST.txt` écrite AVANT le déplacement. Rien n'est supprimé : la purge reste à
 * `scripts/gc-purger-corbeilles.mjs`, sur accord. Un disque sans corbeille connue : le reste y reste.
 *
 * Usage, depuis le dépôt Autowin :
 *   node --no-warnings scripts/gc-disque.mjs [--balayer] [--depot <chemin>] [--donnees <chemin>]
 *        [--sans-memoire]
 *
 * Sortie : JSON. Code 0 = passe faite, 1 = une zone n'a pas pu être pesée ou un déplacement a
 * échoué (dit dans `sondesEnEchec` et `balayage.echecs`), 2 = commande refusée.
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statfsSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const JOUR_MS = 86_400_000
const SEUIL_CROISSANCE_OCTETS = 500 * 1024 * 1024
const SEUIL_LOURD_OCTETS = 1024 * 1024 * 1024
const SEUIL_A_VERIFIER_OCTETS = 100 * 1024 * 1024
const DUREE_MAX_PAR_ZONE_MS = 180_000

/** Le type d'un fichier, pour dire au bilan CE QUI s'accumule. */
const FAMILLES = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg'],
  'video-son': ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.wav', '.mp3', '.ogg', '.m4a'],
  texte: ['.md', '.txt', '.html', '.csv', '.pdf'],
  script: ['.mjs', '.cjs', '.js', '.ts', '.mts', '.ps1', '.py', '.sh', '.bat', '.cmd', '.luau'],
  journal: ['.log', '.jsonl', '.etl'],
  'modele-3d': ['.pt', '.pth', '.onnx', '.bin', '.npy', '.safetensors', '.gguf', '.glb', '.fbx'],
  'installeur-binaire': [
    '.exe',
    '.msi',
    '.msix',
    '.zip',
    '.7z',
    '.tar',
    '.gz',
    '.dll',
    '.pyd',
    '.pyc'
  ],
  donnees: ['.json', '.db', '.sqlite', '.ldb']
}
const FAMILLE_PAR_EXTENSION = new Map(
  Object.entries(FAMILLES).flatMap(([famille, extensions]) => extensions.map((e) => [e, famille]))
)

export function familleDe(nom) {
  const extension = extname(nom).toLowerCase()
  if (!extension) return 'cache-sans-extension'
  return FAMILLE_PAR_EXTENSION.get(extension) ?? 'autre'
}

/** Dans le dépôt, ignoré par git mais jamais déplacé : construit, propre au poste, ou à un autre outil. */
const PROTEGES_DU_DEPOT = [
  '.autowin-data/',
  'node_modules/',
  'dist/',
  'out/',
  'build/',
  'entreprise/',
  'brain/',
  '.git/'
]

/** Un reste du dépôt qui ne se déplace jamais, quel que soit son âge. */
export function protegeDuDepot(relatif) {
  const rel = relatif.replaceAll('\\', '/')
  if (PROTEGES_DU_DEPOT.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) return true
  if (rel.split('/').includes('node_modules')) return true
  return /^\.env/u.test(rel) || /\.tsbuildinfo$/u.test(rel)
}

const normaliser = (chemin) => resolve(chemin).replaceAll('\\', '/').toLowerCase()
const estSous = (chemin, racine) => {
  const c = normaliser(chemin)
  const r = normaliser(racine).replace(/\/$/u, '')
  return c === r || c.startsWith(`${r}/`)
}

/**
 * Le dépôt et le dossier de données, depuis l'emplacement de ce script. Une copie de travail vit
 * DANS `.autowin-data` : c'est alors le dépôt qui la porte qu'il faut balayer, pas la copie.
 */
export function depotEtDonnees(dossierDuScript) {
  const segments = resolve(dossierDuScript).split(sep)
  const rang = segments.findIndex((s) => s.toLowerCase() === '.autowin-data')
  const depot = rang > 0 ? segments.slice(0, rang).join(sep) : resolve(dossierDuScript, '..')
  return { depot, donnees: join(depot, '.autowin-data') }
}

const lister = (dossier) => {
  try {
    return readdirSync(dossier).map((nom) => join(dossier, nom))
  } catch {
    return []
  }
}

/**
 * Les sessions Claude qu'un fil du chat reprendra : l'index `chat-sessions.json` (écrit par
 * `src/main/runs/chat-session-store.ts`). Absent : aucune. Illisible : `null`, et aucune session
 * n'est jugée — une sonde aveugle ne condamne pas.
 */
export function sessionsReprises(donnees) {
  const chemin = join(donnees, 'autowin-os', 'chat-sessions.json')
  if (!existsSync(chemin)) return new Set()
  try {
    const index = JSON.parse(readFileSync(chemin, 'utf8').replace(/^\uFEFF/u, ''))
    return new Set(
      Object.values(index ?? {})
        .map((r) => r?.sessionId)
        .filter((id) => typeof id === 'string' && id)
        .map((id) => id.toLowerCase())
    )
  } catch {
    return null
  }
}

/** Les zones du poste. `unites` dit comment découper une zone en restes ; sans `unites`, elle est seulement pesée. */
export function zonesDuPoste(ctx) {
  const comptes = join(ctx.donnees, 'autowin-os', 'claude-accounts')
  const projetsDesComptes = lister(comptes)
    .map((compte) => join(compte, 'projects'))
    .filter((projets) => existsSync(projets))
  return [
    {
      id: 'brouillons',
      libelle: 'Brouillons des fils',
      racines: [join(ctx.depot, '.autowin-tmp')],
      unites: 'enfants',
      joursCalme: 7
    },
    {
      id: 'instances-de-capture',
      libelle: 'Instances cachées de capture',
      racines: [join(ctx.depot, 'Audit', 'headless-instances')],
      unites: 'enfants',
      joursCalme: 7
    },
    {
      id: 'restes-du-depot',
      libelle: 'Fichiers ignorés par git dans le dépôt',
      racines: [ctx.depot],
      unites: 'ignores-git',
      joursCalme: 14,
      // `artifacts/` reçoit des captures chaque jour : jugé en bloc, il ne serait jamais calme.
      descendre: true
    },
    {
      id: 'temp-windows',
      libelle: 'Dossier temporaire de Windows',
      racines: [ctx.temp],
      unites: 'enfants',
      joursCalme: 30,
      exclus: ['claude'],
      // `Outlook Logging` : 13 Go de journaux de septembre, et un seul fichier récent gardait tout.
      descendre: true
    },
    {
      id: 'sessions-claude',
      libelle: 'Sessions des agents Claude',
      racines: [join(ctx.home, '.claude', 'projects'), ...projetsDesComptes],
      unites: 'petits-enfants',
      joursCalme: 30,
      // Un fil reprend sa session par `--resume <id>` : sans son fichier, le tour meurt à 0 message.
      reprises: sessionsReprises(ctx.donnees)
    },
    {
      id: 'donnees-autowin',
      libelle: "Données d'Autowin",
      // `autowin-os/` porte presque tout : pesé à part, son détail dit QUEL dossier grossit.
      racines: [ctx.donnees, join(ctx.donnees, 'autowin-os')]
    },
    { id: 'telechargements', libelle: 'Téléchargements', racines: [join(ctx.home, 'Downloads')] }
  ]
}

/**
 * Pèse un chemin sans suivre les liens ni les jonctions : taille, nombre de fichiers, plus récent
 * (mtime), poids par famille. `exclure` : racines d'autres zones, comptées chez elles.
 */
export function peser(chemin, { exclure = [], echeance = Infinity } = {}) {
  const pesee = {
    taille: 0,
    fichiers: 0,
    plusRecentMs: 0,
    familles: {},
    illisibles: 0,
    coupee: false,
    contientGit: false
  }
  const exclus = new Set(exclure.map(normaliser))
  const pile = [chemin]
  while (pile.length > 0) {
    if (Date.now() > echeance) {
      pesee.coupee = true
      break
    }
    const courant = pile.pop()
    let infos
    try {
      infos = lstatSync(courant)
    } catch {
      pesee.illisibles += 1
      continue
    }
    if (infos.isSymbolicLink()) continue
    // Une copie git, même enfouie, ne se déplace pas : git perdrait la trace de sa copie de travail.
    if (courant !== chemin && parse(courant).base === '.git') pesee.contientGit = true
    if (infos.isDirectory()) {
      if (exclus.has(normaliser(courant))) continue
      // Seule la date des FICHIERS dit l'activité : un dossier rajeunit dès qu'on y range ou retire
      // quelque chose, y compris quand le /gc lui-même en sort un reste. Dossier vide : sa propre date.
      if (courant === chemin) pesee.dateDuDossier = infos.mtimeMs
      try {
        for (const nom of readdirSync(courant)) pile.push(join(courant, nom))
      } catch {
        pesee.illisibles += 1
      }
      continue
    }
    pesee.taille += infos.size
    pesee.fichiers += 1
    pesee.plusRecentMs = Math.max(pesee.plusRecentMs, infos.mtimeMs)
    const famille = familleDe(courant)
    pesee.familles[famille] = (pesee.familles[famille] ?? 0) + infos.size
  }
  if (pesee.fichiers === 0 && pesee.dateDuDossier) pesee.plusRecentMs = pesee.dateDuDossier
  delete pesee.dateDuDossier
  pesee.complete = !pesee.coupee && pesee.illisibles === 0
  return pesee
}

/** Les entrées ignorées par git, en chemins relatifs (`dossier/` pour un dossier). `null` si git échoue. */
export function ignoresParGit(depot) {
  const sortie = spawnSync('git', ['-C', depot, 'status', '--porcelain', '--ignored', '-z'], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  })
  if (sortie.status !== 0) return null
  return sortie.stdout
    .split('\0')
    .filter((ligne) => ligne.startsWith('!! '))
    .map((ligne) => ligne.slice(3))
}

/** Pourquoi ce reste ne peut pas partir, ou `null`. */
function motifDeGarde(chemin, infos, pesee) {
  if (infos.isSymbolicLink()) return 'lien ou jonction : jamais suivi'
  if (!infos.isDirectory()) return null
  if (existsSync(join(chemin, 'pyvenv.cfg')))
    return 'environnement Python : servi sans être modifié'
  const nom = parse(chemin).base.toLowerCase()
  if (nom === 'node_modules') return 'node_modules : servi sans être modifié'
  if (/cache/u.test(nom)) return 'cache : servi sans être modifié, se retélécharge'
  if (pesee?.contientGit) return 'copie git : son tri relève de /git'
  return null
}

/** Découpe une zone en restes à juger. `null` = la sonde a échoué (git illisible). */
function unitesDe(zone, racine, ctx, autresRacines) {
  if (zone.unites === 'enfants') {
    const exclus = new Set((zone.exclus ?? []).map((n) => n.toLowerCase()))
    return lister(racine).filter((c) => !exclus.has(parse(c).base.toLowerCase()))
  }
  if (zone.unites === 'petits-enfants') return lister(racine).flatMap((projet) => lister(projet))
  if (zone.unites !== 'ignores-git') return []

  const ignores = ctx.ignoresGit(racine)
  if (ignores === null) return null
  const unites = []
  for (const relatif of ignores) {
    if (protegeDuDepot(relatif)) continue
    // git écrit `dossier/` : sans la barre retirée, le chemin du manifeste ne serait pas le bon.
    const chemin = join(racine, relatif.replace(/[\\/]+$/u, ''))
    unites.push(...horsDesAutresZones(chemin, autresRacines))
  }
  return unites
}

/**
 * Ce chemin, sans ce qui appartient à une autre zone : rien s'il y est logé (jugé là-bas), ses
 * enfants s'il en porte une (`Audit/` porte `Audit/headless-instances`), lui-même sinon.
 */
function horsDesAutresZones(chemin, autresRacines) {
  if (autresRacines.some((r) => estSous(chemin, r))) return []
  if (!autresRacines.some((r) => estSous(r, chemin))) return [chemin]
  return lister(chemin).flatMap((enfant) => horsDesAutresZones(enfant, autresRacines))
}

/** Juge un reste : candidat (calme, sans garde), gardé (avec son motif) ou vivant. */
function juger(chemin, zone, ctx, echeance) {
  let infos
  try {
    infos = lstatSync(chemin)
  } catch {
    return { rang: 'disparu' }
  }
  if (infos.isSymbolicLink())
    return { rang: 'garde', chemin, zone: zone.id, taille: 0, motif: motifDeGarde(chemin, infos) }
  const pesee = peser(chemin, { echeance })
  const garde = motifDeGarde(chemin, infos, pesee)
  const ageJours = Math.floor((ctx.maintenant - pesee.plusRecentMs) / JOUR_MS)
  const base = {
    chemin,
    zone: zone.id,
    taille: pesee.taille,
    fichiers: pesee.fichiers,
    ageJours,
    familles: pesee.familles
  }
  if (!pesee.complete)
    return { rang: 'garde', ...base, motif: 'pesée incomplète : jugé une autre fois' }
  if (garde) return { rang: 'garde', ...base, motif: garde }
  const session = parse(chemin).name.toLowerCase()
  if (zone.reprises?.has(session))
    return {
      rang: 'garde',
      ...base,
      motif: 'session reprise par un fil du chat (chat-sessions.json)'
    }
  if (ageJours < zone.joursCalme) return { rang: 'vivant', ...base, dossier: infos.isDirectory() }
  return {
    rang: 'candidat',
    ...base,
    motif: `rien de modifié depuis ${ageJours} j (seuil ${zone.joursCalme} j)`
  }
}

function lireMemoire(chemin) {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    return null
  }
}

function espaceDesDisques(chemins) {
  const vus = new Map()
  for (const chemin of chemins) {
    const disque = parse(resolve(chemin)).root.toUpperCase()
    if (vus.has(disque)) continue
    try {
      const s = statfsSync(disque)
      vus.set(disque, { disque, libre: s.bavail * s.bsize, total: s.blocks * s.bsize })
    } catch {
      // disque illisible : non rapporté
    }
  }
  return [...vus.values()]
}

/**
 * L'inventaire complet du poste. `ctx` : `{ depot, donnees, temp, home, maintenant, ignoresGit }`,
 * et en option `seuilCroissance`, `seuilLourd`, `seuilAVerifier`, `dureeMaxParZoneMs`, `memoire`.
 * Ne touche à rien, sauf la mémoire de l'inventaire (`autowin-os/gc-inventaire.json`) si `memoire`
 * n'est pas `false`.
 */
export function inventorier(ctx) {
  const zones = zonesDuPoste(ctx)
  const toutesLesRacines = zones.flatMap((z) => z.racines)
  const bilan = {
    date: new Date(ctx.maintenant).toISOString(),
    disques: espaceDesDisques([ctx.donnees, ctx.temp, ctx.home]),
    zones: [],
    candidats: [],
    aVerifier: [],
    croissance: [],
    sondesEnEchec: []
  }
  const cheminMemoire = join(ctx.donnees, 'autowin-os', 'gc-inventaire.json')
  const avant = lireMemoire(cheminMemoire)
  const memoire = { date: bilan.date, zones: {} }
  const seuilAVerifier = ctx.seuilAVerifier ?? SEUIL_A_VERIFIER_OCTETS
  const seuilLourd = ctx.seuilLourd ?? SEUIL_LOURD_OCTETS
  const retenir = (verdict) => {
    if (verdict.rang === 'candidat') bilan.candidats.push(verdict)
    else if (verdict.rang === 'garde' && verdict.taille >= seuilAVerifier)
      bilan.aVerifier.push(verdict)
  }

  for (const zone of zones) {
    const echeance = Date.now() + (ctx.dureeMaxParZoneMs ?? DUREE_MAX_PAR_ZONE_MS)
    const resume = {
      id: zone.id,
      libelle: zone.libelle,
      taille: 0,
      fichiers: 0,
      illisibles: 0,
      familles: {}
    }
    const enfants = {}
    for (const racine of zone.racines) {
      if (!existsSync(racine)) continue
      // Toute autre racine, y compris de la même zone, se pèse et se juge chez elle, une seule fois.
      const autres = toutesLesRacines.filter((r) => r !== racine)
      for (const enfant of lister(racine)) {
        if (autres.some((r) => normaliser(r) === normaliser(enfant))) continue
        const pesee = peser(enfant, { exclure: autres, echeance })
        if (pesee.coupee)
          bilan.sondesEnEchec.push({
            zone: zone.id,
            chemin: enfant,
            motif: 'pesée coupée : trop longue'
          })
        resume.taille += pesee.taille
        resume.fichiers += pesee.fichiers
        resume.illisibles += pesee.illisibles
        for (const [f, t] of Object.entries(pesee.familles))
          resume.familles[f] = (resume.familles[f] ?? 0) + t
        enfants[enfant] = pesee.taille
        // Une zone seulement pesée : ce qui y est lourd se montre, faute de règle pour le juger.
        if (!zone.unites && pesee.taille >= seuilLourd)
          bilan.aVerifier.push({
            chemin: enfant,
            zone: zone.id,
            taille: pesee.taille,
            familles: pesee.familles,
            motif: 'lourd, et aucune règle de restes ne juge cette zone'
          })
      }
      if (!zone.unites) continue
      if (zone.reprises === null) {
        bilan.sondesEnEchec.push({
          zone: zone.id,
          chemin: racine,
          motif: 'chat-sessions.json illisible : aucune session jugée'
        })
        continue
      }
      const unites = unitesDe(zone, racine, ctx, autres)
      if (unites === null) {
        bilan.sondesEnEchec.push({
          zone: zone.id,
          chemin: racine,
          motif: 'git illisible : aucun reste jugé'
        })
        continue
      }
      for (const unite of unites) {
        const verdict = juger(unite, zone, ctx, echeance)
        if (zone.descendre && verdict.rang === 'vivant' && verdict.dossier)
          for (const enfant of lister(unite)) retenir(juger(enfant, zone, ctx, echeance))
        else retenir(verdict)
      }
    }
    resume.plusGros = Object.entries(enfants)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([chemin, taille]) => ({ chemin, taille }))
    memoire.zones[zone.id] = { taille: resume.taille, enfants }
    bilan.zones.push(resume)

    // Un tas qui grossit se voit, même si aucune règle ne le connaît.
    const precedent = avant?.zones?.[zone.id]
    if (precedent) {
      const seuil = ctx.seuilCroissance ?? SEUIL_CROISSANCE_OCTETS
      for (const [chemin, taille] of Object.entries(enfants)) {
        if (normaliser(chemin) === normaliser(cheminMemoire)) continue
        const ancien = precedent.enfants?.[chemin] ?? 0
        if (taille - ancien >= seuil)
          bilan.croissance.push({
            zone: zone.id,
            chemin,
            avant: ancien,
            apres: taille,
            depuis: avant.date
          })
      }
    }
  }
  bilan.candidats.sort((a, b) => b.taille - a.taille)
  bilan.totalCandidats = bilan.candidats.reduce((s, c) => s + c.taille, 0)
  if (ctx.memoire !== false) {
    mkdirSync(dirname(cheminMemoire), { recursive: true })
    writeFileSync(cheminMemoire, JSON.stringify(memoire))
  }
  return bilan
}

/** Les corbeilles connues, une par disque : à côté des données d'Autowin, et dans LOCALAPPDATA. */
export function corbeillesConnues(ctx) {
  const racines = [join(ctx.donnees, 'gc-corbeille')]
  if (ctx.localAppData) racines.push(join(ctx.localAppData, 'autowin-gc', 'gc-corbeille'))
  return racines.map((racine) => {
    // Même déduction que `scripts/gc-purger-corbeilles.mjs` : l'accord vit à côté de la corbeille.
    const accord = join(dirname(racine), 'autowin-os', 'gc-purge-auto.json')
    // Dit AVANT la purge si elle supprimera sans demander : la passe de purge, elle, agit d'abord.
    return { racine, accord, accordDonne: accordDonne(accord) }
  })
}

/** Même lecture que `scripts/gc-purger-corbeilles.mjs` : seul `{"enabled": true}` vaut accord. */
function accordDonne(chemin) {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8').replace(/^\uFEFF/u, ''))?.enabled === true
  } catch {
    return false
  }
}

/** La corbeille du disque de ce chemin : sur le même disque, le déplacement est un simple renommage. */
export function corbeilleDuDisque(chemin, ctx) {
  const disque = parse(resolve(chemin)).root.toUpperCase()
  const corbeille = corbeillesConnues(ctx).find(
    (c) => parse(resolve(c.racine)).root.toUpperCase() === disque
  )
  return corbeille?.racine ?? null
}

const jourLocal = (ms) => {
  const d = new Date(ms)
  const deux = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

/** Déplace les candidats dans la corbeille de leur disque. Rien n'est supprimé. */
export function balayer(candidats, ctx) {
  const balayage = { deplaces: [], echecs: [], taille: 0 }
  const jour = jourLocal(ctx.maintenant)
  for (const candidat of candidats) {
    const absolu = resolve(candidat.chemin)
    const racine = corbeilleDuDisque(absolu, ctx)
    if (!racine) {
      balayage.echecs.push({
        chemin: absolu,
        motif: 'aucune corbeille sur ce disque : laissé en place'
      })
      continue
    }
    if (estSous(absolu, racine)) continue
    const dossierDuJour = join(racine, jour)
    const { root } = parse(absolu)
    const base = join(
      dossierDuJour,
      root.replace(/[:\\/]/gu, '') || 'racine',
      absolu.slice(root.length)
    )
    let cible = base
    for (let n = 2; existsSync(cible); n += 1) cible = `${base}.${n}`
    const manifeste = join(dossierDuJour, 'MANIFEST.txt')
    try {
      mkdirSync(dirname(cible), { recursive: true })
      // La ligne part AVANT le déplacement : un reste en corbeille sans sa ligne ne se restaure pas.
      appendFileSync(
        manifeste,
        `${absolu}\t${relative(dossierDuJour, cible)}\t${candidat.taille}\t${candidat.zone} : ${candidat.motif}\n`
      )
      renameSync(absolu, cible)
      balayage.deplaces.push({
        chemin: absolu,
        vers: cible,
        taille: candidat.taille,
        zone: candidat.zone
      })
      balayage.taille += candidat.taille
    } catch (erreur) {
      try {
        appendFileSync(
          manifeste,
          `# échec, resté en place : ${absolu} (${erreur?.code ?? erreur})\n`
        )
      } catch {
        // le manifeste est lui-même illisible : l'échec reste dans le bilan
      }
      balayage.echecs.push({ chemin: absolu, motif: String(erreur?.code ?? erreur) })
    }
  }
  return balayage
}

function main() {
  let options
  try {
    options = parseArgs({
      options: {
        balayer: { type: 'boolean', default: false },
        depot: { type: 'string' },
        donnees: { type: 'string' },
        'sans-memoire': { type: 'boolean', default: false }
      }
    }).values
  } catch (erreur) {
    console.error(`commande refusée : ${erreur.message}`)
    process.exit(2)
  }
  const defauts = depotEtDonnees(dirname(fileURLToPath(import.meta.url)))
  const depot = resolve(options.depot ?? defauts.depot)
  const ctx = {
    depot,
    donnees: resolve(
      options.donnees ?? (options.depot ? join(depot, '.autowin-data') : defauts.donnees)
    ),
    temp: tmpdir(),
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
    maintenant: Date.now(),
    ignoresGit: ignoresParGit,
    memoire: !options['sans-memoire']
  }
  if (!existsSync(join(ctx.donnees, 'autowin-os'))) {
    console.error(`commande refusée : dossier de données introuvable : ${ctx.donnees}`)
    process.exit(2)
  }
  const bilan = inventorier(ctx)
  bilan.corbeilles = corbeillesConnues(ctx)
  if (options.balayer) bilan.balayage = balayer(bilan.candidats, ctx)
  console.log(JSON.stringify(bilan, null, 2))
  const echec = bilan.sondesEnEchec.length > 0 || (bilan.balayage?.echecs.length ?? 0) > 0
  process.exit(echec ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
