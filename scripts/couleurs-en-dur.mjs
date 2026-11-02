/**
 * GARDE-FOU : une interface nouvelle suit les thèmes, par défaut.
 *
 * Règle posée le 2026-10-31 (conv-1386) : « quand on fait une nouvelle feature avec de l'ui il faut
 * que par défaut ca soit déclinable avec nos thèmes ».
 *
 * POURQUOI UN CONTRÔLE ET PAS UNE PHRASE. Autowin a dix thèmes, et une règle qui n'écrit que
 * `var(--text)` les suit tous sans rien faire. Une couleur écrite en dur, elle, ne suit aucun thème :
 * blanc sur blanc dans les thèmes clairs, et recopiée dans les couches générées où elle masque
 * ensuite toute retouche. Mesuré le 2026-10-31 : 2 563 couleurs en dur dans 82 fichiers hors feuilles
 * de thème, et une seule garde (`ChatView.jetons-theme.test.ts`), qui ne couvre que le chat. Rien
 * n'empêchait une fonctionnalité nouvelle d'en ajouter, et la dette n'est pas à vider d'un coup.
 *
 * LE CONTRÔLE, DONC, EST UN CLIQUET PAR FICHIER (`couleurs-en-dur.plancher.json`) :
 *  - un fichier d'interface NOUVEAU n'a droit à aucune couleur en dur ;
 *  - un fichier ANCIEN ne peut pas en gagner ; il peut en perdre (`--baisser` enregistre la baisse) ;
 *  - un jeton à valeur littérale ajouté à `theme.css` doit avoir sa valeur claire dans
 *    `theme-modes.css`, sinon il reste en teinte de nuit sur une page claire.
 *
 * Une couleur qui doit VRAIMENT rester fixe (décor 3D, papier blanc d'un aperçu) se déclare sur sa
 * ligne par un commentaire `couleur-fixe: <raison>` : l'exception se lit dans le fichier.
 *
 * DEUX POINTS DE PASSAGE. `couleurs-en-dur.test.mjs` tient l'arbre entier dans la suite, et
 * `.githooks/pre-commit` tient ce que le commit emporte (`--commit`) : le dépôt n'a pas d'intégration
 * continue et un agent ne joue que les tests de ses fichiers, donc le test seul ne mordrait jamais.
 *
 * Usage :
 *   node scripts/couleurs-en-dur.mjs            arbre de travail contre le plancher
 *   node scripts/couleurs-en-dur.mjs --commit   ce que le commit emporte (lancé par le hook)
 *   node scripts/couleurs-en-dur.mjs --baisser  enregistre les baisses, ne monte jamais un plafond
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE_DEPOT = resolve(ICI, '..')
const FICHIER_PLANCHER = join(ICI, 'couleurs-en-dur.plancher.json')
const DOSSIER_INTERFACE = 'src/renderer/src'
const THEME = `${DOSSIER_INTERFACE}/assets/theme.css`
const MODES = `${DOSSIER_INTERFACE}/assets/theme-modes.css`

/** Les feuilles de thème : c'est LÀ que les couleurs doivent vivre, pas un défaut. */
const FEUILLE_DE_THEME = /^src\/renderer\/src\/assets\/theme[^/]*\.css$/

/** Le fichier fait-il partie de l'interface à surveiller ? */
export function estSurveille(chemin) {
  return (
    chemin.startsWith(`${DOSSIER_INTERFACE}/`) &&
    /\.(css|tsx?)$/.test(chemin) &&
    !/\.(test|spec)\.tsx?$/.test(chemin) &&
    !/\.d\.ts$/.test(chemin) &&
    !FEUILLE_DE_THEME.test(chemin)
  )
}

const LITTERALE =
  /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(\s*[\d.]/gi

/** `color: white`, `fill="red"` : la forme la plus courte d'écrire une couleur en dur. */
const NOMMEE =
  /\b(?:color|background(?:-?color)?|fill|stroke|border(?:-?[a-z]+)*|outline(?:-?color)?)\s*[:=]\s*[{'"]*[^;'"\n]*?\b(?:white|black|red|green|blue|yellow|orange|gray|grey|pink|purple)\b/gi

/**
 * Exiger une raison : une marque nue ne dit pas pourquoi la couleur échappe aux thèmes. Une lettre
 * ou un chiffre, et non « autre chose qu'un blanc » : la fin du commentaire CSS passerait pour une
 * raison, ce que le test a constaté à la première écriture (conv-1386).
 */
const COULEUR_FIXE = /couleur-fixe\s*:\s*[\p{L}\p{N}]/u

/** Le noir plein d'un masque ne peint rien : seule son opacité compte (conv-176, conv-246). */
const NOIR_DE_MASQUE = /linear-gradient\(#000 0 0\)/g

/** Nombre de couleurs en dur d'un fichier, commentaires et lignes `couleur-fixe:` mis à part. */
export function compter(texte, chemin) {
  const sansFixes = texte
    .split('\n')
    .filter((ligne) => !COULEUR_FIXE.test(ligne))
    .join('\n')
  const sansBlocs = sansFixes.replace(/\/\*[\s\S]*?\*\//g, '')
  const utile = (
    chemin.endsWith('.css') ? sansBlocs : sansBlocs.replace(/(?<![:'"`])\/\/.*$/gm, '')
  ).replace(NOIR_DE_MASQUE, '')
  return (utile.match(LITTERALE) ?? []).length + (utile.match(NOMMEE) ?? []).length
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
  parcourir(join(racine, DOSSIER_INTERFACE))
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

/** Fichiers au-dessus de leur plafond ; un fichier absent du plancher a pour plafond zéro. */
export function depassements(mesure, plancher) {
  return Object.entries(mesure)
    .map(([chemin, compte]) => ({ chemin, compte, plafond: plancher[chemin] ?? 0 }))
    .filter(({ compte, plafond }) => compte > plafond)
}

/**
 * Pour chaque fichier, le plus haut de deux mesures.
 *
 * Un plafond ne descend jamais sous ce que la version COMMITÉE porte encore. L'arbre est partagé : le
 * nettoyage non commité d'un autre fil y fait baisser le compte, et une copie propre tirée de cette
 * version partirait rouge sur un fichier qu'elle n'a pas touché. Vécu à la première mesure
 * (conv-1386) : `SuperConvMosaique.css`, 9 couleurs commitées pour un plafond de 3.
 */
export function plusHaut(a, b) {
  const haut = { ...a }
  for (const [chemin, compte] of Object.entries(b))
    haut[chemin] = Math.max(haut[chemin] ?? 0, compte)
  return haut
}

/** Le plancher après baisse : aucun plafond ne monte, les fichiers disparus s'en vont. */
export function plancherBaisse(mesure, plancher, existe) {
  const suivant = {}
  for (const [chemin, plafond] of Object.entries(plancher)) {
    if (!existe(chemin)) continue
    const compte = Math.min(mesure[chemin] ?? 0, plafond)
    if (compte > 0) suivant[chemin] = compte
  }
  return suivant
}

/**
 * Jetons sans valeur claire ASSUMÉS : `--on-accent` est le blanc posé sur un aplat vif, et les trois
 * `--chat-*` sont posés sur un aplat qui reste sombre dans les deux modes (voir
 * `ChatView.jetons-theme.test.ts`). En ajouter un doit rester une décision, écrite ici.
 */
const SANS_VALEUR_CLAIRE = [
  '--on-accent',
  '--chat-surlignage-texte',
  '--chat-depot-texte',
  '--chat-depot-detail'
]

/** Les jetons de `theme.css` à valeur littérale qui n'ont pas de valeur pour les thèmes clairs. */
export function jetonsSansValeurClaire(theme, modes) {
  const debut = modes.indexOf(":root[data-base='clair'] {")
  const bloc = debut < 0 ? '' : modes.slice(debut, modes.indexOf('\n}', debut))
  const clairs = new Set([...bloc.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
  return [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)]
    .filter(([, nom, valeur]) => new RegExp(LITTERALE.source, 'i').test(valeur) && !clairs.has(nom))
    .map(([, nom]) => nom)
    .filter((nom) => !SANS_VALEUR_CLAIRE.includes(nom))
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

/** Ce que CE commit emporte, lu dans l'index : l'arbre partagé porte le travail d'autres fils. */
export function constatDuCommit() {
  const emportes = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
  const mesure = {}
  for (const chemin of emportes.filter(estSurveille))
    mesure[chemin] = compter(git(['show', `:${chemin}`]), chemin)
  const jetons =
    emportes.includes(THEME) || emportes.includes(MODES)
      ? jetonsSansValeurClaire(git(['show', `:${THEME}`]), git(['show', `:${MODES}`]))
      : []
  return { fichiers: depassements(mesure, lirePlancher()), jetons }
}

/** Le compte de la version commitée, pour les fichiers qui ont un plafond et qu'elle contient. */
function mesureCommitee(chemins) {
  const connus = new Set(git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0'))
  const mesure = {}
  for (const chemin of chemins.filter((c) => connus.has(c)))
    mesure[chemin] = compter(git(['show', `HEAD:${chemin}`]), chemin)
  return mesure
}

function constatDeLArbre() {
  const lire = (chemin) => readFileSync(join(RACINE_DEPOT, chemin), 'utf8')
  return {
    fichiers: depassements(mesurer(), lirePlancher()),
    jetons: jetonsSansValeurClaire(lire(THEME), lire(MODES))
  }
}

/** Le texte du refus : il dit quoi écrire à la place, pas seulement ce qui est interdit. */
export function messageDeRefus({ fichiers, jetons }) {
  return [
    'REFUSÉ : cette interface ne suivrait pas les thèmes (règle du 2026-10-31, conv-1386).',
    ...fichiers.map(
      ({ chemin, compte, plafond }) =>
        `  ${chemin} : ${compte} couleur(s) en dur, ${plafond} au plus`
    ),
    ...jetons.map((nom) => `  ${nom} : aucune valeur pour les thèmes clairs`),
    'À la place :',
    '  - un jeton existant : var(--text), --text-dim, --line, --bg-0 à 3, --gold, --rose, --ok, --warn, --err ;',
    '  - un jeton neuf : sa valeur dans assets/theme.css ET dans le bloc clair de assets/theme-modes.css ;',
    '  - une transparence : color-mix(in srgb, var(--gold) 30%, transparent) ;',
    '  - jamais var(--x, #hex) : la valeur de secours est une couleur en dur comme une autre.',
    'Couleur qui doit rester fixe (décor 3D, papier) : commentaire « couleur-fixe: <raison> » sur sa ligne.',
    'Fichier renommé : renomme aussi son entrée dans scripts/couleurs-en-dur.plancher.json.',
    ''
  ].join('\n')
}

// Comparaison par chemin du SYSTÈME : sous Windows, argv[1] porte des barres obliques inverses.
const lanceDirectement =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (lanceDirectement) {
  if (process.argv.includes('--baisser')) {
    const avant = lirePlancher()
    const commite = mesureCommitee(Object.keys(avant))
    const presents = new Set([...fichiersSurveilles(), ...Object.keys(commite)])
    const mesure = plusHaut(mesurer(), commite)
    const apres = plancherBaisse(mesure, avant, (chemin) => presents.has(chemin))
    writeFileSync(FICHIER_PLANCHER, `${JSON.stringify(apres, null, 2)}\n`)
    const total = (p) => Object.values(p).reduce((somme, n) => somme + n, 0)
    process.stdout.write(`Plancher : ${total(avant)} → ${total(apres)} couleurs en dur.\n`)
  } else {
    const constat = process.argv.includes('--commit') ? constatDuCommit() : constatDeLArbre()
    if (constat.fichiers.length > 0 || constat.jetons.length > 0) {
      process.stderr.write(messageDeRefus(constat))
      process.exit(1)
    }
  }
}
