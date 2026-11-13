/**
 * GARDE-FOU : aucun appel bloquant de plus dans le processus principal.
 *
 * POURQUOI. `execFileSync`, `execSync` et `spawnSync` tiennent le fil de l'interface jusqu'à la fin
 * du processus lancé : un `git` ou un PowerShell lent fige alors toute la fenêtre. Le journal des gels
 * (`gels.jsonl`) en a montré des dizaines, corrigés un par un, chacun avec son test `*.sans-gel.test.ts`.
 * Rien n'empêchait d'en réécrire un : le 13/11, un `git log` du Board en `execFileSync`, sans délai
 * maximal, a figé l'app 120 s d'un bloc. Le remède existe : `execFileHorsFil`
 * (`src/main/gel/execution-hors-fil.ts`), qui lance le processus hors du fil principal.
 *
 * LE CONTRÔLE EST UN CLIQUET PAR FICHIER (`appels-bloquants.plancher.json`), comme pour les couleurs :
 *  - un fichier NOUVEAU de `src/main` n'a droit à aucun appel bloquant ;
 *  - un fichier ANCIEN ne peut pas en gagner ; il peut en perdre (`--baisser` enregistre la baisse).
 * Les tests sont exemptés : ils montent de vrais dépôts git, en dehors de l'app.
 *
 * CE QUI COMPTE est lu dans l'arbre syntaxique TypeScript, pas dans le texte : toute référence à l'une
 * des trois fonctions (appel, passage en paramètre, valeur par défaut, alias d'import), hors import,
 * hors type (`typeof spawnSync`) et hors nom de propriété déclarée. Un commentaire ou une chaîne qui
 * les nomme ne compte pas : plusieurs fichiers racontent ainsi leurs anciens gels.
 *
 * Un appel qui doit VRAIMENT rester bloquant (le gestionnaire `exit` de Node n'accepte que du
 * synchrone) se déclare sur sa ligne par un commentaire `appel-bloquant-assume: <raison>`.
 *
 * DEUX POINTS DE PASSAGE, comme les couleurs : `appels-bloquants.test.mjs` tient l'arbre entier dans
 * la suite, et `.githooks/pre-commit` tient ce que le commit emporte (`--commit`).
 *
 * Usage :
 *   node scripts/appels-bloquants.mjs            arbre de travail contre le plancher
 *   node scripts/appels-bloquants.mjs --commit   ce que le commit emporte (lancé par le hook)
 *   node scripts/appels-bloquants.mjs --baisser  enregistre les baisses, ne monte jamais un plafond
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { depassements, plancherBaisse, plusHaut, total } from './cliquet-par-fichier.mjs'

/*
 * Chargé à part : un import statique introuvable ferait sortir Node en code 1, que le hook prendrait
 * pour un refus. Sans `node_modules`, le contrôle dit qu'il n'a pas pu tourner (code 2) et le commit
 * passe ; la suite, elle, le rejoue toujours.
 */
const ts = await import('typescript').then(
  (module) => module.default,
  () => null
)

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE_DEPOT = resolve(ICI, '..')
const FICHIER_PLANCHER = join(ICI, 'appels-bloquants.plancher.json')
const DOSSIER_SURVEILLE = 'src/main'

export const FONCTIONS_BLOQUANTES = ['execFileSync', 'execSync', 'spawnSync']
const NOMME_UNE_FONCTION = new RegExp(`\\b(?:${FONCTIONS_BLOQUANTES.join('|')})\\b`)

/** Fichiers de test et leurs aides : ils tournent dans vitest, jamais dans la fenêtre de l'app. */
const FICHIER_DE_TEST = /\.(?:test|spec)\.ts$|\.test-helpers\.ts$|\.harness\.ts$|\.d\.ts$/

/** Le fichier fait-il partie du processus principal à surveiller ? */
export function estSurveille(chemin) {
  return (
    chemin.startsWith(`${DOSSIER_SURVEILLE}/`) &&
    chemin.endsWith('.ts') &&
    !FICHIER_DE_TEST.test(chemin)
  )
}

/**
 * Exiger une raison : une marque nue ne dit pas pourquoi l'appel a le droit de figer la fenêtre.
 * Même règle que `couleur-fixe:` (une lettre ou un chiffre après les deux-points).
 */
const APPEL_ASSUME = /appel-bloquant-assume\s*:\s*[\p{L}\p{N}]/u

/** Les noms locaux qui désignent une fonction bloquante : les trois, plus leurs alias d'import. */
function nomsLocaux(source) {
  const noms = new Set(FONCTIONS_BLOQUANTES)
  for (const instruction of source.statements) {
    if (!ts.isImportDeclaration(instruction)) continue
    const liaisons = instruction.importClause?.namedBindings
    if (!liaisons || !ts.isNamedImports(liaisons)) continue
    for (const element of liaisons.elements)
      if (element.propertyName && FONCTIONS_BLOQUANTES.includes(element.propertyName.text))
        noms.add(element.name.text)
  }
  return noms
}

/** Le nom DÉCLARÉ d'une propriété ou d'une méthode (`spawnSync: (…) => …`) n'appelle rien. */
function estUnNomDeclare(identifiant) {
  const parent = identifiant.parent
  return (
    !!parent &&
    parent.name === identifiant &&
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent))
  )
}

/** Nombre d'appels bloquants d'un fichier TypeScript, lignes `appel-bloquant-assume:` mises à part. */
export function compter(texte, chemin = 'fichier.ts') {
  // Filtre rapide : sans l'un des trois noms, ni appel ni alias possible.
  if (!NOMME_UNE_FONCTION.test(texte)) return 0
  if (!ts) throw new Error('le module typescript est introuvable (npm install)')
  const source = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const noms = nomsLocaux(source)
  const lignes = texte.split('\n')
  let compte = 0
  const visiter = (noeud) => {
    if (ts.isImportDeclaration(noeud) || ts.isTypeNode(noeud)) return
    if (ts.isIdentifier(noeud) && noms.has(noeud.text) && !estUnNomDeclare(noeud)) {
      const { line } = source.getLineAndCharacterOfPosition(noeud.getStart(source))
      if (!APPEL_ASSUME.test(lignes[line] ?? '')) compte += 1
    }
    ts.forEachChild(noeud, visiter)
  }
  visiter(source)
  return compte
}

/** Les fichiers surveillés de l'arbre de travail, en chemins relatifs à barres obliques. */
export function fichiersSurveilles(racine = RACINE_DEPOT) {
  const trouves = []
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name)
      if (entree.isDirectory()) parcourir(chemin)
      else {
        const relatif = relative(racine, chemin).split(sep).join('/')
        if (estSurveille(relatif)) trouves.push(relatif)
      }
    }
  }
  parcourir(join(racine, DOSSIER_SURVEILLE))
  return trouves.sort()
}

/** Le compte par fichier, sans les fichiers à zéro. */
export function mesurer(racine = RACINE_DEPOT) {
  const mesure = {}
  for (const chemin of fichiersSurveilles(racine)) {
    const compte = compter(readFileSync(join(racine, chemin), 'utf8'), chemin)
    if (compte > 0) mesure[chemin] = compte
  }
  return mesure
}

export function lirePlancher() {
  return JSON.parse(readFileSync(FICHIER_PLANCHER, 'utf8'))
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

/** Ce que CE commit emporte, lu dans l'index : l'arbre partagé porte le travail d'autres fils. */
export function depassementsDuCommit() {
  const emportes = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(estSurveille)
  const mesure = {}
  for (const chemin of emportes) mesure[chemin] = compter(git(['show', `:${chemin}`]), chemin)
  return depassements(mesure, lirePlancher())
}

/** Le compte de la version commitée, pour les fichiers qui ont un plafond et qu'elle contient. */
function mesureCommitee(chemins) {
  const connus = new Set(git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0'))
  const mesure = {}
  for (const chemin of chemins.filter((c) => connus.has(c)))
    mesure[chemin] = compter(git(['show', `HEAD:${chemin}`]), chemin)
  return mesure
}

/** Le texte du refus : il dit quoi écrire à la place, pas seulement ce qui est interdit. */
export function messageDeRefus(fichiers) {
  return [
    'REFUSÉ : appel bloquant de plus dans le processus principal (execFileSync, execSync, spawnSync).',
    ...fichiers.map(
      ({ chemin, compte, plafond }) =>
        `  ${chemin} : ${compte} appel(s) bloquant(s), ${plafond} au plus`
    ),
    'Ces appels figent toute la fenêtre jusqu’à la fin du processus lancé (gels.jsonl : jusqu’à 120 s).',
    'À la place :',
    '  - execFileHorsFil (src/main/gel/execution-hors-fil.ts), avec un timeout : le processus part hors du fil principal ;',
    '  - une lecture disque quand elle suffit (src/main/git/depot-git.ts lit .git sans lancer git) ;',
    '  - un test *.sans-gel.test.ts qui prouve que la fenêtre reste libre.',
    'Appel qui doit VRAIMENT rester synchrone (gestionnaire « exit ») : commentaire',
    '« appel-bloquant-assume: <raison> » sur sa ligne.',
    'Fichier renommé : renomme aussi son entrée dans scripts/appels-bloquants.plancher.json.',
    ''
  ].join('\n')
}

// Comparaison par chemin du SYSTÈME : sous Windows, argv[1] porte des barres obliques inverses.
const lanceDirectement =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
/** Code 1 = refus, et lui seul : un contrôle qui ne peut pas tourner sort en 2 et le dit. */
function lancer() {
  if (!ts) throw new Error('le module typescript est introuvable (npm install)')
  if (process.argv.includes('--baisser')) {
    const avant = lirePlancher()
    const commite = mesureCommitee(Object.keys(avant))
    const presents = new Set([...fichiersSurveilles(), ...Object.keys(commite)])
    const apres = plancherBaisse(plusHaut(mesurer(), commite), avant, (c) => presents.has(c))
    writeFileSync(FICHIER_PLANCHER, `${JSON.stringify(apres, null, 2)}\n`)
    process.stdout.write(`Plancher : ${total(avant)} → ${total(apres)} appels bloquants.\n`)
    return 0
  }
  const fautes = process.argv.includes('--commit')
    ? depassementsDuCommit()
    : depassements(mesurer(), lirePlancher())
  if (fautes.length === 0) return 0
  process.stderr.write(messageDeRefus(fautes))
  return 1
}

if (lanceDirectement) {
  try {
    process.exitCode = lancer()
  } catch (erreur) {
    const raison = erreur instanceof Error ? erreur.message : String(erreur)
    process.stderr.write(`\n  ⚠️  Contrôle des appels bloquants non fait : ${raison}.\n\n`)
    process.exitCode = 2
  }
}
