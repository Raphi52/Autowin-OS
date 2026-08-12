/**
 * ÉCRAN D'ATTENTE DU DÉMARRAGE — défini UNE seule fois, affiché à DEUX endroits.
 *
 * Pourquoi deux endroits, et pourquoi c'est indispensable : le démarrage a deux trous consécutifs,
 * mesurés au chronomètre en développement, cache chaud.
 *
 *   1. La fenêtre s'ouvre avant que le serveur de développement ait servi la page. Rien à peindre :
 *      fenêtre vide. Couvert par le document chargé depuis le processus PRINCIPAL.
 *   2. Puis `index.html` est servi et la navigation VALIDE — ce qui remplace le document précédent —
 *      alors que le bundle React n'est pas prêt. Le `#root` étant vide, la fenêtre redevient blanche
 *      pour ~25 s. C'est le « ça disparaît après une seconde » constaté à l'usage.
 *
 * Le premier écran seul ne suffit donc pas, et le second seul non plus. Les deux portent le MÊME
 * balisage pour que le passage de l'un à l'autre soit invisible, et un test compare les deux copies :
 * la duplication est inévitable (un fichier HTML statique ne peut pas importer ce module), donc elle
 * est surveillée plutôt que subie.
 */

/** Jaune dominant de l'application (accent principal des feuilles de style). */
export const BOOT_JAUNE = '#e9bd4e'
/** Violet secondaire de l'application. */
export const BOOT_VIOLET = '#9d79ed'

/**
 * Le balisage, sans `<html>` ni `<head>` : les deux hôtes l'enveloppent différemment.
 *
 * L'anneau est un SVG à deux arcs plutôt qu'une bordure colorée : une bordure donne des angles nets
 * et une rotation qui saute, ce qui se remarque tout de suite comme bâclé. Les arcs ont des extrémités
 * arrondies et tournent d'un seul mouvement.
 */
export const BOOT_SPLASH_MARKUP = `<style>
  html,body{margin:0;height:100%;background:#000;color:#f5f7fb;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;overflow:hidden}
  #autowin-boot{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:26px;background:#000;animation:boot-in .45s ease both}
  #autowin-boot .ring{width:58px;height:58px;animation:boot-turn 1.1s linear infinite}
  #autowin-boot .ring circle{fill:none;stroke-width:3.5;stroke-linecap:round}
  #autowin-boot .track{stroke:rgba(245,247,251,.07)}
  #autowin-boot .arc-a{stroke:${BOOT_JAUNE};stroke-dasharray:44 158}
  #autowin-boot .arc-b{stroke:${BOOT_VIOLET};stroke-dasharray:30 172;stroke-dashoffset:-101}
  #autowin-boot .name{font-size:13px;font-weight:500;letter-spacing:.24em;text-transform:uppercase;
    color:rgba(245,247,251,.86)}
  #autowin-boot .step{font-size:12px;color:rgba(245,247,251,.34);letter-spacing:.01em}
  @keyframes boot-turn{to{transform:rotate(360deg)}}
  @keyframes boot-in{from{opacity:0}to{opacity:1}}
  @media (prefers-reduced-motion:reduce){
    #autowin-boot .ring{animation-duration:3s}
    #autowin-boot{animation:none}
  }
</style>
<div id="autowin-boot" role="status" aria-live="polite" data-testid="autowin-boot">
  <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle class="track" cx="32" cy="32" r="26"></circle>
    <circle class="arc-a" cx="32" cy="32" r="26"></circle>
    <circle class="arc-b" cx="32" cy="32" r="26"></circle>
  </svg>
  <span class="name">Autowin OS</span>
  <span class="step">Pr&eacute;paration de l&rsquo;interface&hellip;</span>
</div>`

/** Le document autonome chargé par le processus principal, avant que le renderer soit joignable. */
export const BOOT_SPLASH_DOCUMENT = `<!doctype html><meta charset="utf-8"><title>Autowin OS</title>${BOOT_SPLASH_MARKUP}`
