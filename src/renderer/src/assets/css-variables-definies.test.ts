import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, posix, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GARDE : aucune couleur ne doit dependre d'une variable CSS QUI N'EXISTE PAS.
 *
 * Pourquoi ce test existe. Mesure du 2026-09-03 dans cette conversation : le bandeau « REPONSE »
 * de l'Observatoire etait illisible en mode clair parce que sa regle appelait `var(--text-muted)`,
 * un nom JAMAIS defini nulle part. Meme classe de panne, deux jours plus tot, avec `var(--surface2)`.
 * Le comportement de CSS ici est PIRE qu'une erreur : `var(--absente)` sans valeur de secours rend la
 * propriete INVALIDE A LA CALCULATION — la declaration ne tombe pas en arriere sur la cascade, elle
 * devient `unset`. Donc `color: var(--text-muted)` sur un texte ne donne pas la couleur heritee du
 * parent : elle donne le NOIR par defaut du navigateur, ou la couleur heritee si la propriete est
 * heritable — dans les deux cas une couleur que personne n'a choisie. Aucun `tsc`, aucun lint, aucune
 * capture d'ecran ne le signale : il faut lire chaque `var()` et chercher son `--nom:`.
 *
 * Ce que le test accepte, et pourquoi :
 * - `var(--x, valeur)` avec valeur de secours est TOLERE meme si `--x` n'existe pas : la propriete
 *   reste valide et rend la valeur de secours. C'est un usage legitime (surcharge optionnelle).
 * - une variable definie N'IMPORTE OU dans les sources scannees compte comme definie : le theme, une
 *   feuille de composant, un `style.setProperty('--x', …)`, ou une CLE D'OBJET de style React
 *   (`style={{ '--causal-depth': node.depth }}`). Ce dernier cas est la facon normale de passer une
 *   valeur calculee au CSS : `--causal-depth`, `--execution-depth`, `--quota-angle` et
 *   `--theme-color` vivent uniquement la, et ce ne sont PAS des defauts.
 * - `var(--x)` ecrit DANS la valeur de secours d'un autre `var()` est analyse aussi (imbrication).
 *
 * LIMITE ASSUMEE, et verifiee plutot que supposee : l'analyse de la valeur de secours se fait LIGNE
 * par ligne, donc un `var(` coupe sur deux lignes serait mal lu. Recherche faite au moment de
 * l'ecriture — aucun `var($` ni `var(--nom,$` dans les 53 feuilles du depot (Prettier ne coupe pas
 * la). Si un jour la garde signale un nom qui porte bien une valeur de secours sur la ligne
 * SUIVANTE, c'est ici qu'il faut passer a une lecture du fichier entier, pas ajouter une exception.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : ajouter `color: var(--couleur-inexistante)` dans n'importe
 * quelle feuille du perimetre. Si ce test reste vert apres cet ajout, c'est le TEST qui est faux, pas
 * le code — cette entree est verifiee par le cas « detecte une variable inventee » ci-dessous.
 */

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')

/** Dossiers de donnees, de build et de copies d'agents : ce n'est pas la source du produit. */
const IGNORES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  '.autowin-data',
  'Audit',
  'artifacts',
  'sketches'
])

const EXTENSIONS = /\.(css|ts|tsx|mts|mjs|js|html)$/

/**
 * Les fichiers de TEST sont hors perimetre : ils ne stylent rien. Ils citent en revanche des noms de
 * variables dans leur prose et dans leurs decors (ce fichier-ci le fait juste au-dessus), ce qui
 * produirait de faux defauts. Mesure : sans cette exclusion, le scan remontait `--surface2`,
 * `--absente` et `--nom-jamais-defini` — trois noms qui n'existent que dans des commentaires.
 */
const EST_UN_TEST = /\.(test|spec)\.(ts|tsx|mts|mjs|js)$/

function fichiersSources(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (IGNORES.has(entree.name)) continue
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) fichiersSources(chemin, acc)
    else if (EXTENSIONS.test(entree.name) && !EST_UN_TEST.test(entree.name)) acc.push(chemin)
  }
  return acc
}

type Usage = { fichier: string; ligne: number; avecSecours: boolean }

/**
 * Decoupe un `var(` a partir de sa position et dit s'il porte une valeur de secours.
 * Un `indexOf(',')` naif se tromperait sur `var(--a, rgba(0,0,0,.3))` — il faut compter les
 * parentheses pour ne voir que la virgule du NIVEAU de ce `var()`.
 */
function aUneValeurDeSecours(texte: string, positionApresNom: number): boolean {
  let profondeur = 0
  for (let i = positionApresNom; i < texte.length; i += 1) {
    const c = texte[i]
    if (c === '(') profondeur += 1
    else if (c === ')') {
      if (profondeur === 0) return false
      profondeur -= 1
    } else if (c === ',' && profondeur === 0) return true
  }
  return false
}

export function analyseVariablesCss(fichiers: string[]): {
  definies: Set<string>
  usages: Map<string, Usage[]>
} {
  const definies = new Set<string>()
  const usages = new Map<string, Usage[]>()

  for (const fichier of fichiers) {
    const texte = readFileSync(fichier, 'utf8')
    const relatif = relative(RACINE, fichier).split(sep).join(posix.sep)

    // Declaration CSS : `--nom: valeur`.
    for (const m of texte.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) definies.add(m[1])
    // Pose imperative depuis le code : `element.style.setProperty('--nom', …)`.
    for (const m of texte.matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)['"`]/g))
      definies.add(m[1])
    // Cle d'un objet de style React : `style={{ '--nom': valeur }}`. Le guillemet empeche la
    // premiere expression de la voir (`--nom'` puis `:`), d'ou ce motif dedie.
    //
    // Une premiere version tolerait un crochet LARGE (`['--nom'] :`) et acceptait du coup des
    // TERNAIRES d'arguments de ligne de commande — `(force ? ['--force'] : [])` dans
    // worktree-manager.ts:4376 faisait passer `--force` et `--no-index` pour des variables
    // definies. C'est le sens d'erreur GRAVE : une variable fantome qui porte le nom d'un drapeau
    // devient invisible, donc un defaut MANQUE.
    for (const m of texte.matchAll(/['"`](--[A-Za-z0-9_-]+)['"`]\s*:/g)) definies.add(m[1])

    // Mais le depot utilise BEL ET BIEN des cles de style calculees entre crochets — mesure par
    // recherche : `Spinner.tsx:24` et `TicketsView.tsx:1057,1444,1523` ecrivent
    // `style={{ ['--chip-hue' as string]: hueOf(state) }}`. L'annotation `as string` s'intercale
    // entre le guillemet et le `:`, donc l'expression ci-dessus ne les voit pas. Sans ce second
    // motif, `--chip-hue` et `--aw-atom-size` remontent comme manquantes alors qu'elles sont
    // definies : fausse alerte.
    //
    // Ce qui separe les deux formes SANS ambiguite, et c'est verifie sur les 21 occurrences de
    // `['--…'` du depot : la cle de style est suivie de `]:` COLLE, tandis que le ternaire ecrit
    // `] : [` et son crochet est precede d'un `?`. On exige donc les deux signes a la fois — en
    // cas de doute on refuse de compter la definition, ce qui produit une fausse ALERTE (bruyante,
    // donc corrigee) plutot qu'un defaut silencieux.
    for (const m of texte.matchAll(
      /(?<!\?\s{0,4})\[\s*['"`](--[A-Za-z0-9_-]+)['"`](?:\s+as\s+[A-Za-z0-9_$.]+)?\s*\]:/g
    ))
      definies.add(m[1])

    const lignes = texte.split('\n')
    lignes.forEach((ligne, index) => {
      for (const m of ligne.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*/g)) {
        const nom = m[1]
        const liste = usages.get(nom) ?? []
        liste.push({
          fichier: relatif,
          ligne: index + 1,
          avecSecours: aUneValeurDeSecours(ligne, m.index + m[0].length)
        })
        usages.set(nom, liste)
      }
    })
  }

  return { definies, usages }
}

export function variablesAppeleesSansDefinition(fichiers: string[]): string[] {
  const { definies, usages } = analyseVariablesCss(fichiers)
  const manquantes: string[] = []
  for (const [nom, liste] of usages) {
    if (definies.has(nom)) continue
    const sansSecours = liste.filter((u) => !u.avecSecours)
    if (sansSecours.length === 0) continue
    manquantes.push(`${nom} — ${sansSecours.map((u) => `${u.fichier}:${u.ligne}`).join(', ')}`)
  }
  return manquantes.sort()
}

describe('variables CSS appelees mais jamais definies', () => {
  const fichiers = [
    ...fichiersSources(join(RACINE, 'src')),
    ...fichiersSources(join(RACINE, 'resources'))
  ]

  it('scanne bien les feuilles du produit', () => {
    // Garde-fou du garde-fou : si le parcours de dossiers casse, le test principal devient vert a
    // vide. Mesure au moment de l'ecriture : 53 feuilles CSS suivies par git.
    const css = fichiers.filter((f) => f.endsWith('.css'))
    expect(css.length).toBeGreaterThanOrEqual(50)
  })

  it("n'appelle aucune variable sans definition ni valeur de secours", () => {
    expect(variablesAppeleesSansDefinition(fichiers)).toEqual([])
  })

  it('compte une cle de style entre crochets comme definition, mais pas un tableau CLI', () => {
    // Les DEUX formes que le depot contient reellement, mesurees a l'ecriture :
    //   - cle de style React calculee : `style={{ ['--chip-hue' as string]: hueOf(state) }}`
    //     (TicketsView.tsx:1057, 1444, 1523 et Spinner.tsx:24) -> c'est une VRAIE definition.
    //   - tableau d'arguments de commande dans un ternaire : `...(force ? ['--force'] : [])`
    //     (worktree-manager.ts:4376, 3907) -> ce n'est PAS une definition.
    // Le seul signe qui les separe sans ambiguite : la cle de style est suivie de `]:` COLLE,
    // le ternaire ecrit `] : [` et son crochet est precede d'un `?`.
    //
    // ENTREE QUI DOIT FAIRE ECHOUER CE CAS si le motif est faux :
    //   - trop STRICT (crochets non reconnus) -> `--cle-crochet` remonte comme manquante alors
    //     qu'elle est definie : fausse alerte. C'est l'etat AVANT cette correction.
    //   - trop PERMISSIF (tout `['--x']` compte) -> `--force` passe pour definie et son appel nu
    //     devient invisible : defaut MANQUE, le cas grave.
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-css-vars-crochets-'))
    const code = join(dossier, 'temoin.tsx')
    const feuille = join(dossier, 'temoin-crochets.css')
    writeFileSync(
      code,
      [
        "const a = <i style={{ ['--cle-crochet' as string]: 12 }} />",
        "const b = spawn(bin, [...(force ? ['--force'] : []), '--json'])"
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      feuille,
      ['.a { color: hsl(var(--cle-crochet) 60% 50%); }', '.b { color: var(--force); }'].join('\n'),
      'utf8'
    )

    const manquantes = variablesAppeleesSansDefinition([code, feuille])

    // La cle entre crochets EST une definition : rien a signaler pour elle.
    expect(manquantes.join(' ')).not.toContain('--cle-crochet')
    // Le drapeau de ligne de commande n'en est PAS une : son appel nu doit etre signale.
    expect(manquantes).toHaveLength(1)
    expect(manquantes[0]).toContain('--force')

    rmSync(dossier, { recursive: true, force: true })
  })

  it("detecte une variable inventee, et ne se plaint pas d'une valeur de secours", () => {
    // ENTREE QUI DOIT FAIRE ECHOUER LE TEST PRINCIPAL : une feuille qui appelle un nom jamais
    // defini. On l'ecrit hors du depot pour ne rien polluer, et on la passe au meme scanner.
    // Sans ce cas, un parcours de dossiers casse rendrait le test ci-dessus vert A VIDE.
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-css-vars-'))
    const feuille = join(dossier, 'temoin.css')
    writeFileSync(
      feuille,
      [
        ':root { --existe: #fff; }',
        '.a { color: var(--nom-jamais-defini); }',
        '.b { color: var(--autre-absente, #000); }',
        '.c { color: var(--existe); }',
        '.d { background: var(--fond-absent, rgba(0, 0, 0, 0.3)); }'
      ].join('\n'),
      'utf8'
    )

    const manquantes = variablesAppeleesSansDefinition([feuille])

    // Detecte l'appel nu, et LUI SEUL : les trois autres lignes sont legitimes.
    expect(manquantes).toHaveLength(1)
    expect(manquantes[0]).toContain('--nom-jamais-defini')
    expect(manquantes.join(' ')).not.toContain('--autre-absente')
    expect(manquantes.join(' ')).not.toContain('--fond-absent')
    expect(manquantes.join(' ')).not.toContain('--existe')

    rmSync(dossier, { recursive: true, force: true })
  })
})
