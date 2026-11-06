#!/usr/bin/env node
/**
 * REPÉRER LES SCRIPTS INUTILISÉS DE `scripts/` POUR LE `/gc` QUOTIDIEN (conv-1657, 2026-11-06).
 *
 * Mesuré le 06/11 : sur 251 scripts (hors tests), 49 n'étaient ni appelés par l'app, npm, un hook,
 * une skill ou la doc, ni lancés une seule fois par un agent en 25 jours ; 44 autres n'avaient servi
 * qu'une ou deux fois. Personne ne les voyait : le `/gc` ne regardait que `.autowin-data`, et
 * `/residus` ne tourne qu'à la demande et ne lit que les références écrites, jamais l'usage réel.
 *
 * UN SCRIPT EST INUTILISÉ QUAND LES QUATRE CONDITIONS TIENNENT :
 *  1. NON BRANCHÉ : son nom n'apparaît dans aucune racine (`package.json`, `src/`, `tests/`, `.githooks/`,
 *     `skills/`, `AGENTS.md`, `CLAUDE.md`, `docs/`, les fichiers de la racine du dépôt, `entreprise/`,
 *     les profils et la mémoire de tête de l'app, les tâches planifiées), ni dans un autre script
 *     lui-même branché. Un test ne branche pas : il meurt avec le script qu'il teste. Une ligne de
 *     commentaire ne branche pas non plus (`sansCommentaires`) : elle est rendue dans `aussiCiteDans`.
 *  2. PEU LANCÉ : au plus `--max-lancements` sessions d'agent (2 par défaut) l'ont exécuté sur les
 *     `--jours` derniers jours (30). On ne compte que les COMMANDES lancées, jamais les lectures ni les
 *     sorties d'outils : un `find scripts` cite tous les noms et ferait tout passer pour vivant.
 *  3. PAS LANCÉ RÉCEMMENT : aucun lancement depuis `--calme-jours` jours (7). Un outil manuel servi
 *     hier n'est pas un déchet, même s'il ne sert qu'une fois par mois.
 *  4. PAS JEUNE NI EN COURS : créé (premier commit) il y a plus de `--age-min-jours` jours (14), et
 *     sans modification non commitée. Un script de la veille n'a pas encore eu le temps de servir ;
 *     un script modifié appartient peut-être au travail d'un autre fil.
 *
 * Lecture seule : il ne supprime rien. Le `/gc` rapporte la liste dans « À purger » et attend l'accord.
 *
 * Usage, depuis le dépôt Autowin :
 *   node --no-warnings scripts/gc-scripts-inutilises.mjs [--depot <chemin>] [--traces <dossier>]...
 *        [--jours 30] [--max-lancements 2] [--calme-jours 7] [--age-min-jours 14]
 * Sans `--traces` : `~/.claude/projects/<dépôt>*` (sessions des agents Claude) et
 * `.autowin-data/autowin-os/run-stdout` (sorties brutes de tous les modèles).
 *
 * Sortie : JSON. Code 0 = passe faite, 1 = une racine ou les traces sont illisibles (rien n'est alors
 * déclaré inutilisé : une sonde aveugle ne condamne pas), 2 = commande refusée.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const EXT_SCRIPT = /\.(mjs|cjs|mts|ps1|py|sh)$/
const EXT_TEXTE =
  /\.(ts|tsx|mts|mjs|cjs|js|jsx|json|md|ps1|psm1|py|sh|yml|yaml|toml|txt|cmd|bat|html)$|^pre-commit$|^pre-push$|^post-merge$|^commit-msg$/
const DOSSIERS_IGNORES = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  'out',
  'dist',
  'release',
  'fixtures',
  '__fixtures__',
  '.autowin-data',
  '.autowin-tmp',
  // Une archive CITE sans appeler : mesuré le 06/11, les rapports `/residus` des 05 et 06/09
  // (`entreprise/<nom>/archives/docs/`) listaient 36 scripts comme morts, et les faisaient passer
  // pour branchés.
  'archives'
])
const JOUR = 86_400_000

function lister(dossier, garder, acc = []) {
  let entrees
  try {
    entrees = readdirSync(dossier, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entrees) {
    if (DOSSIERS_IGNORES.has(e.name)) continue
    const p = join(dossier, e.name)
    if (e.isDirectory()) lister(p, garder, acc)
    else if (e.isFile() && garder(e.name)) acc.push(p)
  }
  return acc
}

const versSlash = (p) => p.split(sep).join('/')
const estTest = (nom) => /\.test\.|\.selftest\.|_test\.py$|^test_.*\.py$/.test(nom)

/** Les fichiers dont le CONTENU branche un script : tout ce qui n'est pas `scripts/`. */
export function racinesDuDepot(depot, donneesApp) {
  const fichiers = []
  const texte = (nom) => EXT_TEXTE.test(nom)
  // `tests/` : `tests/smoke-p0.ps1` lance `scripts/live-claude.mjs`, que rien d'autre n'appelle.
  for (const d of ['src', 'skills', 'docs', 'entreprise', 'tests'])
    fichiers.push(...lister(join(depot, d), texte))
  fichiers.push(...lister(join(depot, '.githooks'), () => true))
  for (const nom of readdirSync(depot)) {
    const p = join(depot, nom)
    if (nom === 'package-lock.json' || !statSync(p).isFile()) continue
    if (texte(nom) || nom === 'AGENTS.md' || nom === 'CLAUDE.md') fichiers.push(p)
  }
  if (donneesApp) {
    fichiers.push(...lister(join(donneesApp, 'profils'), (n) => n.endsWith('.md')))
    for (const nom of ['memoire-de-tete.md', 'scheduled-tasks.json']) {
      const p = join(donneesApp, nom)
      if (existsSync(p)) fichiers.push(p)
    }
  }
  return fichiers
}

const COMMENTAIRE_JS = /\.(ts|tsx|mts|mjs|cjs|js|jsx)$/
const COMMENTAIRE_DIESE =
  /\.(py|sh|ps1|psm1|yml|yaml|toml)$|^pre-commit$|^pre-push$|^post-merge$|^commit-msg$/

/**
 * Le texte d'un fichier de code sans ses lignes de commentaire : une mention (`// fix-ok: mesuré par
 * scripts/x.mjs`) ne branche pas. Mesuré le 06/11 : trois commentaires de `src/renderer/` gardaient
 * en vie `scripts/derogations-lint.mjs`, que plus rien n'appelait.
 * Seules les lignes qui COMMENCENT par un commentaire, et les blocs ouverts en début de ligne, sont
 * retirées. Un `//` plus loin dans la ligne peut être dans une chaîne (`'https://…'`) : le couper
 * ferait passer un appel pour une mention, donc un script vivant pour mort. Une fin de ligne
 * commentée reste donc comptée comme un appel ; cette erreur-là garde un script, elle n'en supprime
 * aucun. Markdown, JSON et texte restent entiers : dans une skill, la mention EST la consigne.
 */
export function sansCommentaires(nom, texte) {
  const js = COMMENTAIRE_JS.test(nom)
  if (!js && !COMMENTAIRE_DIESE.test(nom)) return texte
  const ps = /\.psm?1$/.test(nom)
  const [ouvre, ferme, ligneSeule] = js
    ? ['/*', '*/', '//']
    : ps
      ? ['<#', '#>', '#']
      : [null, null, '#']
  const gardees = []
  let dansBloc = false
  for (const ligne of texte.split('\n')) {
    let reste = ligne
    if (dansBloc) {
      const fin = reste.indexOf(ferme)
      if (fin === -1) continue
      dansBloc = false
      reste = reste.slice(fin + ferme.length)
    } else {
      const debut = reste.trimStart()
      if (ouvre && debut.startsWith(ouvre)) {
        const fin = debut.indexOf(ferme, ouvre.length)
        if (fin === -1) {
          dansBloc = true
          continue
        }
        reste = debut.slice(fin + ferme.length)
      } else if (debut.startsWith(ligneSeule)) continue
    }
    gardees.push(reste)
  }
  return gardees.join('\n')
}

/** Le nom cité seul, ou par son chemin `scripts/…` ; jamais comme morceau d'un nom plus long. */
function cite(texte, nom) {
  let i = texte.indexOf(nom)
  while (i !== -1) {
    const avant = i === 0 ? '' : texte[i - 1]
    const apres = texte[i + nom.length] ?? ''
    if (!/[\w.-]/.test(avant) && !/[\w-]/.test(apres)) return true
    i = texte.indexOf(nom, i + 1)
  }
  return false
}

/**
 * Le nom qui BRANCHE un fichier. Un `x.d.mts` décrit les types de `x.mjs` : il vit et meurt avec lui.
 * Un script Python s'importe par son nom sans extension (`from pose import …`).
 */
function nomsCites(fichier) {
  const nom = basename(fichier)
  const noms = [nom]
  // Le nom nu (`pose`) apparaît partout en français : seul l'import compte.
  if (/\.py$/.test(nom)) {
    const module = nom.replace(/\.py$/, '')
    noms.push(`import ${module}`, `from ${module} import`)
  }
  if (/\.(mjs|cjs|mts)$/.test(nom)) noms.push('./' + nom.replace(/\.(mjs|cjs|mts)$/, ''))
  return noms
}

/** Les sessions qui ont LANCÉ chaque script : seules les chaînes `command`/`cmd` comptent. */
export function lancementsDansLesTraces(dossiersTraces, nomsScripts, depuisMs) {
  const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const motif = new RegExp(
    'scripts[\\\\/]+(?:[\\w.-]+[\\\\/]+)*(' +
      [...nomsScripts]
        .sort((a, b) => b.length - a.length)
        .map(echappe)
        .join('|') +
      ')(?![\\w.-])',
    'g'
  )
  /** @type {Map<string, {sessions: number, dernier: number}>} */
  const vus = new Map()
  let sessions = 0
  const commandes = (o, acc) => {
    if (!o || typeof o !== 'object') return acc
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'command' || k === 'cmd') && typeof v === 'string') acc.push(v)
      else if ((k === 'command' || k === 'cmd') && Array.isArray(v)) acc.push(v.join(' '))
      else if (v && typeof v === 'object') commandes(v, acc)
    }
    return acc
  }
  for (const dossier of dossiersTraces) {
    for (const f of lister(dossier, (n) => n.endsWith('.jsonl'))) {
      const st = statSync(f)
      if (st.mtimeMs < depuisMs) continue
      sessions++
      const lances = new Set()
      for (const ligne of readFileSync(f, 'utf8').split('\n')) {
        if (!ligne.includes('"command"') && !ligne.includes('"cmd"')) continue
        let o
        try {
          o = JSON.parse(ligne)
        } catch {
          continue
        }
        // Une sortie d'outil répète la commande et son résultat : seul l'appel compte.
        if (o?.type === 'user' || o?.toolUseResult) continue
        for (const c of commandes(o, [])) for (const m of c.matchAll(motif)) lances.add(m[1])
      }
      for (const nom of lances) {
        const v = vus.get(nom) ?? { sessions: 0, dernier: 0 }
        v.sessions++
        v.dernier = Math.max(v.dernier, st.mtimeMs)
        vus.set(nom, v)
      }
    }
  }
  return { vus, sessions }
}

/** Date du premier commit et état non commité de chaque fichier, en deux appels git. */
export function infosGit(depot) {
  const creation = new Map()
  const log = spawnSync(
    'git',
    // `--no-renames` : un fichier renommé naît à son nouveau nom, sinon il n'aurait pas de date.
    [
      '-c',
      'core.quotePath=false',
      'log',
      '--no-renames',
      '--diff-filter=A',
      '--name-only',
      '--format=@%at',
      '--',
      'scripts'
    ],
    { cwd: depot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (log.status !== 0) throw new Error('git log illisible : ' + (log.stderr || '').trim())
  let date = 0
  for (const ligne of log.stdout.split('\n')) {
    if (ligne.startsWith('@')) date = Number(ligne.slice(1)) * 1000
    // Le journal va du plus récent au plus ancien : la dernière date vue est la création.
    else if (ligne.trim()) creation.set(ligne.trim(), date)
  }
  const st = spawnSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'scripts'
    ],
    {
      cwd: depot,
      encoding: 'utf8'
    }
  )
  if (st.status !== 0) throw new Error('git status illisible : ' + (st.stderr || '').trim())
  const modifies = new Set(
    st.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop())
  )
  return { creation, modifies }
}

export function analyser({
  depot,
  dossiersTraces,
  donneesApp,
  maintenant = Date.now(),
  jours = 30,
  maxLancements = 2,
  calmeJours = 7,
  ageMinJours = 14,
  git = infosGit
}) {
  const tous = lister(join(depot, 'scripts'), (n) => EXT_SCRIPT.test(n))
  const relatif = (f) => versSlash(relative(depot, f))
  const scripts = tous.filter((f) => !estTest(basename(f)))
  const tests = tous.filter((f) => estTest(basename(f)))

  // 1. Branchés : par une racine, puis de proche en proche par un script déjà branché.
  // Le branchement se lit sans les commentaires ; `racines` garde le texte entier pour signaler
  // ensuite les mentions à retirer avec le script.
  const racines = racinesDuDepot(depot, donneesApp).map((f) => [f, readFileSync(f, 'utf8')])
  const contenus = racines.map(([f, t]) => sansCommentaires(basename(f), t))
  const textes = new Map(
    tous.map((f) => [f, sansCommentaires(basename(f), readFileSync(f, 'utf8'))])
  )
  const citePar = (f, texte) => nomsCites(f).some((n) => cite(texte, n))
  const branches = new Set(scripts.filter((f) => contenus.some((t) => citePar(f, t))))
  // Un TEST VIVANT garde en vie ce qu'il utilise. Vivant = lancé par une commande npm, ou qui teste
  // un script vivant. Mesuré le 06/11 : `launch_dev_phases_test.py` (lancé par `package.json`, il
  // teste `launch_dev_phases.py`) exécute `mutex_wait_scenario.py`, que rien d'autre ne cite.
  // `vitest.config.ts` ne compte pas : il ne fait qu'inclure ou exclure.
  const paquet = racines.find(([f]) => basename(f) === 'package.json')?.[1] ?? ''
  const testsVivants = new Set(tests.filter((t) => citePar(t, paquet)))
  for (let change = true; change;) {
    change = false
    for (const t of tests) {
      if (testsVivants.has(t)) continue
      if ([...branches].some((b) => citePar(b, textes.get(t)))) {
        testsVivants.add(t)
        change = true
      }
    }
    for (const f of scripts) {
      if (branches.has(f)) continue
      for (const b of [...branches, ...testsVivants]) {
        if (citePar(f, textes.get(b))) {
          branches.add(f)
          change = true
          break
        }
      }
    }
  }
  // Un `.d.mts` suit son module.
  for (const f of scripts) {
    if (!f.endsWith('.d.mts')) continue
    const module = f.replace(/\.d\.mts$/, '.mjs')
    if (branches.has(module)) branches.add(f)
  }

  // 2-3. Lancements réels.
  const nonBranches = scripts.filter((f) => !branches.has(f))
  const { vus, sessions } = lancementsDansLesTraces(
    dossiersTraces,
    new Set(nonBranches.map((f) => basename(f))),
    maintenant - jours * JOUR
  )
  if (sessions === 0) throw new Error('aucune trace de session lue : impossible de juger l’usage')

  // 4. Jeunes ou en cours.
  const { creation, modifies } = git(depot)
  const inutilises = []
  const gardes = []
  for (const f of nonBranches) {
    const chemin = relatif(f)
    const l = vus.get(basename(f)) ?? { sessions: 0, dernier: 0 }
    const cree = creation.get(chemin) ?? 0
    const motifGarde =
      modifies.has(chemin) || !creation.has(chemin)
        ? 'modifié ou jamais commité'
        : maintenant - cree < ageMinJours * JOUR
          ? `créé il y a moins de ${ageMinJours} jours`
          : l.sessions > maxLancements
            ? `lancé dans ${l.sessions} sessions`
            : l.dernier && maintenant - l.dernier < calmeJours * JOUR
              ? `lancé il y a moins de ${calmeJours} jours`
              : null
    // Par le nom complet ou l'import (`./x`), jamais le mot nu : `rendu.cjs` liait au 06/11 tout
    // test qui écrivait « rendu » en français.
    const sesTests = tests.filter((t) => citePar(f, textes.get(t)))
    const ligne = {
      chemin,
      lancements: l.sessions,
      dernierLancement: l.dernier ? new Date(l.dernier).toISOString().slice(0, 10) : null,
      creeLe: cree ? new Date(cree).toISOString().slice(0, 10) : null,
      tests: sesTests.map(relatif),
      // Ce qui citera encore un fichier disparu (une exclusion de `vitest.config.ts`, un commentaire
      // qui le nomme) : à retirer avec lui, sinon le dépôt nomme un fichier qui n'existe plus.
      aussiCiteDans: racines
        .filter(([r, t]) => r !== f && (citePar(f, t) || sesTests.some((s) => citePar(s, t))))
        .map(([r]) => relatif(r)),
      _tests: sesTests
    }
    if (motifGarde) gardes.push({ ...ligne, motif: motifGarde })
    else inutilises.push(ligne)
  }
  // Un script gardé garde ce qu'il appelle, et un test qui sert AUSSI un script gardé garde le script
  // qu'il utilise : supprimer l'un casserait l'autre. Mesuré le 06/11 : `cdp-accueil-3d-proof.mjs`,
  // gardé (lancé dans 3 sessions), exécute `mesure-pixels-allumes.py`, que seul un commentaire
  // gardait jusque-là. De proche en proche : un script gardé ainsi garde à son tour ce qu'il appelle.
  const texteDe = (chemin) => textes.get(join(depot, chemin)) ?? ''
  for (let change = true; change;) {
    change = false
    for (const i of [...inutilises]) {
      const appelant = gardes.find(
        (g) => g.chemin !== i.chemin && citePar(join(depot, i.chemin), texteDe(g.chemin))
      )
      const partage = appelant
        ? null
        : i._tests.find((t) =>
            gardes.some(
              (g) => g.chemin !== i.chemin && citePar(join(depot, g.chemin), textes.get(t))
            )
          )
      if (!appelant && !partage) continue
      inutilises.splice(inutilises.indexOf(i), 1)
      gardes.push({
        ...i,
        motif: appelant
          ? `appelé par ${appelant.chemin}, gardé`
          : `utilisé par ${relatif(partage)}, test d'un script gardé`
      })
      change = true
    }
  }
  for (const x of [...inutilises, ...gardes]) delete x._tests

  return {
    regle: { jours, maxLancements, calmeJours, ageMinJours },
    scripts: scripts.length,
    branches: branches.size,
    sessionsLues: sessions,
    inutilises: inutilises.sort((a, b) => a.chemin.localeCompare(b.chemin)),
    gardes: gardes.sort((a, b) => a.chemin.localeCompare(b.chemin))
  }
}

function principal() {
  let options
  try {
    options = parseArgs({
      options: {
        depot: { type: 'string', default: process.cwd() },
        traces: { type: 'string', multiple: true },
        jours: { type: 'string', default: '30' },
        'max-lancements': { type: 'string', default: '2' },
        'calme-jours': { type: 'string', default: '7' },
        'age-min-jours': { type: 'string', default: '14' }
      }
    }).values
  } catch (e) {
    console.error(String(e.message ?? e))
    process.exit(2)
  }
  const depot = resolve(options.depot)
  const donneesApp = join(depot, '.autowin-data', 'autowin-os')
  let dossiersTraces = options.traces
  if (!dossiersTraces?.length) {
    // Même nom que Claude Code donne au dossier de projet : tout caractère hors [A-Za-z0-9] → « - ».
    const slug = depot.replace(/[^A-Za-z0-9]/g, '-')
    const projets = join(homedir(), '.claude', 'projects')
    dossiersTraces = existsSync(projets)
      ? readdirSync(projets)
          .filter((n) => n.toLowerCase().startsWith(slug.toLowerCase()))
          .map((n) => join(projets, n))
      : []
    dossiersTraces.push(join(donneesApp, 'run-stdout'))
  }
  const nombre = (k) => {
    const n = Number(options[k])
    if (!Number.isFinite(n) || n < 0) {
      console.error(`--${k} attend un nombre positif`)
      process.exit(2)
    }
    return n
  }
  try {
    const bilan = analyser({
      depot,
      dossiersTraces,
      donneesApp,
      jours: nombre('jours'),
      maxLancements: nombre('max-lancements'),
      calmeJours: nombre('calme-jours'),
      ageMinJours: nombre('age-min-jours')
    })
    console.log(JSON.stringify(bilan, null, 1))
  } catch (e) {
    console.log(JSON.stringify({ erreur: String(e.message ?? e), inutilises: [] }))
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) principal()
