/**
 * Aperçu d'un bloc ```html-interactif TEL QUE LE FIL LE FAIT TOURNER, avec un verdict machine.
 *
 * Pourquoi il existe (conv-1292, 2026-10-29) : une page interactive du fil (BlocHtmlInteractif.tsx)
 * est du CODE qui s'execute, dans un cadre isole sans reseau, ou la politique de securite refuse
 * tout script en ligne — l'amorce (src/renderer/scene-3d/amorce.js) recompile les `<script>` et
 * les `onclick`. Une page qui marche ouverte seule dans un navigateur peut donc planter, rester
 * vide ou ignorer ses boutons dans le fil. Comme `scene-3d-apercu.mjs` pour les scenes, ce script
 * controle ce que l'utilisateur verra, avant qu'il le voie :
 *   - la MEME page isolee (`scene-3d.html`), sous la MEME politique parente (lue dans
 *     `src/renderer/index.html`) et le meme filtre de navigation des cadres que l'app ;
 *   - le MEME protocole que le bloc : feuille de base, theme et hauteur viennent de
 *     `page-interactive.ts`, compile tel quel (aucune copie a tenir a jour) ;
 *   - le MEME moteur : l'Electron du depot, rendu hors ecran — rien ne s'ouvre a l'ecran.
 * A chaque largeur de colonne, il capture la page, puis CLIQUE chaque element cliquable (bouton,
 * case, curseur, `onclick`...) et SURVOLE chaque dessin (canvas, svg), capture apres chaque geste et
 * releve les erreurs levees en route.
 *
 * Usage : node scripts/html-interactif-apercu.mjs <fichier.html|fichier.md> [--bloc 1]
 *           [--largeurs 560,860] [--attente 1500] [--clair] [--theme <id>]
 *           [--out .autowin-tmp/html-interactif-apercu]
 *   Un fichier contenant une cloture ```html-interactif : le n-ieme bloc est pris. Sinon le fichier
 *   entier est le contenu du bloc. `--clair` : jetons du theme clair (fond clair, `color-scheme`
 *   light). `--theme <id>` : jetons de src/renderer/src/assets/theme-<id>.css en plus.
 *
 * Codes de sortie (un JSON est toujours ecrit sur stdout, champ `defauts`) :
 *   0 = la page tourne, montre quelque chose, tient dans la colonne a chaque largeur ;
 *   3 = ERREUR JavaScript, au demarrage OU pendant un clic — y compris un `<script src>` externe,
 *       refuse (le fil afficherait le message sous la page) ;
 *   4 = RIEN A VOIR : page vide (aucune hauteur, ou capture d'une seule couleur), ou bloc au-dela de
 *       MAX_PAGE_INTERACTIVE_CHARS (le fil le montre en code, sans l'executer) ;
 *   5 = DEBORDEMENT : le contenu est plus large que la colonne (l'utilisateur defile de cote) ;
 *   6 = HAUTEUR INSTABLE : la page grandit seule, sans aucun geste, ou atteint le plafond du
 *       cadre (typiquement une hauteur en `vh` ou `innerHeight` : le cadre suit la page, qui suit
 *       le cadre...) ;
 *   7 = FOND OPAQUE : la page peint un fond sur `html` ou `body` (direction « transparence
 *       totale » : la page se pose sur le fond du fil) ;
 *   2 = usage ; 1 = erreur technique (Electron, construction de la page).
 *   Plusieurs defauts : le code est celui du premier dans l'ordre 3, 4, 5, 6, 7.
 * Champ indicatif par largeur : `gestes` — pour chaque clic ou survol, la part des pixels qui
 * change (`ecart`). Un geste a 0 n'a rien change a l'ecran : bouton mort, ou effet invisible (copie,
 * focus). A LIRE avec ses captures `geste-<largeur>-<n>.png`, ce n'est pas un defaut a lui seul.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  construirePageScene3d,
  NOM_PAGE_SCENE_3D
} from '../src/renderer/scene-3d/page-scene-3d.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE_INTERACTIVE = join(RACINE, 'src/renderer/src/components/page-interactive.ts')
const SCENE_3D_PARTAGE = join(RACINE, 'src/shared/scene-3d.ts')
const FORME = 'html-interactif'

function argument(nom, defaut) {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defaut
}

function sortir(code, rapport) {
  process.stdout.write(JSON.stringify(rapport, null, 2) + '\n')
  process.exit(code)
}

const fichier = process.argv[2]
if (!fichier || fichier.startsWith('--') || !existsSync(fichier)) {
  sortir(2, {
    defauts: ['usage'],
    erreur: `usage : node scripts/html-interactif-apercu.mjs <fichier> — introuvable : ${fichier ?? '(rien)'}`
  })
}

const texte = readFileSync(fichier, 'utf8').replace(/\r\n/gu, '\n')
const blocs = [...texte.matchAll(/^(`{3,})html-interactif[^\n]*\n([\s\S]*?)^\1[ \t]*$/gmu)].map(
  (m) => m[2]
)
const rang = Number(argument('--bloc', '1'))
// Le fil prend le contenu ENTRE les clotures, sans le saut de ligne final (markdown-blocs.ts).
const html = blocs.length > 0 ? blocs[rang - 1]?.replace(/\n$/u, '') : texte
if (html === undefined) {
  sortir(2, {
    defauts: ['usage'],
    erreur: `bloc ${rang} absent : ${blocs.length} bloc(s) ${FORME}`
  })
}

/**
 * Les helpers du bloc (feuille de base, lecture du theme, borne de hauteur) et les bornes partagees,
 * compiles depuis leur source : l'apercu ne peut pas deriver du fil.
 */
async function compilerProtocole() {
  const sortie = await build({
    stdin: {
      contents:
        `import * as page from ${JSON.stringify(PAGE_INTERACTIVE.replace(/\\/g, '/'))}\n` +
        `import { MAX_PAGE_INTERACTIVE_CHARS } from ${JSON.stringify(SCENE_3D_PARTAGE.replace(/\\/g, '/'))}\n` +
        'globalThis.__pageInteractive = { ...page, MAX_PAGE_INTERACTIVE_CHARS }\n',
      resolveDir: RACINE,
      loader: 'ts'
    },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent'
  })
  return sortie.outputFiles[0].text
}

/**
 * Les JETONS DE BASE de l'app (`--text`, `--gold-doux`, `--font`...) que le bloc lit sur son hote
 * pour les passer a la page : `:root` de theme.css, et en `--clair` `:root[data-base='clair']` de
 * theme-modes.css. Meme lecture que `jetonsDeBase` de html-render-apercu.mjs (conv-1074).
 */
function jetonsDeBase(clair) {
  const variables = (chemin, motif) => {
    const css = readFileSync(join(RACINE, chemin), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const bloc = motif.exec(css)
    return bloc ? (bloc[1].match(/--[\w-]+\s*:[^;]+;/g) ?? []).join('') : ''
  }
  const sombre = variables('src/renderer/src/assets/theme.css', /(?:^|\n):root\s*\{([^}]*)\}/)
  const claire = clair
    ? variables(
        'src/renderer/src/assets/theme-modes.css',
        /:root\[data-base='clair'\]\s*\{([^}]*)\}/
      )
    : ''
  return `:root{${sombre}}` + (claire ? `\n:root[data-base='clair']{${claire}}` : '')
}

/** `--theme <id>` : le bloc `:root[data-theme='<id>']` de theme-<id>.css, ou null s'il manque. */
function jetonsDuTheme(id) {
  const chemin = join(RACINE, `src/renderer/src/assets/theme-${id}.css`)
  if (!existsSync(chemin)) return null
  const css = readFileSync(chemin, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const bloc = new RegExp(String.raw`:root\[data-theme='${id}'\]\s*\{([^}]*)\}`).exec(css)
  return bloc ? `:root[data-theme='${id}']{${bloc[1].trim()}}` : null
}

const largeurs = argument('--largeurs', '560,860')
  .split(',')
  .map((valeur) => Number(valeur.trim()))
  .filter((valeur) => valeur >= 200)
const attente = Number(argument('--attente', '1500'))
const clair = process.argv.includes('--clair')
const idTheme = argument('--theme', undefined)
const out = resolve(argument('--out', join(RACINE, '.autowin-tmp', 'html-interactif-apercu')))
const pages = join(out, 'pages')
mkdirSync(pages, { recursive: true })

let protocole
try {
  protocole = await compilerProtocole()
} catch (erreur) {
  sortir(1, { defauts: ['technique'], erreur: `compilation de page-interactive.ts : ${erreur}` })
}
// Les bornes, lues dans le protocole compile plutot que recopiees ici.
const bornes = new Function(`${protocole}; return globalThis.__pageInteractive`)()
if (html.length > bornes.MAX_PAGE_INTERACTIVE_CHARS) {
  sortir(4, {
    defauts: ['trop-long'],
    erreur: `${html.length} caracteres > ${bornes.MAX_PAGE_INTERACTIVE_CHARS} : le fil montrera le bloc en code, sans l'executer`
  })
}

let page
try {
  page = await construirePageScene3d()
} catch (erreur) {
  sortir(1, { defauts: ['technique'], erreur: `construction de la page : ${erreur}` })
}
writeFileSync(join(pages, NOM_PAGE_SCENE_3D), page)

const jetonsTheme = idTheme ? jetonsDuTheme(idTheme) : ''
if (jetonsTheme === null) {
  sortir(2, {
    defauts: ['usage'],
    erreur: `--theme ${idTheme} : aucun bloc :root[data-theme='${idTheme}'] dans src/renderer/src/assets/theme-${idTheme}.css`
  })
}

// La politique PARENTE de l'app, recopiee telle quelle : c'est elle que le cadre a au-dessus de lui.
const index = readFileSync(join(RACINE, 'src/renderer/index.html'), 'utf8')
const politiqueApp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(index)?.[1]
if (!politiqueApp)
  sortir(1, { defauts: ['technique'], erreur: 'politique de index.html introuvable' })
// L'hote reprend ce que la bulle du fil transmet au bloc (`.msg-body` de ChatView.css : 15 px,
// interligne 1.7 ; couleur et police du `body` de theme.css) et le `color-scheme` de la racine : un
// cadre dont le `color-scheme` differe de celui de son hote recoit un fond opaque de Chromium.
writeFileSync(
  join(pages, 'parent.html'),
  `<!doctype html><html${clair ? " data-base='clair'" : ''}${idTheme ? ` data-theme='${idTheme}'` : ''}>` +
    '<head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${politiqueApp}">` +
    `<style>${jetonsDeBase(clair)}\n${jetonsTheme}\n` +
    `:root{color-scheme:${clair ? 'light' : 'dark'}}` +
    `html,body{margin:0;background:${clair ? '#fdfdff' : '#0b0b0e'}}` +
    'body{color:var(--text);font-family:var(--font)}' +
    '.hote{display:block;width:100%;font-size:15px;line-height:1.7;letter-spacing:.005em}' +
    '.hote iframe{display:block;width:100%;border:0;background:transparent;color-scheme:inherit}' +
    '</style></head><body><section class="hote"></section></body></html>'
)

const config = { pages, html, protocole, largeurs, attente, out }
const cheminConfig = join(out, 'config.json')
writeFileSync(cheminConfig, JSON.stringify(config))

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const lancement = spawnSync(
  electron,
  [join(RACINE, 'scripts', 'html-interactif-apercu.electron.cjs'), cheminConfig],
  { encoding: 'utf8', env, timeout: 30_000 + largeurs.length * (attente + 20_000) }
)
const cheminRapport = join(out, 'rapport.json')
if (lancement.status !== 0 || !existsSync(cheminRapport)) {
  sortir(1, {
    defauts: ['technique'],
    erreur: `Electron a rendu ${lancement.status ?? lancement.signal}`,
    stderr: (lancement.stderr ?? '').split('\n').slice(-12).join('\n')
  })
}

const resultats = JSON.parse(readFileSync(cheminRapport, 'utf8'))
const defauts = []
const ajouter = (defaut) => {
  if (!defauts.includes(defaut)) defauts.push(defaut)
}
for (const r of resultats) {
  // Message de l'amorce pour un `<script src>` (amorce.js, lancerPage).
  const externe = (e) => e.message.startsWith('Script externe')
  if (r.erreurs.some(externe)) ajouter('script-externe')
  if (r.erreurs.some((e) => !externe(e))) ajouter('erreur-javascript')
  if (!r.lancee && r.erreurs.length === 0) ajouter('page-jamais-lancee')
  if (r.hauteur < 4 || r.dessine < 0.001) ajouter('page-vide')
  if (r.debordementPx > 0) ajouter('debordement')
  if (r.hauteurFinale > r.hauteur + 2 || r.hauteur >= bornes.HAUTEUR_MAX_PAGE)
    ajouter('hauteur-instable')
  if (r.fondOpaque.length > 0) ajouter('fond-opaque')
}
const CODES = [
  [3, ['erreur-javascript', 'script-externe', 'page-jamais-lancee']],
  [4, ['page-vide']],
  [5, ['debordement']],
  [6, ['hauteur-instable']],
  [7, ['fond-opaque']]
]
const codeSortie = CODES.find(([, noms]) => noms.some((nom) => defauts.includes(nom)))?.[0] ?? 0
sortir(codeSortie, {
  defauts,
  captures: resultats.flatMap((r) => [r.png, ...r.gestes.map((g) => g.png)]),
  largeurs: resultats
})
