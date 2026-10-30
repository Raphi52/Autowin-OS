/*
 * LA PAGE DES SCENES 3D DU FIL (`scene-3d.html`) — demande conv-299, 2026-10-16 : « un bloc
 * three.js dans le fil : scene en direct, qu'on peut faire pivoter, isolee sans reseau ni acces a
 * l'app ».
 *
 * POURQUOI UNE PAGE A PART, ET PAS UN CADRE `blob:`/`data:`. Un cadre a URL locale (about:,
 * blob:, data:) HERITE de la politique de securite de l'app (`script-src 'self'`, index.html) :
 * aucun script en ligne n'y tourne (mesure le 2026-10-16 sous Electron 44). Une page servie par
 * l'app elle-meme a SA politique, celle ecrite ici, et le cadre `sandbox="allow-scripts"` (sans
 * `allow-same-origin`) lui donne une origine opaque : ni `window.api`, ni le DOM de l'app, ni son
 * stockage.
 *
 * CE QUE LA POLITIQUE FERME, mesure dans un Electron cache le 2026-10-16 :
 *   - reseau : fetch, XHR, WebSocket, images, polices, prefetch/preload -> bloques ;
 *   - scripts : seuls le moteur et l'amorce passent, par leur empreinte sha256. Le code de la scene
 *     passe par `eval` dans l'amorce ('unsafe-eval'). Un script injecte, un attribut `onerror`, un
 *     cadre imbrique `srcdoc` ou `data:` ne s'executent pas ;
 *   - WebRTC, que la politique ne couvre pas : neutralise par l'amorce, et aucun cadre imbrique ne
 *     peut en retrouver un intact ;
 *   - navigation du cadre vers l'exterieur : refusee par le `frame-src` de l'app et par le filtre
 *     `will-frame-navigate` de la fenetre (window.ts).
 *
 * Construite a la volee par esbuild depuis le paquet `three` installe : pas de copie de 700 Ko a
 * maintenir dans le depot, et le moteur suit les mises a jour de three.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'

export const NOM_PAGE_SCENE_3D = 'scene-3d.html'
/** La meme page SANS moteur 3D, pour les pages ```html-interactif qui ne nomment pas `THREE`. */
export const NOM_PAGE_INTERACTIVE = 'page-interactive.html'

const DOSSIER_PAR_DEFAUT = dirname(fileURLToPath(import.meta.url))

/** Empreinte CSP d'un script en ligne, calculee sur le texte EXACT pose entre les balises. */
export function empreinteScript(texte) {
  return `'sha256-${createHash('sha256').update(texte, 'utf8').digest('base64')}'`
}

/**
 * La politique de la page. Elle est ECRITE ici, jamais heritee : c'est la seule raison d'etre de
 * cette page. Toute directive absente retombe sur `default-src 'none'`.
 */
export function politiqueScene3d(empreintes) {
  return [
    "default-src 'none'",
    `script-src ${empreintes.join(' ')} 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/**
 * Un script pose en ligne ne doit jamais contenir `</script` : le lecteur HTML fermerait la balise
 * au milieu du code. esbuild l'echappe deja dans ses chaines ; on le garantit pour tout le texte.
 */
function sansFermetureDeScript(texte) {
  return texte.replace(/<\/(script)/giu, '<\\/$1')
}

async function construireMoteur(dossier) {
  const resultat = await build({
    entryPoints: [join(dossier, 'runtime.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: 'chrome120',
    legalComments: 'none',
    logLevel: 'silent'
  })
  return sansFermetureDeScript(resultat.outputFiles[0].text)
}

const STYLE =
  ':root{color-scheme:dark}' +
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#05070c;color:#dde3ee;' +
  "font:13px/1.45 system-ui,'Segoe UI',sans-serif}" +
  'canvas{display:block}' +
  '#autowin-scene-3d-erreur{position:fixed;left:0;right:0;bottom:0;margin:0;padding:8px 10px;' +
  'max-height:50%;overflow:auto;white-space:pre-wrap;color:#ffb4b4;background:rgba(40,8,12,.88);' +
  'border-top:1px solid rgba(235,40,40,.6);font:12px/1.45 ui-monospace,Consolas,monospace}'

/** Identifiant du bloc de texte qui porte le moteur, lu par l'amorce (`chargerMoteur`). */
export const ID_MOTEUR_3D = 'autowin-moteur-3d'
/** Identifiant du bloc de texte de `autowin.graphique` (graphiques.js), lu par l'amorce. */
export const ID_GRAPHIQUES = 'autowin-graphiques'

/**
 * La boite a outils de graphiques, en texte comme le moteur : ni empreinte a ajouter a la politique,
 * ni code evalue pour une page qui ne dessine rien. `transform` et non `build` : le texte est une
 * EXPRESSION dont l'amorce lit la valeur.
 */
async function construireGraphiques(dossier) {
  const { code } = await transform(readFileSync(join(dossier, 'graphiques.js'), 'utf8'), {
    minify: true,
    target: 'chrome120',
    legalComments: 'none'
  })
  return sansFermetureDeScript(code)
}

/**
 * La page complete, prete a servir.
 *
 * MOTEUR A LA DEMANDE (conv-1304, 2026-10-30). La meme page servait les scenes ```threejs ET les
 * pages ```html-interactif ; elle executait three.js (~750 Ko) a chaque cadre, meme pour une page
 * sans 3D. Mesure Electron 44, 8 cadres : ~100 ms et ~68 Mo avec le moteur execute, ~30 ms et
 * ~37 Mo sans. Le moteur est donc pose en TEXTE (`type="text/plain"`, jamais execute par le
 * navigateur) et l'amorce l'evalue seulement quand il sert : toujours pour une scene, pour une page
 * si son HTML nomme `THREE` ou `OrbitControls`. L'amorce reste le SEUL script autorise par
 * empreinte ; le moteur passe par `eval`, deja permis pour le code des scenes.
 *
 * DEUX PAGES (conv-1304, meme jour). Meme non execute, ce texte etait encore telecharge et lu par
 * chaque cadre. `avecMoteur: false` construit `page-interactive.html` : la meme amorce, la meme
 * politique, sans le bloc du moteur ; le fil y envoie toute page qui ne nomme pas `THREE`
 * (`pageIsoleePour`, page-interactive.ts). Le filtre de navigation de la fenetre accepte ces deux
 * adresses, et elles seules (isSceneFrameUrl).
 */
export async function construirePageScene3d({
  dossier = DOSSIER_PAR_DEFAUT,
  avecMoteur = true
} = {}) {
  const moteur = avecMoteur ? await construireMoteur(dossier) : ''
  const graphiques = await construireGraphiques(dossier)
  const amorce = sansFermetureDeScript(readFileSync(join(dossier, 'amorce.js'), 'utf8'))
  const politique = politiqueScene3d([empreinteScript(amorce)])
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${politique}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${avecMoteur ? 'Scène 3D' : 'Page interactive'}</title>` +
    `<style>${STYLE}</style></head><body>` +
    (avecMoteur ? `<script type="text/plain" id="${ID_MOTEUR_3D}">${moteur}</script>` : '') +
    `<script type="text/plain" id="${ID_GRAPHIQUES}">${graphiques}</script>` +
    `<script>${amorce}</script>` +
    '</body></html>'
  )
}

/** Les pages a servir, par nom de fichier. */
const PAGES = [
  { nom: NOM_PAGE_SCENE_3D, avecMoteur: true },
  { nom: NOM_PAGE_INTERACTIVE, avecMoteur: false }
]

/**
 * Branchement Vite (electron.vite.config.ts, partie renderer) :
 *   - en developpement, le serveur repond a `/scene-3d.html` et `/page-interactive.html` ;
 *   - au build, les deux pages sont emises a cote de `index.html` (out/renderer/).
 * Chaque page est construite une fois, puis RECONSTRUITE quand l'amorce ou le moteur changent.
 * Mesure du 2026-10-30 (conv-1304) : construite une seule fois par processus, la page servie gardait
 * l'ancienne amorce apres chaque modification de `amorce.js` — l'app de dev montrait un
 * comportement que le code ne portait plus, jusqu'au redemarrage du serveur (seule une modification
 * de CE fichier, dependance de la configuration Vite, le provoquait).
 */
export function pluginScene3d({ dossier = DOSSIER_PAR_DEFAUT } = {}) {
  const construites = new Map()
  const obtenir = ({ nom, avecMoteur }) => {
    if (!construites.has(nom)) construites.set(nom, construirePageScene3d({ dossier, avecMoteur }))
    return construites.get(nom)
  }
  const sources = new Set(
    ['amorce.js', 'graphiques.js', 'runtime.js'].map((nom) => resolve(dossier, nom))
  )
  return {
    name: 'autowin-scene-3d',
    configureServer(server) {
      for (const source of sources) server.watcher.add(source)
      server.watcher.on('change', (fichier) => {
        if (sources.has(resolve(fichier))) construites.clear()
      })
      server.middlewares.use((requete, reponse, suite) => {
        const chemin = (requete.url ?? '').split(/[?#]/u)[0]
        const page = PAGES.find(({ nom }) => chemin === `/${nom}`)
        if (!page) return suite()
        obtenir(page).then(
          (html) => {
            reponse.setHeader('Content-Type', 'text/html; charset=utf-8')
            reponse.setHeader('Cache-Control', 'no-store')
            reponse.end(html)
          },
          (erreur) => suite(erreur)
        )
      })
    },
    async generateBundle() {
      for (const page of PAGES) {
        this.emitFile({ type: 'asset', fileName: page.nom, source: await obtenir(page) })
      }
    }
  }
}
