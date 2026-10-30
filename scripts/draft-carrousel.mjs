/**
 * CARROUSEL DES PROPOSITIONS /draft — le format de galerie retenu par l'utilisateur (conv-302,
 * 2026-10-17, « /draft un carrousel pour basculer entre les propositions de /draft »).
 *
 * Choix arrêtés au fil des tours de ce /draft :
 *   - B « Pellicule » : une bande de VIGNETTES sous la proposition, chacune une copie réduite de la
 *     maquette — on voit les N d'un coup et on saute directement à l'une ;
 *   - F « Comparateur » : un interrupteur « Tout voir » étale les N en grille (les vignettes
 *     s'agrandissent), la proposition courante reste cerclée d'or ;
 *   - transition C « Pile de cartes » : en avançant, la suivante arrive de la droite et SE POSE
 *     PAR-DESSUS pendant que l'ancienne recule et s'assombrit ; en reculant, la carte du dessus
 *     repart à droite et découvre la précédente. 450 ms, départ vif, arrivée douce.
 *     Chaque carte porte le FOND du carrousel : sans lui, celle qui se pose ne cachait rien et les
 *     deux propositions se lisaient l'une sur l'autre pendant la transition (constat utilisateur,
 *     2026-10-17 : « y'a les 2 superposés pendant une seconde ») ;
 *   - flèches de CÔTÉ : une grande flèche à gauche et à droite de la proposition (même demande :
 *     « pas juste un ptit truc de pagination en haut à droite ») ; en haut reste le compteur « 2 / 6 ».
 *
 * Le fil n'exécute AUCUN script (src/renderer/src/components/chat-html-inline.ts) : tout tient en
 * boutons radio + `:checked`. Les propositions sont EMPILÉES dans la même case de grille ; chacune
 * est « avant » (rang < courant), « courante » ou « après » (rang > courant), et un état hors champ
 * est DÉCOUPÉ (clip-path) une fois sa transition finie — révélé au clic, comme un onglet.
 * Le sens de la transition sort donc de l'ORDRE du document, sans rien mémoriser.
 *
 * Pas de bouclage 6 → 1 : la flèche du bout est grisée, sinon la transition y jouerait à l'envers.
 * Pas de garde `prefers-reduced-motion` : le poste de l'utilisateur l'a actif, la transition ne se
 * verrait jamais (même choix que src/renderer/src/assets/app-shell.css).
 * HABIT HOLOGRAPHIQUE (conv-302 : « les boutons pour clicker et le caroussel doivent etre du style
 * holographique ») — celui du thème par défaut (`nebuleuse-verre`, theme-nebuleuse-verre.css) :
 * cadre NACRE de 1 px du bloc de question (bleu > rose > argent > rose clair), aplats GRIS neutres,
 * sélection = cadre nacre autour d'un gris plus clair, bouton principal en GEL FONDU (dégradé
 * #3c6eeb -> #e63ca0 à 135°, reflet blanc 40 % qui s'efface à 60 %, 56 % au survol, 12 % à l'appui).
 * Chaque couleur LIT le jeton du thème actif (`--text`, `--bg-0`, `--rose`, `--violet`,
 * `--nv-degrade`…), repli = valeurs d'Holographique : le même bloc suit Holographique blanc.
 * Thème clair : theme-modes.css force `color`, `background-color` et `border-color` en !important
 * sur tout le bloc ; les aplats et dégradés passent donc par `background-image`, et le texte blanc
 * des pastilles par `-webkit-text-fill-color`, qui y résistent.
 *
 * BOUTON MIXER (conv-321, 2026-10-17 : « ajoute un bouton mixer pour choisir plusieurs éléments d'un
 * draft en affinage ») : « Mixer » ouvre une rangée de cases, une sous chaque vignette ; le bouton
 * d'envoi devient « Mixer 1 + 3 + 6 », suivi de « Implémenter 1 + 3 + 6 » (conv-321, 2026-10-18 : le
 * même couple principal / secondaire que « Affiner la N » / « Implémenter la N »). Le fil envoie le
 * TEXTE du lien cliqué (bouton-prompt-html.ts, `textContent`) et n'exécute aucun script : aucun
 * bouton ne peut composer son message à partir des cases. Chaque mélange d'au moins 2 est donc un
 * groupe PRÉCALCULÉ de ces deux liens, porteur d'une classe `dkc-yK` par proposition K qu'il nomme ;
 * deux règles par case le cachent dès que les cases cochées diffèrent des siennes (case décochée
 * qu'il nomme, case cochée qu'il ignore). Un seul groupe reste visible : ce qui part est ce qui est
 * écrit, et le fil retrouve chaque libellé dans la source (verrou durable).
 * Coût : 2^n − n − 1 groupes, 57 pour 6 propositions (114 liens) — d'où `MIXER_MAX`.
 *
 * Usage : node scripts/draft-carrousel.mjs <propositions.json> [--out <tour.md>]
 *   JSON : { "titre", "intro"?, "css"?, "propositions": [ { "nom", "resume"?, "html", "css"? } ],
 *            "boutons"?, "boutonsFixes"?, "mixer"? }
 *   - « mixer » : posé d'office jusqu'à 6 propositions (`false` pour l'ôter, `true` au-delà refusé) ;
 *   - le CHOIX se fait par les boutons du bas, pas par un bloc `ask` : « Affiner la N · nom » et
 *     « Implémenter la N · nom » suivent la proposition affichée (modèles `boutons`, `{n}`/`{nom}`),
 *     « Aucune : propose N autres directions » est fixe (`boutonsFixes`). Un clic envoie le libellé ;
 *     le bouton n'est actif qu'une fois le tour fini, et se ferme une fois envoyé ;
 *   - 2 à 10 propositions (6 pour un tour /draft) ; `nom` et `resume` en texte, `html` = la
 *     maquette seule, SANS `<input>`, `<label>`, `<style>` ni `<script>` (le CSS va dans `css`) ;
 *   - le `html` est RECOPIÉ dans sa vignette : préfixe tes classes (jamais `dkc-`), et un `id`
 *     (dégradé SVG) est renommé dans la copie pour ne pas exister en double.
 *   - « scene3d » (sujet en VOLUME, conv-318 : « le bloc 3d doit etre dans le bloc draft ») : le
 *     code three.js d'UNE scène qui montre la proposition choisie, écrit comme un bloc ```threejs
 *     (`document.body`, `innerWidth`/`innerHeight`, « resize »). Le carrousel devient alors UNE
 *     page ```html-interactif (conv-1304, 2026-10-30) : la scène y tourne DANS la place `dkc-3d`,
 *     au-dessus des fiches, et suit le rang affiché par `autowin.surChoix((n) => …)`, qu'elle DOIT
 *     écouter. Ses boutons y REMPLISSENT la saisie au lieu d'envoyer (src/renderer/src/components/
 *     saisie-du-fil.ts) : le code de la page tourne, l'utilisateur relit le choix avant de l'envoyer.
 *     Avant, la scène sortait en clôture ```threejs à part, que le fil montait dans le carrousel.
 *   Sortie : le fichier .md avec la clôture ```html-render — ou ```html-interactif avec une scène —,
 *   à contrôler par scripts/html-render-apercu.mjs (code 0) — html-interactif-apercu.mjs et
 *   scene-3d-apercu.mjs pour une scène — puis à poser dans le fil par la commande `montrer_bloc`
 *   (conv-1306 : recopié à la main, un carrousel de 52 ko ne tenait plus dans la réponse).
 *   Codes : 0 = écrit ; 2 = usage ou propositions invalides (raisons sur stdout) ; 1 = erreur.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CLASSE_PLACE_SCENE } from '../src/renderer/scene-3d/choix-scene.mjs'

/** La transition C « Pile de cartes », réglée pendant le /draft (tour 3, conv-302). */
export const TRANSITION = { duree: 0.45, courbe: 'cubic-bezier(.2,.8,.2,1)' }

/** Les boutons d'une proposition ; `{n}` et `{nom}` sont remplis. Le premier est le principal. */
export const BOUTONS_PAR_DEFAUT = ['Affiner la {n} · {nom}', 'Implémenter la {n} · {nom}']

const ECART_VIGNETTES = 6

/**
 * Au-delà, pas de Mixer : 2^n − n − 1 mélanges précalculés (57 pour 6, 1 013 pour 10), de deux liens
 * chacun, à recopier.
 */
export const MIXER_MAX = 6

const echapper = (texte) =>
  String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Les raisons pour lesquelles ces propositions ne peuvent pas devenir un carrousel ; [] si aucune. */
export function verifierPropositions(spec) {
  if (!spec || typeof spec !== 'object') return ['spécification absente']
  const erreurs = []
  if (!spec.titre) erreurs.push('« titre » manquant')
  for (const cle of ['boutons', 'boutonsFixes'])
    if (
      spec[cle] !== undefined &&
      !(Array.isArray(spec[cle]) && spec[cle].every((t) => typeof t === 'string' && t.trim()))
    )
      erreurs.push(`« ${cle} » : une liste de libellés attendue`)
  if (spec.scene3d !== undefined) {
    if (typeof spec.scene3d !== 'string' || !spec.scene3d.trim())
      erreurs.push('« scene3d » : le code three.js de la scène attendu')
    else {
      // Une scène qui n'écoute pas le rang montrerait la même vue sous toutes les propositions.
      if (!/\bautowin\.surChoix\s*\(/.test(spec.scene3d))
        erreurs.push(
          '« scene3d » : la scène doit suivre la proposition affichée — autowin.surChoix((n) => …)'
        )
      if (/^\s*(`{3,}|~{3,})/m.test(spec.scene3d))
        erreurs.push('« scene3d » : une ligne en ``` fermerait la clôture de la scène')
      if (/<\/script/i.test(spec.scene3d))
        erreurs.push('« scene3d » : « </script » fermerait le script de la scène dans la page')
    }
  }
  if (spec.mixer !== undefined && typeof spec.mixer !== 'boolean')
    erreurs.push('« mixer » : true ou false attendu')
  const propositions = spec.propositions
  if (!Array.isArray(propositions) || propositions.length < 2 || propositions.length > 10) {
    erreurs.push('« propositions » : de 2 à 10 attendues')
    return erreurs
  }
  if (spec.mixer === true && propositions.length > MIXER_MAX)
    erreurs.push(
      `« mixer » : ${MIXER_MAX} propositions au plus — il en faudrait ${2 ** propositions.length - propositions.length - 1} boutons précalculés`
    )
  propositions.forEach((p, i) => {
    const rang = `proposition ${i + 1}`
    if (!p?.nom) erreurs.push(`${rang} : « nom » manquant`)
    if (typeof p?.html !== 'string' || !p.html.trim()) {
      erreurs.push(`${rang} : « html » manquant`)
      return
    }
    if (/<(input|label)\b/i.test(p.html))
      erreurs.push(
        `${rang} : <input> et <label> interdits — ils piloteraient le carrousel lui-même`
      )
    if (/<(style|script)\b/i.test(p.html))
      erreurs.push(`${rang} : <style> ou <script> interdit dans « html » — le CSS va dans « css »`)
    if (/class\s*=\s*["'][^"']*\bdkc-/i.test(p.html))
      erreurs.push(`${rang} : le préfixe de classe « dkc- » est réservé au carrousel`)
  })
  return erreurs
}

/** La copie d'une maquette pour sa vignette : ses `id` renommés, pour ne pas exister en double. */
function copieVignette(html) {
  return html
    .replace(/\bid="([^"]+)"/g, 'id="$1-v"')
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, 'url(#$1-v)')
}

/**
 * Le style du Mixer — ses cases, sa consigne, ses mélanges. Chaque mélange porte `dkc-yK` pour chaque
 * proposition K qu'il nomme : la case K décochée cache ceux qui la nomment, cochée ceux qui l'ignorent.
 * Chaque case suit IMMÉDIATEMENT son champ (`input:checked+.dkc-mc`) : une règle pour toutes, au lieu
 * d'une par proposition — le bloc est recopié tel quel par le modèle à chaque tour.
 */
function styleMixer(pour) {
  const mono = 'var(--mono,ui-monospace,Consolas,monospace)'
  const choisie =
    'background:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair)) padding-box,var(--dk-nacre) border-box'
  return `
.dkc-mc{display:none;flex:1 1 0;min-width:0;flex-wrap:nowrap;align-items:center;gap:6px;height:28px;margin:8px 0 0 ${ECART_VIGNETTES}px;padding:0 8px;box-sizing:border-box;border-radius:8px;border:1px solid transparent;background:linear-gradient(var(--dk-gris),var(--dk-gris)) padding-box,linear-gradient(var(--dk-gris),var(--dk-gris)) border-box;color:var(--dk-pale);font-size:11.5px;white-space:nowrap;overflow:hidden}
#dkmix:checked~.dkc-mc{display:flex}
#dkm1+.dkc-mc{margin-left:0}
.dkc-mc:hover{color:var(--dk-texte)}
.dkc-ck{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;box-sizing:border-box;border-radius:4px;border:1px solid transparent;background:linear-gradient(var(--dk-plaque),var(--dk-plaque)) padding-box,linear-gradient(var(--dk-pale),var(--dk-pale)) border-box}
.dkc-ck svg{display:none;width:10px;height:10px}
.dkc-mct{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dkc-mct b{font:600 11px ${mono};color:var(--dk-rose);margin-right:4px}
.dkc-car>input:checked+.dkc-mc{color:var(--dk-texte);${choisie}}
.dkc-car>input:checked+.dkc-mc .dkc-ck{background:var(--dk-degrade) border-box}
.dkc-car>input:checked+.dkc-mc .dkc-ck svg{display:block}
.dkc-mxa{display:none;flex-wrap:wrap;gap:8px}
.dkc-mxa>*{flex-wrap:wrap;gap:8px}
#dkmix:checked~.dkc-act .dkc-mxa,#dkmix:checked~.dkc-act .dkc-mxa>*{display:inline-flex}
${pour((i) => `#dkm${i}:not(:checked)~.dkc-act .dkc-mxa>.dkc-y${i},#dkm${i}:checked~.dkc-act .dkc-mxa>*:not(.dkc-y${i}){display:none}`)}
#dkmix:checked~.dkc-act span.dkc-ac{display:none}
.dkc-mxh{align-items:center;min-height:32px;color:var(--dk-dim);font-size:12.5px}
.dkc-mxt{gap:7px;border:1px solid transparent;background:linear-gradient(var(--dk-gris),var(--dk-gris)) padding-box,linear-gradient(var(--dk-gris),var(--dk-gris)) border-box}
.dkc-mxt:hover,#dkmix:checked~.dkc-act .dkc-mxt{${choisie}}
.dkc-mxt svg{display:block;flex:0 0 auto;width:15px;height:15px}
.dkc-mxf{display:none}
#dkmix:checked~.dkc-act .dkc-mxf{display:inline}
#dkmix:checked~.dkc-act .dkc-mxo{display:none}
#dkmix:not(:checked)~.dkc-act .dkc-mxo{display:inline}`
}

function feuilleDeStyle(n, cssPropositions, avecScene = false, avecMixer = false) {
  // La place de la scène a SA hauteur, tirée de sa largeur (et non du contenu : `overflow:hidden`
  // retire le minimum automatique d'un `aspect-ratio`) — une scène qui se cale sur `innerHeight` ne
  // peut donc pas faire grandir la page en boucle.
  const styleScene = avecScene
    ? `.dkc-mid{min-width:0;display:flex;flex-direction:column;flex-wrap:nowrap;gap:10px}\n.${CLASSE_PLACE_SCENE}{position:relative;min-width:0;min-height:200px;max-height:380px;aspect-ratio:16/9;overflow:hidden;border-radius:10px}\n.${CLASSE_PLACE_SCENE} canvas{display:block}`
    : ''
  const D = `${TRANSITION.duree}s`
  const E = TRANSITION.courbe
  const rangs = Array.from({ length: n }, (_, i) => i + 1)
  const pour = (f) => rangs.map(f).filter(Boolean).join('\n')
  const mouvement = `transform ${D} ${E},opacity ${D} ${E}`
  return `
.dkc-w{--dk-texte:var(--text,#ece8f7);--dk-dim:var(--text-dim,#b9b2d4);--dk-pale:var(--text-faint,#8f89ad);--dk-fond:var(--bg-0,#0a0a0a);--dk-bleu:var(--violet,#3c6eeb);--dk-rose:var(--rose,#e63ca0);--dk-degrade:var(--nv-degrade,linear-gradient(135deg,#3c6eeb,#e63ca0));--dk-plaque:color-mix(in srgb,var(--dk-texte) 9%,var(--dk-fond));--dk-gris:color-mix(in srgb,var(--dk-texte) 14%,var(--dk-fond));--dk-gris-clair:color-mix(in srgb,var(--dk-texte) 21%,var(--dk-fond));--dk-nacre:linear-gradient(100deg,var(--dk-bleu) 0%,var(--dk-rose) 30%,#d9d9d9 55%,#ff8cc8 78%,var(--dk-bleu) 100%);font:14px/1.5 var(--font,'Segoe UI',system-ui,sans-serif);color:var(--dk-texte)}
.dkc-hd{font:600 11px/1.3 var(--mono,ui-monospace,Consolas,monospace);letter-spacing:.09em;text-transform:uppercase;color:var(--dk-texte);margin:0 0 4px}
.dkc-intro{color:var(--dk-dim);font-size:13px;margin:0 0 4px}
.dkc-aide{color:var(--dk-pale);font-size:12px;margin:0 0 8px}
.dkc-intro b,.dkc-aide b{color:var(--dk-texte)}
.dkc-car{display:flex;flex-wrap:wrap;align-items:center;padding:12px 10px 10px;border:1px solid transparent;border-radius:14px;background:linear-gradient(var(--dk-plaque),var(--dk-plaque)) padding-box,var(--dk-nacre) border-box}
.dkc-car>input{display:none}
.dkc-car label{cursor:pointer}
.dkc-tog{order:-1;flex:1 1 auto;display:inline-flex;flex-wrap:nowrap;align-items:center;gap:8px;margin-bottom:10px;font:600 11px/1 var(--mono,ui-monospace,Consolas,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--dk-dim)}
.dkc-sw{display:inline-flex;flex-wrap:nowrap;justify-content:flex-start;width:32px;height:18px;padding:2px;box-sizing:border-box;border-radius:99px;background-image:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair))}
.dkc-sw>span{display:block;width:14px;height:14px;border-radius:50%;background-image:linear-gradient(#ffffff,#ffffff)}
#dkall:checked~.dkc-tog .dkc-sw{justify-content:flex-end;background-image:var(--dk-degrade)}
#dkall:checked~.dkc-tog{color:var(--dk-texte)}
.dkc-nav{display:inline-flex;margin-bottom:10px}
#dkall:checked~.dkc-nav{display:none}
#dkall:not(:checked)~.dkc-nav{display:inline-flex}
.dkc-q{display:none;font:11px/1 var(--mono,ui-monospace,Consolas,monospace);color:var(--dk-pale)}
${pour((i) => `#dkp${i}:checked~.dkc-nav .dkc-q${i}{display:inline}`)}
.dkc-gtx{display:none;margin-bottom:10px;font:11px/1 var(--mono,ui-monospace,Consolas,monospace);color:var(--dk-pale)}
#dkall:checked~.dkc-gtx{display:inline}
.dkc-stg{flex:0 0 100%;max-width:100%;min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:10px}
${styleScene}
#dkall:checked~.dkc-stg{display:none}
#dkall:not(:checked)~.dkc-stg{display:grid}
.dkc-cote{display:flex}
.dkc-fc{display:none;align-items:center;justify-content:center;width:38px;height:38px;box-sizing:border-box;border-radius:50%;border:1px solid transparent;background:linear-gradient(var(--dk-gris),var(--dk-gris)) padding-box,linear-gradient(var(--dk-gris),var(--dk-gris)) border-box;color:var(--dk-texte)}
label.dkc-fc:hover{background:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair)) padding-box,var(--dk-nacre) border-box}
.dkc-fc svg{display:block;width:18px;height:18px}
.dkc-off{opacity:.3}
${pour((i) => `#dkp${i}:checked~.dkc-stg .dkc-fc${i}{display:inline-flex}`)}
.dkc-trk{display:grid;min-width:0;overflow:hidden}
.dkc-sl{grid-area:1/1;min-width:0;box-sizing:border-box;background-image:linear-gradient(var(--dk-plaque),var(--dk-plaque));transform:scale(.9);opacity:.35;clip-path:inset(0 0 0 100%);transition:${mouvement},clip-path 0s linear ${D}}
${pour((i) => `#dkp${i}:checked~.dkc-stg .dkc-s${i}{transform:none;opacity:1;clip-path:inset(0 0 0 0);transition:${mouvement},clip-path 0s}`)}
${pour((i) => (i < n ? `#dkp${i}:checked~.dkc-stg .dkc-s${i}~.dkc-sl{transform:translateX(102%);opacity:1}` : ''))}
.dkc-sh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0 0 8px}
.dkc-no{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background-image:var(--dk-degrade);font:600 11px/1 var(--mono,ui-monospace,Consolas,monospace);color:#ffffff;-webkit-text-fill-color:#ffffff}
.dkc-nm{color:var(--dk-texte);font-size:15px;font-weight:600}
.dkc-sd{color:var(--dk-dim);font-size:12.5px}
.dkc-mq{display:block}
.dkc-film{flex:0 0 100%;display:flex;flex-wrap:nowrap;gap:${ECART_VIGNETTES}px;margin-top:12px}
.dkc-th{flex:1 1 0;min-width:0;display:flex;flex-direction:column;flex-wrap:nowrap;gap:5px;padding:0 0 4px;box-sizing:border-box;border:1px solid transparent;border-radius:12px;color:var(--dk-pale);opacity:.65;transition:opacity .2s}
.dkc-th:hover{opacity:1}
.dkc-mini{display:block;height:46px;overflow:hidden;border-radius:10px;border:1px solid transparent;background:linear-gradient(var(--dk-gris),var(--dk-gris)) padding-box,linear-gradient(var(--dk-gris),var(--dk-gris)) border-box}
.dkc-zm{display:block;zoom:.22;pointer-events:none}
.dkc-thl{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dkc-thl b{font:600 11px var(--mono,ui-monospace,Consolas,monospace);color:var(--dk-rose);margin-right:5px}
.dkc-thd{display:none;font-size:11.5px;line-height:1.35;color:var(--dk-pale)}
${pour((i) => `#dkp${i}:checked~.dkc-film .dkc-t${i}{opacity:1;color:var(--dk-texte)}`)}
${pour((i) => `#dkp${i}:checked~.dkc-film .dkc-t${i} .dkc-mini{background:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair)) padding-box,var(--dk-nacre) border-box}`)}
#dkall:checked~.dkc-film{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:0}
#dkall:checked~.dkc-film .dkc-th{opacity:1;padding:6px 6px 8px;background:linear-gradient(var(--dk-gris),var(--dk-gris)) padding-box,linear-gradient(var(--dk-gris),var(--dk-gris)) border-box}
#dkall:checked~.dkc-film .dkc-mini{height:auto;border-radius:8px}
#dkall:checked~.dkc-film .dkc-zm{zoom:.45}
#dkall:checked~.dkc-film .dkc-thd{display:block}
${pour((i) => `#dkp${i}:checked~#dkall:checked~.dkc-film .dkc-t${i}{background:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair)) padding-box,var(--dk-nacre) border-box}`)}
@media (max-width:600px){#dkall:checked~.dkc-film{grid-template-columns:repeat(2,minmax(0,1fr))}.dkc-stg{column-gap:6px}.dkc-fc{width:32px;height:32px}}
.dkc-ibar{flex:0 0 100%;height:2px;margin-top:2px;border-radius:2px;background-image:linear-gradient(var(--dk-gris),var(--dk-gris))}
#dkall:checked~.dkc-ibar{display:none}
#dkall:not(:checked)~.dkc-ibar{display:block}
.dkc-ind{display:block;width:calc((100% - ${(n - 1) * ECART_VIGNETTES}px) / ${n});height:2px;border-radius:2px;background-image:var(--dk-degrade);transition:transform ${D} ${E}}
${pour((i) => (i > 1 ? `#dkp${i}:checked~.dkc-ibar .dkc-ind{transform:translateX(calc(${(i - 1) * 100}% + ${(i - 1) * ECART_VIGNETTES}px))}` : ''))}
.dkc-act{flex:0 0 100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line,rgba(255,255,255,.11))}
.dkc-ac{display:none;flex-wrap:wrap;gap:8px}
${pour((i) => `#dkp${i}:checked~.dkc-act .dkc-a${i}{display:inline-flex}`)}
.dkc-bt,.dkc-mxa a{display:inline-flex;align-items:center;min-height:32px;padding:0 14px;box-sizing:border-box;border-radius:999px;border:0;background-image:linear-gradient(var(--dk-gris),var(--dk-gris));color:var(--dk-texte);font-size:12.5px;font-weight:600;line-height:1.2;text-decoration:none;white-space:nowrap;cursor:pointer}
.dkc-bt:hover,.dkc-mxa a:hover{background-image:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair))}
.dkc-bt1,.dkc-mxa a:first-child{background-image:radial-gradient(55% 85% at 50% 0%,rgba(255,255,255,.4),rgba(255,255,255,.1) 55%,rgba(255,255,255,0) 100%),var(--dk-degrade);color:#ffffff;-webkit-text-fill-color:#ffffff}
.dkc-bt1:hover,.dkc-mxa a:first-child:hover{background-image:radial-gradient(55% 85% at 50% 0%,rgba(255,255,255,.56),rgba(255,255,255,.14) 55%,rgba(255,255,255,0) 100%),var(--dk-degrade)}
.dkc-bt1:active,.dkc-mxa a:first-child:active{background-image:radial-gradient(55% 85% at 50% 0%,rgba(255,255,255,.12),rgba(255,255,255,.03) 55%,rgba(255,255,255,0) 100%),var(--dk-degrade)}
.dkc-btx{margin-left:auto;color:var(--dk-dim);font-weight:400}
${avecMixer ? styleMixer(pour) : ''}
${cssPropositions}
`
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Le contenu du bloc ```html-render (sans la clôture). Lève une erreur si les propositions sont invalides. */
export function carrouselDraft(spec) {
  const erreurs = verifierPropositions(spec)
  if (erreurs.length) throw new Error(erreurs.join(' ; '))
  const P = spec.propositions.map((p, i) => ({ ...p, n: i + 1 }))
  const n = P.length
  const cssPropositions = [spec.css, ...P.map((p) => p.css)].filter(Boolean).join('\n')
  const avecMixer = spec.mixer ?? n <= MIXER_MAX

  // FLÈCHES DE CÔTÉ (demande utilisateur, 2026-10-17 : « des flèches à gauche et à droite du draft,
  // pas juste un ptit truc de pagination en haut à droite ») : une colonne de chaque côté de la
  // scène ; chaque rang y a sa paire, montrée seulement quand il est coché.
  const chevron = (sens) =>
    `<svg viewBox="0 0 16 16"><path d="${sens < 0 ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  const fleche = (rang, cible, sens) =>
    cible
      ? `<label for="dkp${cible}" class="dkc-fc dkc-fc${rang}">${chevron(sens)}</label>`
      : `<span class="dkc-fc dkc-fc${rang} dkc-off">${chevron(sens)}</span>`
  const tete = (p) =>
    `<span class="dkc-sh"><b class="dkc-no">${p.n}</b><b class="dkc-nm">${echapper(p.nom)}</b>${p.resume ? `<span class="dkc-sd">${echapper(p.resume)}</span>` : ''}</span>`

  const champs =
    P.map(
      (p) => `<input type="radio" name="dkp" id="dkp${p.n}"${p.n === 1 ? ' checked' : ''}>`
    ).join('') +
    // L'interrupteur du Mixer ; ses cases, elles, suivent chacune son libellé (`casesMixer`).
    (avecMixer ? '<input type="checkbox" id="dkmix">' : '') +
    '<input type="checkbox" id="dkall">'
  // « Tout voir » est le DERNIER libellé du document (placé en tête à l'écran par `order:-1`) : un
  // parcours dans l'ordre — clavier, lecteur d'écran, scripts/html-render-apercu.mjs — traverse
  // d'abord le carrousel, puis la grille. Premier, il faisait tout parcourir en mode grille, où
  // choisir une carte ne déplace qu'un liseré (contrôle en code 5, conv-302).
  const interrupteur =
    '<label for="dkall" class="dkc-tog"><span class="dkc-sw"><span></span></span>Tout voir</label>'
  const navigation = `<span class="dkc-nav">${P.map(
    (p) => `<span class="dkc-q dkc-q${p.n}">${p.n} / ${n}</span>`
  ).join(
    ''
  )}</span><span class="dkc-gtx">les ${n} côte à côte · clique une carte pour la choisir</span>`
  const cote = (sens) =>
    `<span class="dkc-cote">${P.map((p) => {
      const cible = p.n + sens
      return fleche(p.n, cible >= 1 && cible <= n ? cible : 0, sens)
    }).join('')}</span>`
  const piste = `<div class="dkc-trk">\n${P.map(
    (p) => `<div class="dkc-sl dkc-s${p.n}">${tete(p)}<div class="dkc-mq">${p.html}</div></div>`
  ).join('\n')}\n</div>`
  // SUJET EN VOLUME (conv-318) : la place de la scène 3D, entre les flèches, au-dessus des fiches.
  const milieu = spec.scene3d
    ? `<div class="dkc-mid"><div class="${CLASSE_PLACE_SCENE}"></div>${piste}</div>`
    : piste
  const scene = `<div class="dkc-stg">${cote(-1)}${milieu}${cote(1)}</div>`
  const vignettes = `<div class="dkc-film">\n${P.map(
    (p) =>
      `<label for="dkp${p.n}" class="dkc-th dkc-t${p.n}"><span class="dkc-mini"><span class="dkc-zm">${copieVignette(p.html)}</span></span><span class="dkc-thl"><b>${p.n}</b>${echapper(p.nom)}</span>${p.resume ? `<span class="dkc-thd">${echapper(p.resume)}</span>` : ''}</label>`
  ).join('\n')}\n</div>`
  // BOUTONS « PROMPTER » (conv-302 : « faut un bouton pour prompter au lieu du bloc ask ») : des liens
  // `#autowin-prompt`, que le fil envoie comme une réponse `ask` — leur libellé VISIBLE est le message
  // (src/renderer/src/components/bouton-prompt-html.ts). Ceux d'une proposition suivent la sélection.
  const lien = (texte, classe = '') =>
    `<a href="#autowin-prompt" class="dkc-bt${classe ? ` ${classe}` : ''}">${echapper(texte)}</a>`
  const remplir = (modele, p) => modele.replaceAll('{n}', String(p.n)).replaceAll('{nom}', p.nom)
  const modeles = spec.boutons ?? BOUTONS_PAR_DEFAUT
  const fixes = spec.boutonsFixes ?? [`Aucune : propose ${n} autres directions`]
  // MIXER (conv-321) : une case sous chaque vignette, puis un lien par mélange possible — seul celui
  // dont les cases sont EXACTEMENT les cochées reste visible (voir l'en-tête et `styleMixer`). Les
  // cases sont des enfants DIRECTS du carrousel, chacune juste après son champ : `.dkc-car` passe à
  // la ligne après la barre d'index, elles se partagent la ligne suivante, alignées sur les vignettes.
  const coche =
    '<svg viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" fill="none" stroke="#ffffff" stroke-width="1.8"/></svg>'
  const casesMixer = avecMixer
    ? P.map(
        (p) =>
          `<input type="checkbox" id="dkm${p.n}"><label for="dkm${p.n}" class="dkc-mc"><span class="dkc-ck">${coche}</span><span class="dkc-mct"><b>${p.n}</b>${echapper(p.nom)}</span></label>`
      ).join('\n') + '\n'
    : ''
  const ensembles = Array.from({ length: 2 ** n }, (_, masque) =>
    P.filter((p) => masque & (1 << (p.n - 1))).map((p) => p.n)
  ).sort((a, b) => a.length - b.length)
  const marques = (ensemble) => ensemble.map((k) => `dkc-y${k}`).join(' ')
  // Un mélange = UN groupe de deux liens (conv-321, 2026-10-18 : « Implémenter 2 + 6 à côté de
  // Mixer 2 + 6 ») : les classes `dkc-yK` du groupe décident pour les deux à la fois.
  const lienMelange = (verbe, ensemble) =>
    `<a href="#autowin-prompt">${verbe} ${ensemble.join(' + ')}</a>`
  const melange = (ensemble) =>
    ensemble.length >= 2
      ? `<span class="${marques(ensemble)}">${lienMelange('Mixer', ensemble)}${lienMelange('Implémenter', ensemble)}</span>`
      : `<span class="dkc-mxh${ensemble.length ? ` ${marques(ensemble)}` : ''}">${
          ensemble.length
            ? `Mixer ${ensemble[0]} + … coche-en au moins une autre`
            : 'Coche au moins 2 propositions à mixer'
        }</span>`
  const mixer = avecMixer
    ? `<span class="dkc-mxa">${ensembles.map(melange).join('')}</span>` +
      '<label for="dkmix" class="dkc-bt dkc-mxt"><svg viewBox="0 0 16 16"><circle cx="6" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span class="dkc-mxo">Mixer</span><span class="dkc-mxf">Annuler le mix</span></label>'
    : ''
  const actions = `<div class="dkc-act">${P.map(
    (p) =>
      `<span class="dkc-ac dkc-a${p.n}">${modeles.map((m, i) => lien(remplir(m, p), i === 0 ? 'dkc-bt1' : '')).join('')}</span>`
  ).join('')}${mixer}${fixes.map((texte) => lien(texte, 'dkc-btx')).join('')}</div>`

  return `<style>
${feuilleDeStyle(n, cssPropositions, Boolean(spec.scene3d), avecMixer)}
</style>
<div class="dkc-w">
<div class="dkc-hd">${echapper(spec.titre)}</div>
${spec.intro ? `<div class="dkc-intro">${spec.intro}</div>\n` : ''}<div class="dkc-aide"><b>Clique une vignette</b> ou les <b>flèches</b> de chaque côté pour passer d’une proposition à l’autre · <b>Tout voir</b> les étale côte à côte · <b>choisis</b> avec les boutons du bas${spec.scene3d ? ' (ils remplissent ta saisie : <b>Entrée</b> pour envoyer)' : ''}, ${avecMixer ? 'ou <b>Mixer</b> pour en cocher plusieurs à mélanger.' : 'ou écris un mélange dans la saisie.'}</div>
<div class="dkc-car">${champs}
${navigation}
${scene}
${vignettes}
<div class="dkc-ibar"><span class="dkc-ind"></span></div>
${casesMixer}${actions}
${interrupteur}
</div>
</div>`
}

/**
 * La scène écrite pour un CADRE ENTIER, posée dans la place `dkc-3d` de la page (conv-1304). Elle
 * garde les habitudes d'un bloc ```threejs : `innerWidth`/`innerHeight` rendent la taille de la
 * place, « resize » suit la place, et ce qu'elle ajoute à `document.body` (son canvas) y est déplacé.
 * Le rang affiché sort des cases radio du carrousel, lues à chaque `change`, et il est RETENU dans
 * le localStorage de la page (gardé par le fil) : une page 3D est démontée loin de l'écran
 * (BlocHtmlInteractif.tsx) et revient sur la proposition qu'on regardait. Script SÉPARÉ de celui
 * de la scène : une erreur de la scène reste dite à SA ligne du bloc.
 */
export const SCRIPT_PLACE_SCENE = `;(() => {
  const place = document.querySelector('.${CLASSE_PLACE_SCENE}')
  if (!place) return
  const cases = Array.from(document.querySelectorAll('.dkc-car > input[type="radio"]'))
  const rang = () => Math.max(1, cases.findIndex((c) => c.checked) + 1)
  const retenu = Number(localStorage.getItem('dkc-choix'))
  if (retenu >= 1 && retenu <= cases.length) cases[retenu - 1].checked = true
  const ecouteurs = []
  const autowin = window.autowin || (window.autowin = {})
  autowin.choix = rang()
  autowin.surChoix = (fn) => {
    if (typeof fn !== 'function') return
    ecouteurs.push(fn)
    fn(autowin.choix)
  }
  document.addEventListener('change', () => {
    const n = rang()
    if (n === autowin.choix) return
    autowin.choix = n
    localStorage.setItem('dkc-choix', String(n))
    for (const fn of ecouteurs) fn(n)
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => place.clientWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => place.clientHeight })
  new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(place)
  new MutationObserver((changements) => {
    for (const changement of changements)
      for (const noeud of changement.addedNodes)
        if (noeud.nodeType === 1 && noeud.id !== 'autowin-scene-3d-erreur') place.appendChild(noeud)
  }).observe(document.body, { childList: true })
})()`

/** Attribut du script de la scène dans la page : scene-3d-apercu.mjs le retrouve par lui. */
export const ATTRIBUT_SCRIPT_SCENE = 'data-dkc-scene'

/** La page ```html-interactif d'un carrousel EN VOLUME : le carrousel, puis sa scène. */
export function pageDuCarrousel3d(spec) {
  if (!spec?.scene3d) throw new Error('« scene3d » absent : le carrousel reste un html-render')
  return (
    carrouselDraft(spec) +
    `\n<script>\n${SCRIPT_PLACE_SCENE}\n</script>\n<script ${ATTRIBUT_SCRIPT_SCENE}>\n` +
    spec.scene3d.trim() +
    '\n</script>'
  )
}

/**
 * Le bloc complet, clôture comprise, prêt à recopier dans la réponse : ```html-render sans scène,
 * ```html-interactif avec (la scène tourne dans la page, voir `pageDuCarrousel3d`).
 */
export const blocDuCarrousel = (spec) =>
  spec.scene3d
    ? '```html-interactif\n' + pageDuCarrousel3d(spec) + '\n```\n'
    : '```html-render\n' + carrouselDraft(spec) + '\n```\n'

const lanceEnCli = Boolean(
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/draft-carrousel.mjs')
)
if (lanceEnCli) {
  const sortir = (code, rapport) => {
    process.stdout.write(JSON.stringify(rapport, null, 2) + '\n')
    process.exit(code)
  }
  const fichier = process.argv[2]
  if (!fichier || fichier.startsWith('--'))
    sortir(2, {
      ok: false,
      erreur: 'usage : node scripts/draft-carrousel.mjs <propositions.json> [--out <tour.md>]'
    })
  try {
    const spec = JSON.parse(readFileSync(fichier, 'utf8'))
    const erreurs = verifierPropositions(spec)
    if (erreurs.length) sortir(2, { ok: false, erreurs })
    const i = process.argv.indexOf('--out')
    const sortie = resolve(
      i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fichier.replace(/\.json$/i, '') + '.md'
    )
    const bloc = blocDuCarrousel(spec)
    mkdirSync(dirname(sortie), { recursive: true })
    writeFileSync(sortie, bloc)
    sortir(0, {
      ok: true,
      fichier: sortie,
      propositions: spec.propositions.length,
      octets: Buffer.byteLength(bloc),
      suite:
        (spec.scene3d
          ? `node scripts/html-interactif-apercu.mjs "${sortie}" et ` +
            `node scripts/scene-3d-apercu.mjs "${sortie}" (code 0 exigé pour chacun)`
          : `node scripts/html-render-apercu.mjs "${sortie}" (code 0 exigé)`) +
        ', puis pose-le dans le fil avec la commande montrer_bloc (path = ce fichier) : ne le recopie pas'
    })
  } catch (erreur) {
    sortir(1, { ok: false, erreur: String(erreur?.message ?? erreur) })
  }
}
