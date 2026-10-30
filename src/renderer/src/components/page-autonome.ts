/*
 * « ENREGISTRER EN .HTML » (conv-1304, 2026-10-30) — une page interactive du fil, en fichier qu'on
 * garde ou qu'on envoie a un collegue. Elle doit tourner SEULE, dans un navigateur ordinaire :
 *   - la feuille de base et le theme du moment, recopies : ils ne traversent pas le fichier ;
 *   - `autowin.graphique` et, pour une page 3D, le moteur three.js, recopies en ligne ;
 *   - `autowin.remplirSaisie` et les boutons de choix : il n'y a plus de fil, le texte part dans le
 *     presse-papiers.
 *
 * LE FICHIER RESTE HORS LIGNE. Dans le fil, la page n'a aucun reseau. Hors du fil, le fichier tourne
 * sans le cadre isole, avec tout le reseau d'un navigateur : c'est du code ecrit par un modele, et
 * l'utilisateur peut l'envoyer. La meme politique (sauf l'empreinte : les scripts sont en ligne)
 * voyage donc dans le fichier, posee AVANT tout script, et WebRTC, qu'elle ne couvre pas, y est coupe.
 *
 * Ce qui part : le code de la page, pas ce que l'utilisateur y a saisi. Un fichier envoye a un
 * collegue ne doit pas emporter en silence ses chiffres.
 */
import type { ThemePage } from './page-interactive'

export interface RessourcesPage {
  moteur: string
  graphiques: string
}

/** La politique de la page du fil (page-scene-3d.mjs), sans `sha256` : tout est en ligne ici. */
export const POLITIQUE_PAGE_AUTONOME = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/* Pose dans le fichier : aucun caractere a echapper, et le meme nettoyage que l'amorce. */
const COUPE_WEBRTC = `for (const nom of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
  try { Object.defineProperty(window, nom, { value: undefined, configurable: false, writable: false }) } catch {}
}`

const CALE_AUTOWIN = `window.autowin = window.autowin || {};
autowin.remplirSaisie = (texte) => {
  const message = String(texte === undefined || texte === null ? '' : texte).trim();
  if (!message || !navigator.clipboard) return false;
  navigator.clipboard.writeText(message).catch(() => {});
  return true;
};
document.addEventListener('click', (event) => {
  const lien = event.target && event.target.closest ? event.target.closest('a[href="#autowin-prompt"]') : null;
  if (!lien) return;
  event.preventDefault();
  autowin.remplirSaisie(lien.textContent);
});
document.addEventListener('submit', (event) => { if (!event.defaultPrevented) event.preventDefault(); });`

/** La page a-t-elle besoin de la boite a outils ? Meme test que l'appel qui l'evalue dans le cadre. */
export function pageUtiliseGraphiques(html: string): boolean {
  return /\bautowin\s*\.\s*graphique\b/u.test(html)
}

const sansFinDeStyle = (texte: string): string => texte.replace(/<\/?style/giu, '')

function styleDuTheme(theme: ThemePage): string {
  const declarations = Object.entries(theme.variables)
    .filter(([nom]) => /^--[a-z0-9-]{1,40}$/iu.test(nom))
    .map(([nom, valeur]) => `${nom}:${valeur}`)
  const fond = theme.variables['--bg-0'] ?? 'Canvas'
  return sansFinDeStyle(
    `:root{${declarations.join(';')};color-scheme:${theme.colorScheme === 'normal' ? 'light dark' : theme.colorScheme}}` +
      `html[data-mode=page]{background:${fond};min-height:100%}` +
      'body{max-width:980px;margin:0 auto;padding:24px 20px;box-sizing:border-box}'
  )
}

export function pageAutonome({
  html,
  style,
  theme,
  titre,
  ressources
}: {
  html: string
  style: string
  theme: ThemePage
  titre: string
  ressources: RessourcesPage
}): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Comme dans le cadre (amorce.js) : ni redirection, ni base, ni feuille externe.
  for (const inutile of doc.querySelectorAll('meta, base, link')) inutile.remove()
  doc.documentElement.setAttribute('data-mode', 'page')
  if (!doc.documentElement.hasAttribute('lang')) doc.documentElement.setAttribute('lang', 'fr')

  const meta = (attributs: Record<string, string>): HTMLMetaElement => {
    const noeud = doc.createElement('meta')
    for (const [nom, valeur] of Object.entries(attributs)) noeud.setAttribute(nom, valeur)
    return noeud
  }
  const script = (texte: string): HTMLScriptElement => {
    const noeud = doc.createElement('script')
    noeud.textContent = texte
    return noeud
  }
  const feuille = (texte: string): HTMLStyleElement => {
    const noeud = doc.createElement('style')
    noeud.textContent = texte
    return noeud
  }

  const entete: Node[] = [
    meta({ charset: 'utf-8' }),
    meta({ 'http-equiv': 'Content-Security-Policy', content: POLITIQUE_PAGE_AUTONOME }),
    meta({ name: 'referrer', content: 'no-referrer' }),
    meta({ name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    feuille(sansFinDeStyle(style)),
    feuille(styleDuTheme(theme)),
    script(COUPE_WEBRTC)
  ]
  // Les couleurs des feuilles de la page passent apres celles de base, comme dans le fil.
  if (ressources.moteur) entete.push(script(ressources.moteur))
  entete.push(script(CALE_AUTOWIN))
  if (pageUtiliseGraphiques(html) && ressources.graphiques) {
    entete.push(script(`autowin.graphique = ${ressources.graphiques.replace(/;\s*$/u, '')};`))
  }
  doc.head.prepend(...entete)
  if (!doc.querySelector('title')) {
    const noeud = doc.createElement('title')
    noeud.textContent = titre
    doc.head.appendChild(noeud)
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`
}
