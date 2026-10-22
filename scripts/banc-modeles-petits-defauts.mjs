#!/usr/bin/env node
/**
 * banc-modeles-petits-defauts — compare Haiku 5.5, Sonnet 5.5 et Opus 5.5 sur des PETITS défauts réels.
 *
 * Pourquoi (conv-1097, 2026-10-22) : toutes les étapes des runs tournent sur Opus 5.5 en effort xhigh
 * (`.autowin-data/autowin-os/roles.json`). La seule mesure de Haiku dans ce rôle date du 2026-09-21 et
 * portait sur Haiku 4.5. L'utilisateur a demandé l'essai payant : « peut-on mettre Haiku sur les étapes
 * simples des runs ? ». Ce banc y répond par un CODE DE SORTIE, pas par l'avis d'un juge (6 bancs
 * residus du 2026-09-06 : le juge s'inversait à configuration identique).
 *
 * Méthode (reprise de scripts/banc-orchestration-vs-nu.mjs, adaptée) :
 *  - le défaut n'est pas inventé : la copie part du PARENT d'un vrai correctif du dépôt, donc avec
 *    le défaut et sans le test qui le prouve ;
 *  - la copie est un `git archive` hors du dépôt, ré-initialisée avec UN seul commit : le modèle ne
 *    peut pas lire le correctif dans l'historique (`git log`, `git show HEAD`) — le banc existant,
 *    lui, part du commit du correctif et le laisse visible par `git diff` ;
 *  - l'oracle = le fichier de test du correctif, remis APRÈS le passage du modèle, plus les tests
 *    déjà présents à côté des fichiers qu'il a touchés (non-régression), plus le typage du
 *    processus principal ;
 *  - `node_modules` est une jonction vers celui du dépôt (une copie n'a pas de dépendances).
 *
 * Usage :
 *   node scripts/banc-modeles-petits-defauts.mjs --cycle                 # prouve rouge->vert sans modèle
 *   node scripts/banc-modeles-petits-defauts.mjs --lancer [--repliques 2] [--parallele 3] [--budget 3]
 *   node scripts/banc-modeles-petits-defauts.mjs --rejouer <defaut> <diff.patch>
 * Résultats : `.autowin-data/autowin-os/banc-modeles/<horodatage>/` + une ligne par essai dans
 * `arena-duels.jsonl` (scripts/arena-duel.mjs).
 * Exit 0 = banc joué (ou cycle prouvé) · 1 = cycle non prouvé / rejeu rouge · 2 = entrée illisible.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { noterDuel } from './arena-duel.mjs'

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Règles communes à tous les essais, mot pour mot. */
export const REGLES = `Règles :
- Travaille uniquement dans ce dossier. Ne commite pas, ne pousse pas.
- N'installe aucune dépendance : node_modules est partagé avec un autre dépôt.
- Ne modifie aucun fichier hors de src/main/.
- Vérifie de façon ciblée : \`npx vitest run <fichier de test>\` (jamais toute la suite) et
  \`npx tsc --noEmit -p tsconfig.node.json --composite false\`.
- Termine en donnant le code de sortie des tests que tu as LU.`

/**
 * Les deux défauts. Chacun est un vrai correctif d'UN fichier de code, avec un test de comportement.
 * L'énoncé donne le fichier et le symptôme observé (ce qu'une étape de run reçoit), jamais la cause.
 */
export const DEFAUTS = {
  poids: {
    libelle: 'coupe de session par poids jamais déclenchée (abe7c21e)',
    correctif: 'abe7c21e',
    oracle: ['src/main/chat-session-poids.test.ts'],
    enonce: `Défaut signalé : la coupe automatique de session « par poids » (src/main/chat-session-poids.ts,
fonction \`coupesParPoids\`) ne s'est JAMAIS déclenchée en usage réel. Un fil de chat a enchaîné six
tours sur la même session CLI avec une occupation de contexte de 260 866 puis jusqu'à 582 617 tokens
au dernier appel, alors que le seuil de coupe est 200 000. Les tests du fichier passent pourtant.
Trouve la cause, corrige-la à sa source, et couvre-la par un test qui l'aurait attrapée.`,
    // Juge « comportement » (2026-10-22, conv-1097) : le test du correctif fabrique ses tours en
    // `kind: 'chat'`, un CHOIX du correctif (garder la lecture des anciens journaux). Or la seule ligne
    // `chat` écrite par le code (chat/run-pilot-chat.ts:1591 à la base, le repli sans superviseur) ne
    // porte jamais `derniereEntree` : un correctif qui ne lit plus que `chat-usage` est juste en usage
    // réel, et le juge strict le refusait (essai poids-opus-1). On rejoue donc les MÊMES contrats sur
    // le genre de ligne qui porte réellement l'occupation.
    ajusterComportement: (t) =>
      remplacerExact(
        remplacerExact(t, "kind = 'chat')", "kind = 'chat-usage')"),
        "{ kind: 'chat' }], 200_000)).toBe(0)",
        "{ kind: 'chat-usage' }], 200_000)).toBe(0)"
      )
  },
  animation: {
    libelle: 'détecteur d’animation trompé par une simple mention (fe41a34a)',
    correctif: 'fe41a34a',
    oracle: ['src/main/gates/hooks.test.ts'],
    enonce: `Défaut signalé : le contrôle \`requireMotionProofForAnimationDiff\` (src/main/gates/hooks.ts) refuse
à tort des runs qui n'animent rien, en exigeant une preuve de mouvement. Deux lignes ajoutées l'ont
déclenché :
1. dans src/main/pipeline-discipline.ts, la phrase de consigne
   \`PREUVE DE MOUVEMENT : si ce que tu changes est ANIME (@keyframes, animation:, transition:), cette capture ne suffit PAS\` ;
2. dans src/main/gates/hooks.ts, une retouche de la ligne qui définit le motif de détection lui-même.
Une vraie déclaration d'animation (règle CSS, ou style en objet dans un fichier .ts) doit toujours
exiger la preuve. Corrige à la cause et couvre par un test.`,
    // Juge « comportement » (2026-10-22, conv-1097) : le test du correctif RELIT hooks.ts et exige que
    // la ligne qui suit `const ANIMATION_AJOUTEE` contienne `@keyframes|` — la FORME du fichier, pas le
    // comportement. Les trois modèles du premier lot ont réécrit ou commenté cette définition et ont
    // été refusés là-dessus seul (26/27 tests verts chacun). On teste à la place la ligne de définition
    // D'ORIGINE, celle que l'énoncé décrit (point 2) : même assertion de comportement, sans dépendre de
    // la façon dont le modèle a rangé son fichier.
    ajusterComportement: (t) =>
      remplacerExact(
        t,
        `const source = readFileSync(new URL('./hooks.ts', import.meta.url), 'utf8').split(/\\r?\\n/)
    const ligneDuMotif =
      source[source.findIndex((l) => l.startsWith('const ANIMATION_AJOUTEE')) + 1]`,
        // `void readFileSync` : l'import du test reste utilisé, sinon le typage (noUnusedLocals) rougit.
        'void readFileSync\n    const ligneDuMotif = String.raw`  /^\\+(?!\\+\\+).*(?:@keyframes|animation\\s*:|animation-name\\s*:|transition\\s*:)/`'
      )
  }
}

/** Remplace UNE occurrence exacte, ou lève : un juge ajusté en silence ne jugerait plus rien. */
export function remplacerExact(texte, avant, apres) {
  const n = texte.split(avant).length - 1
  if (n !== 1)
    throw new Error(
      `ajustement du juge impossible : ${n} occurrence(s) de ${JSON.stringify(avant)}`
    )
  return texte.replace(avant, () => apres)
}

/** Les trois joueurs : identifiant exact (pas d'alias, il avance avec le CLI) et lettre de bras. */
export const MODELES = [
  { id: 'claude-haiku-5-5', court: 'haiku', bras: 'a' },
  { id: 'claude-sonnet-5-5', court: 'sonnet', bras: 'b' },
  { id: 'claude-opus-5-5', court: 'opus', bras: 'c' }
]
export const EFFORT = 'xhigh' // celui des étapes de run aujourd'hui (roles.json)

export function prompt(defaut) {
  return `${DEFAUTS[defaut].enonce}\n\n${REGLES}\n`
}

/**
 * Environnement d'un essai : sans les variables de la session qui lance le banc. `CLAUDE_EFFORT`
 * écraserait `--effort` ; les `CLAUDE_CODE_*` de session font croire au CLI qu'il est un enfant ;
 * les `AUTOWIN_*` feraient écrire les tests de la copie dans les VRAIES données de l'app.
 * `CLAUDE_CONFIG_DIR` reste : c'est la connexion.
 */
export function environnementPropre(env = process.env) {
  const propre = {}
  for (const [k, v] of Object.entries(env)) {
    if (/^AUTOWIN_/i.test(k)) continue
    if (/^CLAUDE/i.test(k) && k.toUpperCase() !== 'CLAUDE_CONFIG_DIR') continue
    propre[k] = v
  }
  return propre
}

/** Tests de non-régression : le test VOISIN (x.ts -> x.test.ts) de chaque fichier de code touché. */
export function testsVoisins(touches, existe) {
  const voisins = new Set()
  for (const f of touches) {
    if (!/^src\/.*\.tsx?$/.test(f) || /\.(test|spec)\.tsx?$/.test(f)) continue
    const t = f.replace(/\.(tsx?)$/, '.test.$1')
    if (existe(t)) voisins.add(t)
  }
  return [...voisins]
}

const git = (cwd, args, opts = {}) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts
  })

const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/** Copie jetable au PARENT du correctif, un seul commit, node_modules en jonction. */
export function preparer(defaut, dossier) {
  const d = DEFAUTS[defaut]
  if (!d) throw new Error(`défaut inconnu : ${defaut}`)
  if (existsSync(dossier)) throw new Error(`refus : ${dossier} existe déjà`)
  mkdirSync(dossier, { recursive: true })
  const archive = `${dossier}.tar`
  git(DEPOT, ['archive', '--format=tar', '-o', archive, `${d.correctif}^`])
  execFileSync(process.platform === 'win32' ? TAR : 'tar', ['-xf', archive, '-C', dossier])
  rmSync(archive)
  const ident = ['-c', 'user.name=banc', '-c', 'user.email=banc@local', '-c', 'core.autocrlf=false']
  git(dossier, ['init', '-q'])
  git(dossier, [...ident, 'add', '-A'])
  git(dossier, [...ident, 'commit', '-q', '-m', 'base'])
  const nm = path.join(dossier, 'node_modules')
  if (process.platform === 'win32')
    execFileSync('cmd', ['/c', 'mklink', '/J', nm, path.join(DEPOT, 'node_modules')], {
      stdio: 'ignore'
    })
  else execFileSync('ln', ['-s', path.join(DEPOT, 'node_modules'), nm])
  return dossier
}

/**
 * Supprime une copie SANS suivre la jonction : la jonction part d'abord (`rmdir` ne retire que le
 * lien), et la suppression du reste n'a lieu que si le node_modules du dépôt est toujours là.
 */
export function nettoyer(dossier) {
  const nm = path.join(dossier, 'node_modules')
  if (existsSync(nm)) {
    if (process.platform === 'win32') execFileSync('cmd', ['/c', 'rmdir', nm], { stdio: 'ignore' })
    else rmSync(nm)
  }
  if (existsSync(nm)) throw new Error(`jonction encore présente : ${nm} — copie laissée en place`)
  if (!existsSync(path.join(DEPOT, 'node_modules', 'vitest')))
    throw new Error('node_modules du dépôt introuvable après retrait de la jonction — arrêt')
  rmSync(dossier, { recursive: true, force: true })
}

/** Le diff complet du modèle (fichiers neufs compris), à rejouer avec `git apply`. */
export function capturerDiff(dossier) {
  git(dossier, ['add', '-A'])
  const touches = git(dossier, ['diff', '--cached', '--name-only', 'HEAD'])
    .split('\n')
    .filter(Boolean)
  const diff = git(dossier, ['diff', '--cached', '--binary', 'HEAD'])
  return { touches, diff }
}

/**
 * L'oracle : test du correctif remis depuis git, tests voisins remis à leur version de base
 * (un test affaibli par le modèle ne compte pas), puis vitest et typage du processus principal.
 */
export function oracle(defaut, dossier, touches, { mode = 'strict', typage = true } = {}) {
  const d = DEFAUTS[defaut]
  for (const f of d.oracle) {
    const texte = git(DEPOT, ['show', `${d.correctif}:${f}`])
    writeFileSync(
      path.join(dossier, f),
      mode === 'comportement' ? d.ajusterComportement(texte) : texte
    )
  }
  const existe = (f) => existsSync(path.join(dossier, f))
  const voisins = testsVoisins(touches, existe).filter((t) => !d.oracle.includes(t))
  const deBase = voisins.filter((t) => touches.includes(t))
  if (deBase.length) git(dossier, ['checkout', 'HEAD', '--', ...deBase])
  const env = environnementPropre()
  const vitest = spawnSync(
    process.execPath,
    [path.join(dossier, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...d.oracle, ...voisins],
    { cwd: dossier, encoding: 'utf8', env, timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }
  )
  // `typage: false` au rejugement seulement : le typage ne dépend pas du juge, il est déjà mesuré.
  const tsc = !typage
    ? { status: null, stdout: '(typage non rejoué)', stderr: '' }
    : spawnSync(
        process.execPath,
        [
          path.join(dossier, 'node_modules', 'typescript', 'bin', 'tsc'),
          '--noEmit',
          '-p',
          'tsconfig.node.json',
          '--composite',
          'false'
        ],
        {
          cwd: dossier,
          encoding: 'utf8',
          env,
          timeout: 10 * 60 * 1000,
          maxBuffer: 64 * 1024 * 1024
        }
      )
  const queue = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-25).join('\n')
  return {
    tests: { code: vitest.status, fichiers: [...d.oracle, ...voisins], sortie: queue(vitest) },
    typage: { code: tsc.status, sortie: queue(tsc) },
    vert: vitest.status === 0 && (!typage || tsc.status === 0)
  }
}

/** Lance le CLI sur la copie. Prompt par l'entrée standard : aucune citation à échapper. */
function lancerClaude({ modele, dossier, texte, budget, sortie, timeoutMs }) {
  const exe = resoudreClaude()
  const args = [
    '-p',
    '--model',
    modele,
    '--effort',
    EFFORT,
    '--output-format',
    'json',
    '--setting-sources',
    'project',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
    '--max-budget-usd',
    String(budget)
  ]
  return new Promise((resolve) => {
    const debut = Date.now()
    const p = spawn(exe, args, { cwd: dossier, env: environnementPropre(), windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += b))
    p.stderr.on('data', (b) => (err += b))
    const minuteur = setTimeout(() => p.kill(), timeoutMs)
    p.on('close', (code) => {
      clearTimeout(minuteur)
      writeFileSync(sortie, out)
      if (err) writeFileSync(`${sortie}.err`, err)
      let json = null
      try {
        json = JSON.parse(out)
      } catch {
        /* sortie non JSON : l'essai est « casse », le code et stderr sont gardés sur disque */
      }
      resolve({ code, dureeMs: Date.now() - debut, json, stderr: err.slice(-500) })
    })
    p.stdin.end(texte)
  })
}

export function resoudreClaude() {
  const r = spawnSync('where', ['claude.cmd'], { encoding: 'utf8' })
  for (const l of String(r.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)) {
    const exe = path.join(
      path.dirname(l),
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe'
    )
    if (existsSync(exe)) return exe
  }
  return 'claude'
}

async function unEssai({ defaut, modele, replique, racineCopies, racineResultats, budget, banc }) {
  const nom = `${defaut}-${modele.court}-${replique}`
  const dossier = path.join(racineCopies, nom)
  const res = path.join(racineResultats, nom)
  mkdirSync(res, { recursive: true })
  preparer(defaut, dossier)
  const r = await lancerClaude({
    modele: modele.id,
    dossier,
    texte: prompt(defaut),
    budget,
    sortie: path.join(res, 'claude.json'),
    timeoutMs: 30 * 60 * 1000
  })
  const { touches, diff } = capturerDiff(dossier)
  writeFileSync(path.join(res, 'diff.patch'), diff)
  const o = oracle(defaut, dossier, touches)
  const j = r.json ?? {}
  const resultat = {
    defaut,
    modele: modele.id,
    replique,
    modelesServis: Object.keys(j.modelUsage ?? {}),
    codeCli: r.code,
    erreurCli: j.is_error ?? null,
    sousType: j.subtype ?? null,
    coutUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
    dureeMs: r.dureeMs,
    tours: j.num_turns ?? null,
    touches,
    horsPerimetre: touches.filter((f) => !f.startsWith('src/main/')),
    tests: { code: o.tests.code, fichiers: o.tests.fichiers },
    typage: o.typage.code,
    atteint: o.vert,
    finDuModele: String(j.result ?? '').slice(-600)
  }
  writeFileSync(path.join(res, 'resultat.json'), JSON.stringify(resultat, null, 2))
  writeFileSync(
    path.join(res, 'oracle.txt'),
    `${o.tests.sortie}\n--- typage ---\n${o.typage.sortie}\n`
  )
  try {
    noterDuel(
      {
        tache: DEFAUTS[defaut].libelle,
        workflow: `build direct · ${modele.id} · effort ${EFFORT}`,
        bras: `${modele.bras}${replique}`,
        dureeMs: r.dureeMs,
        coutUsd: resultat.coutUsd ?? 0,
        verdict: r.json ? (o.vert ? 'gagnant' : 'perdant') : 'casse',
        banc: `${banc}-${defaut}`,
        note: `tours=${resultat.tours} · touchés=${touches.join(',')}${resultat.coutUsd === null ? ' · coût illisible' : ''}`,
        critere:
          'test caché du correctif + tests voisins + typage du processus principal, tous à 0',
        atteint: o.vert ? 'oui' : 'non',
        preuve: `node scripts/banc-modeles-petits-defauts.mjs --rejouer ${defaut} ${path.join(res, 'diff.patch')}`
      },
      DEPOT
    )
  } catch (e) {
    resultat.journal = `non noté : ${e.message}`
  }
  try {
    nettoyer(dossier)
  } catch (e) {
    resultat.nettoyage = e.message
  }
  console.log(
    `${o.vert ? 'VERT ' : 'ROUGE'} ${nom} · ${resultat.coutUsd?.toFixed?.(2) ?? '?'} $ · ${Math.round(r.dureeMs / 1000)} s · tours ${resultat.tours} · tests ${o.tests.code} typage ${o.typage.code} · touchés ${touches.join(',') || '(aucun)'}`
  )
  return resultat
}

/** Avant de payer : défaut ressemé -> oracle ROUGE ; correctif remis -> oracle VERT. */
function cycle(mode = 'strict') {
  const racine = path.join(os.tmpdir(), 'banc-modeles', `cycle-${Date.now()}`)
  let ok = true
  for (const defaut of Object.keys(DEFAUTS)) {
    const d = DEFAUTS[defaut]
    const dossier = preparer(defaut, path.join(racine, defaut))
    const rouge = oracle(defaut, dossier, [], { mode })
    const code = git(DEPOT, ['show', '--name-only', '--format=', d.correctif])
      .split('\n')
      .filter((f) => f && !d.oracle.includes(f))
    for (const f of code)
      writeFileSync(path.join(dossier, f), git(DEPOT, ['show', `${d.correctif}:${f}`]))
    const vert = oracle(defaut, dossier, code, { mode })
    const bon = !rouge.vert && rouge.typage.code === 0 && vert.vert
    ok &&= bon
    console.log(
      `${bon ? 'OK  ' : 'RATE'} ${defaut} [juge ${mode}] : défaut -> tests ${rouge.tests.code} / typage ${rouge.typage.code} ; correctif -> tests ${vert.tests.code} / typage ${vert.typage.code}`
    )
    if (!bon) console.log(rouge.tests.sortie, '\n', vert.tests.sortie, '\n', vert.typage.sortie)
    nettoyer(dossier)
  }
  retirerSiVide(racine)
  return ok
}

/** Retire un dossier parent de copies s'il est VIDE — jamais récursif : une copie restante y reste. */
export function retirerSiVide(dossier) {
  try {
    if (existsSync(dossier) && readdirSync(dossier).length === 0) rmdirSync(dossier)
  } catch {
    /* dossier repris entre-temps par un autre banc : il reste, rien n'est perdu */
  }
}

async function lancer({ repliques, parallele, budget }) {
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const racineCopies = path.join(os.tmpdir(), 'banc-modeles', horodatage)
  const racineResultats = path.join(
    DEPOT,
    '.autowin-data',
    'autowin-os',
    'banc-modeles',
    horodatage
  )
  const banc = `banc-modeles-${horodatage.slice(0, 10)}`
  // Les trois modèles d'un même défaut et d'une même réplique partent ENSEMBLE : mêmes conditions.
  const file = []
  for (let n = 1; n <= repliques; n++)
    for (const defaut of Object.keys(DEFAUTS))
      for (const modele of MODELES) file.push({ defaut, modele, replique: n })
  console.log(
    `banc ${banc} : ${file.length} essais, ${parallele} à la fois, plafond ${budget} $ par essai`
  )
  console.log(`résultats : ${racineResultats}`)
  const resultats = []
  let i = 0
  const ouvrier = async () => {
    while (i < file.length) {
      const e = file[i++]
      try {
        resultats.push(await unEssai({ ...e, racineCopies, racineResultats, budget, banc }))
      } catch (err) {
        console.log(`CASSE ${e.defaut}-${e.modele.court}-${e.replique} : ${err.message}`)
        resultats.push({
          defaut: e.defaut,
          modele: e.modele.id,
          replique: e.replique,
          casse: err.message
        })
      }
    }
  }
  await Promise.all(Array.from({ length: parallele }, ouvrier))
  retirerSiVide(racineCopies)
  writeFileSync(path.join(racineResultats, 'synthese.json'), JSON.stringify(resultats, null, 2))
  console.log(`synthèse : ${path.join(racineResultats, 'synthese.json')}`)
}

/** Rejoue l'oracle sur le diff d'un essai, dans une copie neuve : la preuve d'une ligne du journal. */
function rejouer(defaut, patch, options = {}, bavard = true) {
  const dossier = preparer(
    defaut,
    path.join(
      os.tmpdir(),
      'banc-modeles',
      `rejeu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    )
  )
  try {
    if (readFileSync(patch, 'utf8').trim())
      git(dossier, ['apply', '--whitespace=nowarn', path.resolve(patch)])
    // Fichiers neufs compris : `git apply` les crée sans les indexer.
    git(dossier, ['add', '-A'])
    const touches = git(dossier, ['diff', '--cached', '--name-only', 'HEAD'])
      .split('\n')
      .filter(Boolean)
    const o = oracle(defaut, dossier, touches, options)
    if (bavard)
      console.log(
        `${o.tests.sortie}\n--- typage : ${o.typage.code}\nORACLE: ${o.vert ? 'VERT' : 'ROUGE'}`
      )
    return o
  } finally {
    nettoyer(dossier)
  }
}

/**
 * Rejuge chaque essai TERMINÉ d'un banc avec le juge « comportement » (sans retoucher son verdict
 * strict) : `rejuge.json` à côté de `resultat.json`, et un tableau des deux verdicts.
 */
function rejuger(racineResultats) {
  const lignes = []
  for (const nom of readdirSync(racineResultats).sort()) {
    const res = path.join(racineResultats, nom)
    const fResultat = path.join(res, 'resultat.json')
    if (!existsSync(fResultat)) continue
    const r = JSON.parse(readFileSync(fResultat, 'utf8'))
    const o = rejouer(
      r.defaut,
      path.join(res, 'diff.patch'),
      {
        mode: 'comportement',
        typage: false
      },
      false
    )
    const comportement = o.tests.code === 0 && r.typage === 0
    writeFileSync(
      path.join(res, 'rejuge.json'),
      JSON.stringify(
        {
          juge: 'comportement',
          tests: o.tests.code,
          typage: r.typage,
          atteint: comportement,
          sortie: o.tests.sortie
        },
        null,
        2
      )
    )
    lignes.push({ nom, strict: r.atteint, comportement })
    console.log(
      `${nom.padEnd(22)} strict ${r.atteint ? 'VERT ' : 'ROUGE'} · comportement ${comportement ? 'VERT ' : 'ROUGE'}`
    )
  }
  return lignes
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2)
  const opt = (nom, defaut) => {
    const k = args.indexOf(nom)
    return k >= 0 ? Number(args[k + 1]) : defaut
  }
  if (args[0] === '--cycle')
    process.exit(cycle(args.includes('--comportement') ? 'comportement' : 'strict') ? 0 : 1)
  else if (args[0] === '--rejuger' && args[1] && existsSync(args[1])) {
    rejuger(path.resolve(args[1]))
    process.exit(0)
  } else if (args[0] === '--lancer')
    await lancer({
      repliques: opt('--repliques', 2),
      parallele: opt('--parallele', 3),
      budget: opt('--budget', 3)
    })
  else if (args[0] === '--rejouer' && DEFAUTS[args[1]] && args[2] && existsSync(args[2]))
    process.exit(
      rejouer(args[1], args[2], {
        mode: args.includes('--comportement') ? 'comportement' : 'strict'
      }).vert
        ? 0
        : 1
    )
  else {
    console.error(
      'usage : --cycle | --lancer [--repliques N] [--parallele N] [--budget USD] | --rejouer <defaut> <diff.patch>'
    )
    process.exit(2)
  }
}
