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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

export const NOM_PAGE_SCENE_3D = 'scene-3d.html'

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

/** La page complete, prete a servir. */
export async function construirePageScene3d({ dossier = DOSSIER_PAR_DEFAUT } = {}) {
  const moteur = await construireMoteur(dossier)
  const amorce = sansFermetureDeScript(readFileSync(join(dossier, 'amorce.js'), 'utf8'))
  const politique = politiqueScene3d([empreinteScript(moteur), empreinteScript(amorce)])
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${politique}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>Scène 3D</title><style>${STYLE}</style></head><body>` +
    `<script>${moteur}</script><script>${amorce}</script>` +
    '</body></html>'
  )
}

/**
 * Branchement Vite (electron.vite.config.ts, partie renderer) :
 *   - en developpement, le serveur repond a `/scene-3d.html` avec la page construite ;
 *   - au build, la page est emise a cote de `index.html` (out/renderer/scene-3d.html).
 * La page est construite une seule fois par processus : le moteur ne change qu'avec `three`.
 */
export function pluginScene3d({ dossier = DOSSIER_PAR_DEFAUT } = {}) {
  let page
  const obtenir = () => (page ??= construirePageScene3d({ dossier }))
  return {
    name: 'autowin-scene-3d',
    configureServer(server) {
      server.middlewares.use((requete, reponse, suite) => {
        const chemin = (requete.url ?? '').split(/[?#]/u)[0]
        if (chemin !== `/${NOM_PAGE_SCENE_3D}`) return suite()
        obtenir().then(
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
      this.emitFile({ type: 'asset', fileName: NOM_PAGE_SCENE_3D, source: await obtenir() })
    }
  }
}
