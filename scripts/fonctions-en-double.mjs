#!/usr/bin/env node
/**
 * FONCTIONS COPIÉES À L'IDENTIQUE dans plusieurs fichiers du code.
 *
 * Une fonction recopiée d'un fichier à l'autre diverge tôt ou tard : un défaut corrigé dans une
 * copie reste dans les autres. Ce script les retrouve en lisant le code avec l'analyseur de
 * TypeScript, donc sans se fier à la mise en forme : deux fonctions sont « la même » quand leur NOM
 * et leur CORPS sont identiques une fois les commentaires et les blancs retirés. Les types écrits
 * comptent (`(v: unknown)` et `(v: any)` restent deux fonctions).
 *
 * Ce qu'il lit : les fonctions de premier niveau d'un fichier, `function f() {}` et
 * `const f = (…) => …` / `const f = function () {}`, exportées ou non. Les tests sont ignorés.
 *
 * Usage :
 *   node scripts/fonctions-en-double.mjs [dossiers…]          tableau lisible (défaut : src)
 *   node scripts/fonctions-en-double.mjs --json [dossiers…]   la même chose en JSON
 *   node scripts/fonctions-en-double.mjs --nom isRecord        une seule fonction
 *   --min-copies N   ne garde que les groupes d'au moins N copies (défaut 2)
 *   --echouer        code de sortie 1 s'il reste au moins un groupe (preuve « plus aucune copie »)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/u
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/u
const DOSSIERS_IGNORES = new Set(['node_modules', 'out', 'dist', '.git', '__corpus__'])

/** Les fichiers TypeScript (hors tests) sous `racine`. */
export function fichiersSources(racine) {
  const trouves = []
  const parcourir = (dossier) => {
    let entrees
    try {
      entrees = readdirSync(dossier, { withFileTypes: true })
    } catch {
      return
    }
    for (const entree of entrees) {
      const chemin = join(dossier, entree.name)
      if (entree.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(entree.name) && !entree.name.startsWith('.')) parcourir(chemin)
      } else if (EXTENSIONS.test(entree.name) && !TEST.test(entree.name)) trouves.push(chemin)
    }
  }
  parcourir(racine)
  return trouves.sort()
}

/** Le texte de `debut` à `fin` sans commentaires ni blancs : la clé de comparaison. */
function empreinte(source, debut, fin) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, source.languageVariant)
  scanner.setText(source.text, debut, fin - debut)
  const jetons = []
  for (let jeton = scanner.scan(); jeton !== ts.SyntaxKind.EndOfFileToken; jeton = scanner.scan()) {
    jetons.push(scanner.getTokenText())
  }
  return jetons.join(' ')
}

const estAsync = (noeud) =>
  (ts.getModifiers?.(noeud) ?? noeud.modifiers ?? []).some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword
  )

/** Les fonctions de premier niveau d'un texte source : `{ nom, ligne, empreinte }`. */
export function fonctionsDuTexte(texte, nomDeFichier = 'fichier.ts') {
  const source = ts.createSourceFile(
    nomDeFichier,
    texte,
    ts.ScriptTarget.Latest,
    true,
    nomDeFichier.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const ligneDe = (noeud) => source.getLineAndCharacterOfPosition(noeud.getStart(source)).line + 1
  const trouvees = []
  for (const instruction of source.statements) {
    if (ts.isFunctionDeclaration(instruction) && instruction.name && instruction.body) {
      // Du `*` ou du nom jusqu'à la fin, sans `export` : une copie exportée reste une copie.
      const debut = (instruction.asteriskToken ?? instruction.name).getStart(source)
      const cle = `${estAsync(instruction) ? 'async ' : ''}${empreinte(source, debut, instruction.getEnd())}`
      trouvees.push({ nom: instruction.name.text, ligne: ligneDe(instruction), empreinte: cle })
    } else if (ts.isVariableStatement(instruction)) {
      for (const declaration of instruction.declarationList.declarations) {
        const init = declaration.initializer
        if (!ts.isIdentifier(declaration.name) || !init) continue
        if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue
        trouvees.push({
          nom: declaration.name.text,
          ligne: ligneDe(declaration),
          empreinte: empreinte(source, declaration.name.getEnd(), init.getEnd())
        })
      }
    }
  }
  return trouvees
}

/**
 * Les groupes de copies : même nom ET même empreinte dans au moins `minCopies` fichiers différents,
 * du plus copié au moins copié.
 */
export function groupesDeCopies(fichiers, { racine = process.cwd(), nom, minCopies = 2 } = {}) {
  const groupes = new Map()
  for (const fichier of fichiers) {
    let texte
    try {
      texte = readFileSync(fichier, 'utf8')
    } catch {
      continue
    }
    for (const fonction of fonctionsDuTexte(texte, fichier)) {
      if (nom && fonction.nom !== nom) continue
      const cle = `${fonction.nom}\u0000${fonction.empreinte}`
      const groupe = groupes.get(cle) ?? { nom: fonction.nom, copies: [] }
      groupe.copies.push({
        fichier: relative(racine, fichier).split(sep).join('/'),
        ligne: fonction.ligne
      })
      groupes.set(cle, groupe)
    }
  }
  return [...groupes.values()]
    .filter((g) => new Set(g.copies.map((c) => c.fichier)).size >= minCopies)
    .sort((a, b) => b.copies.length - a.copies.length || a.nom.localeCompare(b.nom))
}

function lireOptions(argv) {
  const options = { json: false, echouer: false, nom: undefined, minCopies: 2, dossiers: [] }
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    if (argument === '--json') options.json = true
    else if (argument === '--echouer') options.echouer = true
    else if (argument === '--nom') options.nom = argv[++i]
    else if (argument === '--min-copies') options.minCopies = Math.max(2, Number(argv[++i]) || 2)
    else options.dossiers.push(argument)
  }
  if (options.dossiers.length === 0) options.dossiers.push('src')
  return options
}

function principal() {
  const options = lireOptions(process.argv.slice(2))
  const racine = process.cwd()
  const fichiers = options.dossiers.flatMap((dossier) => fichiersSources(resolve(racine, dossier)))
  const groupes = groupesDeCopies(fichiers, {
    racine,
    nom: options.nom,
    minCopies: options.minCopies
  })
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ fichiersLus: fichiers.length, groupes }, null, 2)}\n`)
  } else if (groupes.length === 0) {
    process.stdout.write(
      `Aucune fonction copiée à l'identique (${fichiers.length} fichiers lus).\n`
    )
  } else {
    const lignes = [
      `${groupes.length} fonction(s) copiée(s) à l'identique (${fichiers.length} fichiers lus) :`
    ]
    for (const groupe of groupes) {
      lignes.push(`- ${groupe.nom} : ${groupe.copies.length} copies`)
      for (const copie of groupe.copies) lignes.push(`    ${copie.fichier}:${copie.ligne}`)
    }
    process.stdout.write(`${lignes.join('\n')}\n`)
  }
  if (options.echouer && groupes.length > 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
