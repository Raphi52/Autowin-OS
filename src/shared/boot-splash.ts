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

/**
 * L'indicateur est l'ATOME de `src/renderer/src/components/Spinner.tsx` (classes `aw-atom`),
 * seul « ça bosse » de l'application. Ici il est recopié en HTML/CSS statique et NON en React :
 * l'écran d'attente existe précisément avant que React et `theme.css` soient chargés. Les règles
 * sont préfixées par `#autowin-boot` pour ne jamais entrer en conflit avec la feuille de style
 * de l'application pendant le court recouvrement.
 */
export const BOOT_SPLASH_MARKUP = `<style>
  html,body{margin:0;height:100%;background:#000;color:#f5f7fb;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;overflow:hidden}
  #autowin-boot{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:26px;background:#000;animation:boot-in 0.45s ease both}
  #autowin-boot .name{font-size:13px;font-weight:500;letter-spacing:0.24em;text-transform:uppercase;
    color:rgba(245,247,251,0.86)}
  #autowin-boot .step{font-size:12px;color:rgba(245,247,251,0.34);letter-spacing:0.01em}
  #autowin-boot .aw-atom{--aw-atom-size:44px;display:inline-grid;place-items:center;
    width:1em;height:1em;font-size:var(--aw-atom-size)}
  #autowin-boot .aw-atom>*{grid-area:1/1}
  #autowin-boot .aw-atom__plane{display:grid;place-items:center;width:0.8375em;height:0.8375em}
  #autowin-boot .aw-atom__plane>*{grid-area:1/1}
  #autowin-boot .aw-atom__rot{display:grid;place-items:center;width:0.8375em;height:0.8375em;
    animation:aw-atom-spin 2.7s linear infinite}
  #autowin-boot .aw-atom__rot>*{grid-area:1/1}
  #autowin-boot .aw-atom__plane--1{transform:scaleY(0.6)}
  #autowin-boot .aw-atom__plane--2{transform:rotate(55deg) scaleY(0.6)}
  #autowin-boot .aw-atom__plane--3{transform:rotate(-55deg) scaleY(0.6)}
  #autowin-boot .aw-atom__rot--2{animation-duration:3.3s;animation-delay:-0.9s;
    animation-direction:reverse}
  #autowin-boot .aw-atom__rot--3{animation-duration:3.9s;animation-delay:-1.8s}
  #autowin-boot .aw-atom__trail{width:0.8375em;height:0.8375em;border-radius:50%;
    -webkit-mask:radial-gradient(closest-side,transparent 64%,#000 72%,#000 100%);
    mask:radial-gradient(closest-side,transparent 64%,#000 72%,#000 100%)}
  #autowin-boot .aw-atom__head{width:0.17em;height:0.17em;border-radius:50%;background:#fff;
    transform:translateY(-0.394em)}
  #autowin-boot .aw-atom__trail--1{background:conic-gradient(from 0deg,rgba(0,245,255,0) 0 16%,
    rgba(0,255,190,0.6) 58%,rgba(0,245,255,1) 99%,transparent 100%)}
  #autowin-boot .aw-atom__trail--2{background:conic-gradient(from 0deg,rgba(255,0,170,0) 0 16%,
    rgba(180,60,255,0.6) 58%,rgba(255,0,170,1) 99%,transparent 100%)}
  #autowin-boot .aw-atom__trail--3{background:conic-gradient(from 0deg,rgba(255,240,0,0) 0 16%,
    rgba(255,120,0,0.6) 58%,rgba(255,240,0,1) 99%,transparent 100%)}
  #autowin-boot .aw-atom__head--1{box-shadow:0 0 0.16em 0.05em rgba(0,245,255,1)}
  #autowin-boot .aw-atom__head--2{box-shadow:0 0 0.16em 0.05em rgba(255,0,170,1)}
  #autowin-boot .aw-atom__head--3{box-shadow:0 0 0.16em 0.05em rgba(255,240,0,1)}
  #autowin-boot .aw-atom__star{clip-path:polygon(50% 0%,58% 42%,100% 50%,58% 58%,50% 100%,
    42% 58%,0% 50%,42% 42%);animation:aw-atom-tw 1.6s ease-in-out infinite}
  #autowin-boot .aw-atom__star--edge{width:0.2875em;height:0.2875em;background:#ff2d95;
    box-shadow:0 0 0.1em 0.025em rgba(255,45,149,0.55)}
  #autowin-boot .aw-atom__star--core{width:0.244em;height:0.244em;background:#ff8a1f}
  #autowin-boot .aw-atom__star--hot{width:0.125em;height:0.125em;background:#ffd66b}
  @keyframes aw-atom-spin{to{transform:rotate(360deg)}}
  @keyframes aw-atom-tw{0%,100%{transform:scale(0.92)}50%{transform:scale(1.12)}}
  @keyframes boot-in{from{opacity:0}to{opacity:1}}
  @media (prefers-reduced-motion:reduce){
    #autowin-boot .aw-atom__rot{animation-duration:3s}
    #autowin-boot .aw-atom__star{animation-duration:3s}
    #autowin-boot{animation:none}
  }
</style>
<div id="autowin-boot" role="status" aria-live="polite" data-testid="autowin-boot">
  <span class="aw-atom" aria-hidden="true">
    <span class="aw-atom__plane aw-atom__plane--1">
      <span class="aw-atom__rot aw-atom__rot--1">
        <span class="aw-atom__trail aw-atom__trail--1"></span>
        <span class="aw-atom__head aw-atom__head--1"></span>
      </span>
    </span>
    <span class="aw-atom__plane aw-atom__plane--2">
      <span class="aw-atom__rot aw-atom__rot--2">
        <span class="aw-atom__trail aw-atom__trail--2"></span>
        <span class="aw-atom__head aw-atom__head--2"></span>
      </span>
    </span>
    <span class="aw-atom__plane aw-atom__plane--3">
      <span class="aw-atom__rot aw-atom__rot--3">
        <span class="aw-atom__trail aw-atom__trail--3"></span>
        <span class="aw-atom__head aw-atom__head--3"></span>
      </span>
    </span>
    <span class="aw-atom__star aw-atom__star--edge"></span>
    <span class="aw-atom__star aw-atom__star--core"></span>
    <span class="aw-atom__star aw-atom__star--hot"></span>
  </span>
  <span class="name">Autowin OS</span>
  <span class="step">Pr&eacute;paration de l&rsquo;interface&hellip;</span>
</div>`

/** Le document autonome chargé par le processus principal, avant que le renderer soit joignable. */
export const BOOT_SPLASH_DOCUMENT = `<!doctype html><meta charset="utf-8"><title>Autowin OS</title>${BOOT_SPLASH_MARKUP}`
