/**
 * Aperçu d'un bloc ```threejs TEL QUE LE FIL LE FAIT TOURNER, avec un verdict machine.
 *
 * Pourquoi il existe (conv-299, 2026-10-16) : les maquettes 3D du fil (Bloc3D.tsx) sont du CODE
 * qui s'execute. Une faute de frappe donne une scene noire ou un message d'erreur a la place des
 * planetes. Comme `html-render-apercu.mjs` pour les mini-pages, ce script controle le rendu que
 * l'utilisateur verra, avant qu'il le voie :
 *   - la MEME page (`scene-3d.html`, construite par `src/renderer/scene-3d/page-scene-3d.mjs`),
 *     avec sa politique de securite, dans un cadre `sandbox="allow-scripts"` ;
 *   - sous la MEME politique parente (lue dans `src/renderer/index.html`) et le meme filtre de
 *     navigation des cadres que la fenetre de l'app ;
 *   - dans le MEME moteur : l'Electron du depot, fenetre cachee — rien ne s'ouvre a l'ecran.
 * Il capture la scene a chaque largeur de colonne, puis simule un glisser de souris pour voir si
 * elle pivote.
 *
 * Usage : node scripts/scene-3d-apercu.mjs <fichier.js|fichier.md> [--bloc 1]
 *           [--largeurs 560,860] [--hauteur 400] [--attente 2500]
 *           [--out .autowin-tmp/scene-3d-apercu]
 *   Un fichier contenant une cloture ```threejs : le n-ieme bloc est pris. Sinon le fichier entier
 *   est le code du bloc.
 *   SCENE D'UN CARROUSEL /draft (conv-318) : si le bloc est suivi du carrousel qui lui laisse sa
 *   place (`scripts/draft-carrousel.mjs`, champ `scene3d`), la scene tourne avec le MEME prelude que
 *   le fil (`autowin.surChoix`), puis recoit chaque rang 2..N : une capture `scene-<l>-choix-<n>.png`
 *   par proposition, a LIRE.
 *
 * Codes de sortie (un JSON est toujours ecrit sur stdout, champ `defauts`) :
 *   0 = la scene tourne et dessine quelque chose a chaque largeur ;
 *   3 = ERREUR JavaScript dans la scene (le fil afficherait « La scène a planté ») ;
 *   4 = RENDU VIDE : la capture est d'une seule couleur (rien n'est dessine, ou pas a l'ecran) ;
 *   5 = CHOIX IGNORE : scene de carrousel dont la vue ne change pour AUCUN rang (les N propositions
 *       montreraient la meme image) ;
 *   2 = usage ; 1 = erreur technique (Electron, construction de la page).
 * Champs indicatifs par largeur : `animee` (part des pixels qui changent sans rien toucher) et
 * `apresGlisser` (part qui change apres un glisser) — une scene qu'on peut faire pivoter montre un
 * `apresGlisser` nettement plus grand que `animee`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  construirePageScene3d,
  NOM_PAGE_SCENE_3D
} from '../src/renderer/scene-3d/page-scene-3d.mjs'
import { CLASSE_PLACE_SCENE, codeSceneDuCarrousel } from '../src/renderer/scene-3d/choix-scene.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  sortir(2, { defauts: ['usage'], erreur: 'usage : node scripts/scene-3d-apercu.mjs <fichier>' })
}

const texte = readFileSync(fichier, 'utf8').replace(/\r\n/gu, '\n')
const blocs = [...texte.matchAll(/^(`{3,})threejs[^\n]*\n([\s\S]*?)^\1[ \t]*$/gmu)].map((m) => m[2])
const rang = Number(argument('--bloc', '1'))
const codeBloc = blocs.length > 0 ? blocs[rang - 1] : texte
if (codeBloc === undefined) {
  sortir(2, { defauts: ['usage'], erreur: `bloc ${rang} absent : ${blocs.length} bloc(s) threejs` })
}
// Le carrousel /draft qui SUIT ce bloc et lui laisse sa place : la scene y est montee par le fil
// (draft-scene-3d.ts), avec le prelude des rangs. Son nombre de propositions = ses cases radio.
const apresBloc = blocs.length > 0 ? texte.slice(texte.indexOf(codeBloc) + codeBloc.length) : ''
const carrousel = /^\s*(`{3,})[ \t]*\n\s*(`{3,})html-render[^\n]*\n([\s\S]*?)^\2[ \t]*$/mu.exec(
  apresBloc
)
const propositionsDuCarrousel =
  carrousel && new RegExp(String.raw`class\s*=\s*["']${CLASSE_PLACE_SCENE}["']`).test(carrousel[3])
    ? (carrousel[3].match(/<input\b[^>]*type="radio"/g) ?? []).length
    : 0
const code = propositionsDuCarrousel > 0 ? codeSceneDuCarrousel(codeBloc) : codeBloc

const largeurs = argument('--largeurs', '560,860')
  .split(',')
  .map((valeur) => Number(valeur.trim()))
  .filter((valeur) => valeur >= 200)
const hauteur = Number(argument('--hauteur', '400'))
const attente = Number(argument('--attente', '2500'))
const out = resolve(argument('--out', join(RACINE, '.autowin-tmp', 'scene-3d-apercu')))
const pages = join(out, 'pages')
mkdirSync(pages, { recursive: true })

let page
try {
  page = await construirePageScene3d()
} catch (erreur) {
  sortir(1, { defauts: ['technique'], erreur: `construction de la page : ${erreur}` })
}
writeFileSync(join(pages, NOM_PAGE_SCENE_3D), page)

// La politique PARENTE de l'app, recopiee telle quelle : c'est elle que le cadre a au-dessus de lui.
const index = readFileSync(join(RACINE, 'src/renderer/index.html'), 'utf8')
const politiqueApp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(index)?.[1]
if (!politiqueApp)
  sortir(1, { defauts: ['technique'], erreur: 'politique de index.html introuvable' })
writeFileSync(
  join(pages, 'parent.html'),
  '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${politiqueApp}">` +
    '<style>html,body{margin:0;background:#080a0e}</style></head><body></body></html>'
)

const config = { pages, code, largeurs, hauteur, attente, out, choix: propositionsDuCarrousel }
const cheminConfig = join(out, 'config.json')
writeFileSync(cheminConfig, JSON.stringify(config))

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const lancement = spawnSync(
  electron,
  [join(RACINE, 'scripts', 'scene-3d-apercu.electron.cjs'), cheminConfig],
  { encoding: 'utf8', env, timeout: 30_000 + largeurs.length * (attente + 8_000) }
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
if (resultats.some((r) => r.erreurs.length > 0)) defauts.push('erreur-javascript')
if (resultats.some((r) => r.dessine < 0.003)) defauts.push('rendu-vide')
// Une scene de carrousel doit CHANGER pour au moins un rang, nettement au-dela de son propre
// mouvement sur le meme delai (`bruitChoix`).
const ignoreLeChoix = (r) =>
  r.choix.length > 0 && r.choix.every((c) => c.ecart < Math.max(0.02, 3 * r.bruitChoix))
if (resultats.some(ignoreLeChoix)) defauts.push('choix-ignore')
const codeSortie = defauts.includes('erreur-javascript')
  ? 3
  : defauts.includes('rendu-vide')
    ? 4
    : defauts.includes('choix-ignore')
      ? 5
      : 0
sortir(codeSortie, {
  defauts,
  ...(propositionsDuCarrousel > 0 ? { carrousel: { propositions: propositionsDuCarrousel } } : {}),
  captures: resultats.flatMap((r) => [r.png, ...r.choix.map((c) => c.png)]),
  largeurs: resultats
})
