#!/usr/bin/env node
/**
 * GENERATEUR du theme « Nebuleuse de verre » -- couches de couleurs ecrites EN DUR.
 *
 * Pourquoi : un theme Autowin ne redefinit que des jetons (theme-modes.css), or 2 637 couleurs
 * sont ecrites en dur dans 56 feuilles (mesure du 2026-10-09, conv-124) -- dont plus de 250 ors
 * de la marque, des cyans HUD et des noirs bleutes. Sans ce fichier, le theme ne repeignait que
 * le cadre : chaque vue gardait ses bords dores et ses fonds bleu-noir.
 *
 * Ce que fait le script : il relit chaque feuille de src/renderer/src (sauf les themes clair,
 * malvoyant et ce theme), garde les declarations qui contiennent une couleur des familles
 * DECORATIVES ci-dessous, et ecrit la meme regle prefixee par :root[data-theme='nebuleuse-verre']
 * avec la couleur transposee. Le reste du fichier source n'est jamais touche.
 *
 * Familles transposees (alpha toujours conserve) :
 *   - OR de la marque (liste EXACTE, pas une plage de teinte : les jaunes d'ETAT -- question,
 *     alerte, quota -- portent un sens et restent) -> rose ;
 *   - CYAN / bleu HUD (teinte 185-212 deg, saturation >= 45 %) -> violet-bleu ;
 *   - ROSE d'Autowin (teinte 318-342 deg) -> rose du theme ;
 *   - NOIRS bleutes et noirs purs EN FOND (luminosite < 9 %) -> encre violette, meme opacite ;
 *   - VERTS (teinte 85-178 deg, turquoises compris) -> LE vert du theme, #00ff55 (voir transposerVert) : un vert
 *     reste un vert, il perd seulement sa nuance propre.
 * Rien d'autre : blancs, gris, rouges et jaunes d'etat restent intacts.
 *
 * Regenerer apres une modification de style : node scripts/theme-nebuleuse-verre.mjs
 * Le fichier produit est importe AVANT theme-nebuleuse-verre.css, dont les regles ecrites a la
 * main gagnent donc a specificite egale.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postcss from 'postcss'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['src/renderer/src/components', 'src/renderer/src/assets']
// fix-ok: le nom du theme etait ecrit en dur (prefixe + fichier de sortie) ; mesure : sans argument la sortie nebuleuse-verre est identique octet par octet (cmp exit 0), avec nebuleuse-doree 0 #ff3d9a/#7b5cff (test 6/6).
// Deux themes partagent ce generateur : « nebuleuse-verre » (rose/violet, par defaut) et
// « nebuleuse-doree » (or et noir, conv-139). Choix : node scripts/theme-nebuleuse-verre.mjs [id]
const THEME = process.argv[2] === 'nebuleuse-doree' ? 'nebuleuse-doree' : 'nebuleuse-verre'
const DORE = THEME === 'nebuleuse-doree'
const SORTIE = `src/renderer/src/assets/theme-${THEME}.genere.css`
const PREFIXE = `:root[data-theme='${THEME}']`
// AskDecision.css garde son OR (conv-136, 2026-10-10 : « les blocs comme ASK qui demandent des
// actions utilisateur, mets-les en doré ») : le bloc qui attend l'utilisateur ressort du rose.
const EXCLUS = /theme-clair|theme-malvoyant|theme-nebuleuse-verre|theme-nebuleuse-doree|AskDecision.css/

/** L'or d'Autowin, tel qu'il est ecrit dans les feuilles (rgb sans alpha). */
const ORS = new Set([
  '212,169,79',
  '233,189,78',
  '227,186,85',
  '255,212,90',
  '212,175,55',
  '225,193,103',
  '154,111,16',
  '240,194,116',
  '221,173,74',
  '229,184,91',
  '218,184,94',
  '90,70,40',
  '255,220,115',
  '242,201,76',
  '244,204,104',
  '224,193,111',
  '217,183,104',
  '173,143,73',
  '195,157,85',
  '214,173,96',
  '230,195,131',
  '255,215,154',
  '228,199,123',
  '212,169,105',
  '201,162,74',
  '184,147,63',
  '155,123,51',
  '138,109,42',
  '233,196,106',
  '255,228,150',
  // Ors DECORATIFS releves un par un le 2026-10-09 (titres du Brain, onglets actifs de
  // l'Observatory, bouton « aller en bas », note d'autorite, cadre de fin de tour...).
  // Les jaunes d'ETAT voisins (avertissement, fichier modifie, nouvel essai, quota tendu,
  // doublon, seuil Jarvis, couleur choisie par l'utilisateur) n'y sont PAS, a dessein.
  '234,209,139',
  '240,230,210',
  '201,167,93',
  '226,189,85',
  '240,217,140',
  '198,165,76',
  '235,200,106',
  '255,240,200',
  '217,189,120',
  '231,207,150',
  '215,180,92',
  '232,206,145',
  '255,226,163',
  '203,145,43',
  '137,91,23',
  '230,207,157',
  '255,211,111',
  '240,217,168',
  '217,183,104',
  '239,189,87',
  '216,183,101',
  '224,180,55',
  '216,178,106',
  '246,200,117',
  '242,201,76',
  '230,195,105'
])

const PROPRIETES_COULEUR =
  /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|border-image|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|column-rule|filter|--[a-z0-9-]+)$/

function hexVersRgb(hex) {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  const n = (i) => parseInt(h.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
}

function rgbVersHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0)
  else if (max === G) h = (B - R) / d + 2
  else h = (R - G) / d + 4
  return { h: h * 60, s, l }
}

function hslVersRgb({ h, s, l }) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = (x) => {
    let v = x
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }
  const hh = h / 360
  return {
    r: Math.round(t(hh + 1 / 3) * 255),
    g: Math.round(t(hh) * 255),
    b: Math.round(t(hh - 1 / 3) * 255)
  }
}

const borne = (v, a, b) => Math.min(b, Math.max(a, v))

/**
 * UN SEUL VERT (conv-197, 2026-10-10) : 154 verts ecrits en dur dans 32 feuilles, en 65 nuances.
 * LE vert est #00ff55, « bien flashy » (choix de l'utilisateur, apres un premier essai en menthe
 * #4fd1a5) ; les deux themes Nebuleuse finissent aussi leur degrade de quota dessus. Moyens et
 * clairs le prennent tel quel ; un vert SOMBRE (fond, liseré fonce) prend sa teinte mais garde sa
 * luminosite, sinon un fond vert fonce deviendrait clair sous un texte clair. Les jaunes et ambres
 * d'etat (< 85 deg) et les cyans (> 178 deg, dont le cyan pur du logo a 182 deg) ne sont pas des
 * verts : ils ne passent pas ici.
 */
const VERT_THEME = { r: 0, g: 255, b: 85 }
const VERT_THEME_HSL = rgbVersHsl(VERT_THEME)

function transposerVert(cle, h, s, l) {
  if (cle === `${VERT_THEME.r},${VERT_THEME.g},${VERT_THEME.b}`) return null
  if (h < 85 || h > 178 || s < 0.3 || l < 0.12 || l > 0.9) return null
  if (l >= 0.4) return VERT_THEME
  return hslVersRgb({ h: VERT_THEME_HSL.h, s: VERT_THEME_HSL.s, l })
}

/** Rend la couleur transposee, ou null si elle n'appartient a aucune famille decorative. */
function transposer(rgb, enFond) {
  const cle = `${rgb.r},${rgb.g},${rgb.b}`
  const { h, s, l } = rgbVersHsl(rgb)
  if (DORE) return transposerDore(cle, h, s, l, enFond)
  const vert = transposerVert(cle, h, s, l)
  if (vert) return vert
  if (ORS.has(cle)) {
    // L'or parait plus clair qu'un rose de meme luminosite HSL : on remonte d'un cran.
    return hslVersRgb({ h: 330, s: borne(s + 0.35, 0.75, 1), l: borne(l + 0.1, 0.18, 0.86) })
  }
  if (h >= 185 && h <= 212 && s >= 0.45 && l >= 0.18) {
    return hslVersRgb({ h: 250, s: borne(s, 0.6, 1), l: borne(l + 0.04, 0.2, 0.86) })
  }
  if (h >= 318 && h <= 342 && s >= 0.5 && l >= 0.2) {
    return hslVersRgb({ h: 330, s: 1, l })
  }
  if (enFond && l < 0.09) {
    // Encre violette du theme (#0b0a18 = 11,10,24), a l'opacite d'origine.
    return { r: 10, g: 10, b: 10 } // noir, plus de bleu marine (conv-139)
  }
  return null
}

/** Variante or et noir : l'or reste, cyans et roses passent a l'or, fonds au noir chaud. */
function transposerDore(cle, h, s, l, enFond) {
  if (ORS.has(cle)) return null
  // La doree finit son degrade de quota sur le MEME vert : meme famille, meme cible.
  const vert = transposerVert(cle, h, s, l)
  if (vert) return vert
  if (h >= 185 && h <= 212 && s >= 0.45 && l >= 0.18) {
    return hslVersRgb({ h: 43, s: borne(s, 0.6, 0.85), l: borne(l, 0.3, 0.82) })
  }
  if (h >= 318 && h <= 342 && s >= 0.5 && l >= 0.2) {
    return hslVersRgb({ h: 43, s: 0.72, l: borne(l, 0.3, 0.8) })
  }
  if (enFond && l < 0.09) return { r: 12, g: 10, b: 6 }
  return null
}

const COULEUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g

function transposerValeur(valeur, enFond) {
  let change = false
  const sortie = valeur.replace(COULEUR, (brut) => {
    let rgb
    if (brut.startsWith('#')) {
      if (![4, 5, 7, 9].includes(brut.length)) return brut
      rgb = hexVersRgb(brut)
    } else {
      const n = brut.match(/[\d.]+/g).map(Number)
      rgb = { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
    }
    const t = transposer(rgb, enFond)
    if (!t) return brut
    change = true
    return rgb.a === 1 ? `rgb(${t.r}, ${t.g}, ${t.b})` : `rgba(${t.r}, ${t.g}, ${t.b}, ${rgb.a})`
  })
  return change ? sortie : null
}

function prefixer(selecteur) {
  const s = selecteur.trim()
  // Les regles d'un AUTRE theme ou du mode clair ne nous regardent pas.
  if (/:root\[|data-base|data-theme/.test(s)) return null
  if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, PREFIXE)
  return `${PREFIXE} ${s}`
}

function fichiers() {
  return SOURCES.flatMap((dossier) =>
    readdirSync(join(RACINE, dossier))
      .filter((f) => f.endsWith('.css') && !EXCLUS.test(f))
      .sort()
      .map((f) => join(RACINE, dossier, f))
  )
}

export function generer() {
  const blocs = []
  let regles = 0
  let declarations = 0
  for (const fichier of fichiers()) {
    const racine = postcss.parse(readFileSync(fichier, 'utf8'), { from: fichier })
    const sortie = postcss.root()
    racine.walkRules((regle) => {
      // Les images-cles n'ont pas de selecteur a prefixer : on les laisse.
      if (regle.parent?.type === 'atrule' && /keyframes/i.test(regle.parent.name)) return
      const selecteurs = regle.selectors.map(prefixer).filter(Boolean)
      if (selecteurs.length === 0) return
      const nouvelles = []
      regle.walkDecls((decl) => {
        if (decl.parent !== regle) return
        const prop = decl.prop.toLowerCase()
        if (!PROPRIETES_COULEUR.test(prop)) return
        const enFond = /^background/.test(prop)
        const valeur = transposerValeur(decl.value, enFond)
        if (valeur)
          nouvelles.push(
            postcss.decl({ prop: decl.prop, value: valeur, important: decl.important })
          )
      })
      if (nouvelles.length === 0) return
      const copie = postcss.rule({ selectors: selecteurs })
      copie.append(nouvelles)
      // Une regle sous @media / @supports garde son enveloppe.
      let cible = copie
      for (let p = regle.parent; p && p.type === 'atrule'; p = p.parent) {
        const enveloppe = postcss.atRule({ name: p.name, params: p.params })
        enveloppe.append(cible)
        cible = enveloppe
      }
      sortie.append(cible)
      regles += 1
      declarations += nouvelles.length
    })
    if (sortie.nodes.length > 0) {
      blocs.push(
        `/* ---- ${relative(RACINE, fichier).replace(/\\/g, '/')} ---- */\n${sortie.toString()}`
      )
    }
  }
  if (DORE) {
    const entete = `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree -- ne pas modifier.
   Theme « Nebuleuse doree » : cyan et rose -> or, noirs de fond -> noir chaud, verts -> #00ff55.
   ${regles} regles, ${declarations} declarations. */\n\n`
    return { css: entete + blocs.join('\n\n') + '\n', regles, declarations }
  }
  const entete = `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs -- ne pas modifier a la main.
   Theme « Nebuleuse de verre » : couleurs ecrites en dur, transposees (or -> rose,
   cyan -> violet, rose -> rose du theme, noirs de fond -> encre violette, verts -> #00ff55).
   ${regles} regles, ${declarations} declarations. Regenerer : node scripts/theme-nebuleuse-verre.mjs */\n\n`
  return { css: entete + blocs.join('\n\n') + '\n', regles, declarations }
}

/** Les jetons de saisie de Nebuleuse de verre -> ceux de Nebuleuse doree (voir genererMainDoree). */
const SAISIE_DOREE = [
  [
    '--nv-saisie-degrade: linear-gradient(#09090a, #09090a);',
    '--nv-saisie-degrade: linear-gradient(315deg, rgba(240, 207, 122, 0.42), rgba(10, 8, 6, 0.92) 58%);'
  ],
  ['--nv-saisie-bord: transparent;', '--nv-saisie-bord: var(--nv-bord);'],
  // Le cadre « or qui coule vers le blanc » (conv-168) reste a Nebuleuse de verre : la doree garde
  // son degrade non rogne sous son bord blanc fin.
  ['--nv-saisie-cadre: var(--nv-cadre-coule);', '--nv-saisie-cadre: none;'],
  ['--nv-saisie-boite: padding-box;', '--nv-saisie-boite: border-box;'],
  ['--nv-envoi-fond: #d9ae52;', '--nv-envoi-fond: var(--nv-degrade);'],
  ['--nv-envoi-fond-survol: #e3ba55;', '--nv-envoi-fond-survol: var(--nv-degrade-survol);'],
  ['--nv-envoi-bord: 1.5px solid #d9ae52;', '--nv-envoi-bord: 0;'],
  ['--nv-envoi-texte: #16110a;', '--nv-envoi-texte: #ffffff;'],
  ['--nv-envoi-lueur: none;', '--nv-envoi-lueur: 0 0 16px rgba(227, 181, 63, 0.45);'],
  ['--nv-envoi-vide-fond: transparent;', '--nv-envoi-vide-fond: var(--nv-degrade);'],
  ['--nv-envoi-vide-bord: 1.5px solid #d4a94f;', '--nv-envoi-vide-bord: 0;'],
  ['--nv-envoi-vide-texte: #e3ba55;', '--nv-envoi-vide-texte: rgba(255, 255, 255, 0.75);'],
  ['--nv-auto-glyphe: #e3ba55;', '--nv-auto-glyphe: var(--gold-clair);']
]

/**
 * LE BLEU DES PASTILLES « TOUR FINI » APPARTIENT A NEBULEUSE DE VERRE (conv-205, 2026-10-10 :
 * « les pastilles vertes met les bleu a la place »). La doree garde son vert flashy #00ff55
 * (conv-215 : « en gardant la pastille tour fini verte »). Recolore, le bleu #3c6eeb tombait dans
 * la regle des lilas clairs et sortait en GRIS rgb(158, 158, 158). Le commentaire suit : il nommait
 * le bleu. Le vert, a 140 deg, traverse ensuite la recoloration intact.
 */
const ETAT_FINI_DOREE = [
  `  /* Tour fini = le BLEU du theme, plein (debut de \`--nv-degrade\`) : demande conv-205
     (2026-10-10), « les pastilles vertes met les bleu a la place » — en tete du fil et liste. */
  --chat-etat-fini: #3c6eeb;`,
  `  /* Tour fini = VERT flashy (conv-197) : le bleu de conv-205 est pour Nebuleuse de verre seule,
     la doree garde son vert (conv-215, 2026-10-10) — en tete du fil et liste. */
  --chat-etat-fini: #00ff55;`
]

/**
 * LE FOND DE NEBULEUSE DE VERRE LUI APPARTIENT (conv-159, 2026-10-10) : le « liseré · halo haut »
 * (azur en haut, rose en bas, noir neutre) a ete choisi pour CE theme seul. Recolore, il donnerait
 * a la doree un bleu en haut et un or en bas que personne n'a demande. La doree garde donc ses deux
 * nappes. Ecrit dans les couleurs de la SOURCE : la recoloration les rend a l'identique de
 * theme-nebuleuse-doree.css d'avant ce choix. Le bloc remplace est borne par FOND-PROPRE:DEBUT/FIN
 * dans theme-nebuleuse-verre.css.
 */
const FOND_ENTETE_DOREE = [
  `   - Fond : NOIR PUR (#000) uni, sans halo, sans filet ni grain (conv-184,
     section 2). Le decor 3D de l'Accueil reste, teinte dans la meme famille
     (jetons --decor-*).`,
  `   - Fond : une encre violette (#0a0a0a) eclairee par DEUX nappes, violet en
     haut a gauche, magenta en bas a droite. Le decor 3D reste, teinte dans la
     meme famille (jetons --decor-*).`
]
const FOND_DOREE = `/* ---------------------------------------------------------------------------
   2. FOND : encre violette + deux nappes. L'image de galaxie est retiree ;
   le grain anime (body::before) est garde, sans sa nappe or.
   --------------------------------------------------------------------------- */
:root[data-theme='nebuleuse-verre'] body {
  background:
    radial-gradient(70vw 60vh at 96% 100%, rgba(255, 40, 140, 0.42), transparent 70%),
    /* Plus de nappe bleu-violet en haut a gauche (C1) : une lueur rose a peine visible. */
    radial-gradient(60vw 55vh at 0% 0%, rgba(230, 60, 160, 0.12), transparent 70%), #0a0a0a;
  color: var(--text);
}
`
const BLOC_FOND_PROPRE = /\/\* FOND-PROPRE:DEBUT[\s\S]*?\/\* FOND-PROPRE:FIN \*\/\n/
/**
 * ENVOYER ET STOP EN PERLE (2026-10-10, « PERLE implémente ») : choisi pour Nebuleuse de verre
 * seule. La doree garde sa pastille d'envoi degradee (conv-155) et son Stop : le bloc borne par
 * RELIEF-PERLE:DEBUT/FIN dans theme-nebuleuse-verre.css est RETIRE de la derivation.
 */
const BLOC_RELIEF_PERLE = /\/\* RELIEF-PERLE:DEBUT[\s\S]*?\/\* RELIEF-PERLE:FIN \*\/\n/
/**
 * CADRE CHANFREIN PLATINE (conv-177, 2026-10-10, « coins seuls implemente ») : choisi pour
 * Nebuleuse de verre seule. La doree garde le cadre « or qui coule vers le blanc » (conv-168) et
 * ses coins arrondis : le bloc borne par CADRE-CHANFREIN:DEBUT/FIN est RETIRE de la derivation.
 */
const BLOC_CADRE_CHANFREIN = /\/\* CADRE-CHANFREIN:DEBUT[\s\S]*?\/\* CADRE-CHANFREIN:FIN \*\/\n/
/**
 * RECHERCHE EN GROS (conv-185, 2026-10-10, « ce bloc je le veux en gros avec contour gris et contour
 * blanc quand j'ecris dedans ») : demande sur Nebuleuse de verre seule. La doree garde son champ de
 * recherche d'origine : le bloc borne par RECHERCHE-GROSSE:DEBUT/FIN est RETIRE de la derivation.
 */
const BLOC_RECHERCHE_GROSSE = /\/\* RECHERCHE-GROSSE:DEBUT[\s\S]*?\/\* RECHERCHE-GROSSE:FIN \*\/\n/

/* =================================================================================================
 * HOLOGRAPHIQUE BLANC (id `holographique-clair`, conv-212, 2026-10-10). Demande : « un theme
 * holographique blanc qui ressemble au holographique noir mais en gerant les pbms de lisibilite »,
 * « il faut baser tous les nouveaux theme en prenant holographique noir en template ». Choisi sur
 * maquette (/draft) : tour 2 « Feuille holo » (panneaux blancs, lisere irise, coins bleu et rose,
 * lumiere de la souris, neon autour des messages), tour 2 bis « Halo nacre », tour 3 « go le plus
 * blanc » (nacre #f8f7fb sur fond #f6f5f9).
 *
 * Comme la doree, la feuille est DERIVEE de theme-nebuleuse-verre.css : chaque retouche du noir
 * passe dans le blanc a la regeneration. Mais passer au clair n'est pas un simple changement de
 * teinte : le meme #ffffff est un texte sur un panneau (il doit devenir encre) ou un texte sur le
 * degrade (il doit rester blanc). La recoloration lit donc chaque DECLARATION (postcss) et decide
 * selon son ROLE (texte, trait, ombre, survol, fond) et selon la regle (posee sur le degrade ou non).
 * La base claire (data-base='clair', theme-modes.css) reste dessous : elle corrige deja les couleurs
 * ecrites en dur dans le reste de l'app pour tous les themes clairs.
 *
 * Regenerer : node scripts/theme-nebuleuse-verre.mjs holographique-clair
 * ================================================================================================= */
const CLAIR_ID = 'holographique-clair'
/** Le fond de page choisi (« Le plus blanc », tour 3). */
const CLAIR_PAGE = { r: 246, g: 245, b: 249 }
/** Le rose du degrade, assombri : blanc dessus 4,8:1 au lieu de 3,8:1 pour #e63ca0 (calcule). */
const CLAIR_ROSE = { r: 208, g: 43, b: 140 }

/**
 * Regles posees sur le DEGRADE (ou sur un fond plein colore) : leur blanc reste blanc. Releve un par
 * un dans la source le 2026-10-10 (chaque `#ffffff` de theme-nebuleuse-verre.css et son selecteur).
 * `.askd-item` N'Y EST PLUS (2026-10-11, capture de l'utilisateur : « le bloc ask [...] pas ouf ») :
 * une reponse du bloc ASK est une PLAQUE sombre (#202020) a texte blanc, pas une pastille degradee.
 * Protegee, elle gardait son fond noir sous un texte devenu encre -- illisible. Seule la reponse
 * COCHEE porte le degrade, et son texte passe par --nv-askd-encre-bulle, deja garde blanc.
 */
const CLAIR_SUR_DEGRADE =
  /\.nav-item\.active|\.btn-accent|\.msg\.user \.msg-body|\.conv-new-(row|title|icon)|\.composer-send|\.composer-stop|\.workflow-section-tab\.is-active|\.askd-coche input:checked|::selection|\.chat-context-rule|\.conversation-state/
/** Jetons qui designent un texte pose sur le degrade : ils restent blancs. */
const CLAIR_JETONS_BLANCS = new Set([
  '--on-accent',
  '--chat-corps-vous',
  '--chat-envoi-rose',
  '--chat-sur-vif',
  '--chat-sur-vif-survol',
  '--nv-askd-encre-bulle'
])

/** Role d'une declaration : ce que la couleur y peint. */
function roleClair(propriete) {
  const p = propriete.toLowerCase()
  if (/mask/.test(p)) return 'masque'
  if (p.startsWith('--')) {
    if (CLAIR_JETONS_BLANCS.has(p)) return 'garde'
    if (/survol|hover|cran-fond|selected/.test(p)) return 'survol'
    if (/ombre|shadow|lueur|reflet|filet-or/.test(p)) return 'ombre'
    if (/bord|-line|filet|separateur|ascenseur|cotes|border/.test(p)) return 'trait'
    if (
      /^--(text|titlebar-symbol|gold|rose-bright|cyan|info|ok|warn|err)|texte|titre|kicker|corps|-nom|meta|note|option|chevron|groupe|icone|invite|actif|role-|citation|h6|-ref|-bon|alerte|mauvais|limite|colonnes|focus|depot|dictee|erreur|wf-|piece-jointe|suppr-(kicker|titre|fort)|renommer|module-(title|eyebrow)|liste-bouton|matrice-ouvrir|cran-(texte|vif|reco)/.test(
        p
      )
    )
      return 'texte'
    return 'fond'
  }
  if (
    ['color', 'fill', 'stroke', 'caret-color', '-webkit-text-fill-color', 'text-decoration-color'].includes(p)
  )
    return 'texte'
  if (/^(border|outline|column-rule)/.test(p)) return 'trait'
  if (/shadow|^filter$/.test(p)) return 'ombre'
  return 'fond'
}

const arrondi = (a) => Math.round(a * 1000) / 1000
/** Encre lilas : un clair (texte du noir) devient sombre, a teinte et saturation bornees. */
function encreClair(h, s, l, a) {
  const neutre = s < 0.05
  return { ...hslVersRgb({ h: neutre ? 252 : h, s: neutre ? 0.2 : Math.min(s, 0.3), l: 0.08 + (1 - l) * 0.8 }), a }
}
/** Nacre : un fond sombre opaque du noir devient une nacre claire. */
function nacreClair(l, a) {
  return { ...hslVersRgb({ h: 252, s: 0.25, l: 0.975 - l * 0.3 }), a }
}

/**
 * Couleur du noir -> couleur du blanc. Rend null quand la couleur reste telle quelle.
 * Contrastes verifies (seuil 4,5:1 sur la nacre #f8f7fb) : encre du blanc #ffffff -> environ #110f18,
 * texte discret #8f89ad -> environ #5a5480 (6,4:1), textes de couleur ramenes a 36 % de luminosite
 * (24 % pour les verts et les ors, plus lumineux a teinte egale).
 */
function recolorerClair(rgb, role, garder) {
  const a = rgb.a ?? 1
  if (rgb.r === 230 && rgb.g === 60 && rgb.b === 160) return { ...CLAIR_ROSE, a }
  if (role === 'masque') return null
  const { h, s, l } = rgbVersHsl(rgb)
  const neutre = s < 0.3 || l > 0.9 || l < 0.2
  if (neutre) {
    if (garder || role === 'garde') return null
    if (l >= 0.5) {
      if (role === 'texte') return encreClair(h, s, l, a)
      // Un trait blanc a l'opacite a sur le noir -> un trait d'encre d'opacite comparable a l'oeil :
      // a x 1,6 donnait 88 % au « contour gris » de la recherche (55 %), un trait noir appuye
      // (capture du 2026-10-10) ; a x 0,7 + 5 % le garde gris, et un filet de 11 % reste visible (13 %).
      if (role === 'trait') return a < 1 ? { r: 20, g: 15, b: 40, a: arrondi(Math.min(0.6, a * 0.7 + 0.05)) } : encreClair(h, s, l, a)
      if (role === 'survol') return { r: 20, g: 15, b: 40, a: arrondi(a * 0.7) }
      return null // fond et ombre : un blanc reste un blanc (verre, reflets bombes)
    }
    if (role === 'texte') return null // texte sombre pose sur une couleur vive (surlignage)
    if (role === 'ombre') return { r: 40, g: 30, b: 80, a: arrondi(a * 0.3) }
    if (a >= 0.85) return l < 0.05 && a === 1 ? { ...CLAIR_PAGE, a } : nacreClair(l, a)
    return { r: 20, g: 15, b: 40, a: arrondi(a * 0.1) }
  }
  if ((role === 'texte' || role === 'trait') && !garder && role !== 'garde' && l > 0.4) {
    const lumineuse = h >= 45 && h <= 200
    const or = h >= 35 && h < 45
    return { ...hslVersRgb({ h, s: borne(s, 0.55, 0.85), l: lumineuse || or ? 0.24 : 0.36 }), a }
  }
  return null
}

function recolorerValeurClair(valeur, role, garder) {
  return valeur.replace(COULEUR, (brut) => {
    if (brut.startsWith('#') && ![4, 5, 7, 9].includes(brut.length)) return brut
    const rgb = brut.startsWith('#')
      ? hexVersRgb(brut)
      : (() => {
          const n = brut.match(/[\d.]+/g).map(Number)
          return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
        })()
    const t = recolorerClair(rgb, role, garder)
    if (!t) return brut
    // Opaque en #rrggbb : theme.css.test.ts exige un --bg-0 hexadecimal (liste native d'un select).
    const hex = (n) => n.toString(16).padStart(2, '0')
    return (t.a ?? 1) === 1 ? `#${hex(t.r)}${hex(t.g)}${hex(t.b)}` : `rgba(${t.r}, ${t.g}, ${t.b}, ${t.a})`
  })
}

/**
 * Remplacements EXPLICITES (chaque ligne doit exister dans la source, sinon la generation s'arrete) :
 * les points ou la recoloration generique ne suffit pas.
 */
const CLAIR_REMPLACEMENTS = [
  // Satin de la page : nacre #f8f7fb, reflets a +7 / -4 niveaux (le noir : #080808 et #222222).
  [
    '#0c0c0c 0%, #222222 18%, #080808 42%, #080808 48%, #1a1a1a 64%, #080808 80%;',
    '#f8f7fb 0%, #ffffff 18%, #f5f4f9 42%, #f5f4f9 48%, #fcfbfe 64%, #f5f4f9 80%;'
  ],
  // Lumiere de la souris : un blanc a 13 % ne se voit pas sur la nacre ; le halo du /draft
  // (« Halo nacre ») part de 97 %.
  ['--nv-lumiere-couleur: rgba(255, 255, 255, 0.13);', '--nv-lumiere-couleur: rgba(255, 255, 255, 0.97);'],
  // Cadre chanfreine : coins BLEU (haut gauche) et ROSE (bas droit) de la piste « Feuille holo ».
  ['--nv-chanfrein-haut: #ffffff;', '--nv-chanfrein-haut: __CLAIR_BLEU__;'],
  ['--nv-chanfrein-bas: #c9d4e6;', '--nv-chanfrein-bas: __CLAIR_ROSE_COIN__;'],
  ['--nv-chanfrein-cotes: rgba(255, 255, 255, 0.07);', '--nv-chanfrein-cotes: __CLAIR_COTES__;'],
  ['--nv-chanfrein-encre: #09090a;', '--nv-chanfrein-encre: __CLAIR_PAGE__;'],
  // Les voiles (rgba(var(--voile-rgb), a)) assombrissent au lieu d'eclaircir, comme sur la base claire.
  ['--voile-rgb: 255, 255, 255;', '--voile-rgb: 20, 15, 40;']
]
const CLAIR_JETONS_FINAUX = {
  __CLAIR_BLEU__: '#3c6eeb',
  __CLAIR_ROSE_COIN__: '#e63ca0',
  __CLAIR_COTES__: 'rgba(60, 40, 140, 0.16)',
  __CLAIR_PAGE__: '#f6f5f9'
}

const FOND_CLAIR = `/* ---------------------------------------------------------------------------
   2. FOND NACRE UNI (Holographique blanc, conv-212) : piste « Le plus blanc » du /draft (tour 3),
   page presque blanche #f6f5f9 et rien d'autre -- le meme parti pris que le fond noir uni du noir
   (« oublie le rose et bleu »). Ni grain anime, ni voile de bord.
   --------------------------------------------------------------------------- */
:root[data-theme='nebuleuse-verre'] body {
  background: #f6f5f9;
  color: var(--text);
}
:root[data-theme='nebuleuse-verre'] body::before {
  display: none;
}
:root[data-theme='nebuleuse-verre'] body::after {
  background: none;
  box-shadow: none;
}
`

/** Ajouts propres au blanc (ecrits avec le nom final du theme). */
const COMPLEMENT_CLAIR = `
/* ===========================================================================
   COMPLEMENT HOLOGRAPHIQUE BLANC (genere, voir genererMainClair).
   =========================================================================== */
/* Le lisere IRISE du haut des panneaux (piste « Feuille holo ») : 3 px, bleu -> lilas -> rose -> argent.
   Pose en premiere couche du fond des panneaux (voir genererMainClair). */
:root[data-theme='${CLAIR_ID}'] {
  --nv-holo-lisere: linear-gradient(90deg, #3c6eeb, #9b8cff 35%, #e63ca0 70%, #cfd6e4);
}
/* La bulle de l'utilisateur : le degrade du noir, rose assombri (#d02b8c) pour que le blanc dessus
   passe 4,5:1 sur toute la bulle (4,54:1 sur le bleu, 4,77:1 sur le rose). La regle de
   cosmic-outline.css est reservee aux themes sombres : elle est reprise ici. */
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .msg.user .msg-body.msg-bulle {
  border: 1px solid transparent;
  border-radius: 12px 12px 3px 12px;
  background: linear-gradient(135deg, #3c6eeb, #d02b8c);
  background-origin: border-box;
  background-repeat: no-repeat;
  color: #ffffff;
  box-shadow: none;
  position: relative;
}
/* Le neon « Brume » autour de la bulle (draft conv-199) : une copie floutee de son fond, posee
   derriere elle. Meme reglage que le noir ; sur le blanc, il devient un halo bleu -> rose. */
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .msg.user {
  isolation: isolate;
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .msg.user .msg-body.msg-bulle::before {
  content: '';
  position: absolute;
  inset: -3px;
  z-index: -1;
  border-radius: inherit;
  background: inherit;
  filter: blur(22px);
  opacity: 0.45;
  pointer-events: none;
}
/* La base claire (theme-modes.css, « gris bleu franc ») peint ces champs en #dde2e9 ; le noir ne les
   repeint pas, le gris restait donc au milieu de la nacre (capture du 2026-10-10). La saisie interne
   laisse voir le satin de la saisie, comme sur le noir ; les autres prennent une nacre presque blanche.
   SPECIFICITE : la regle de la base porte « :is(... .cosmic-outline .chat-suggest .btn) », qui compte
   trois classes ; le double attribut « [data-theme][data-base] » l'egale, et l'ordre d'import tranche. */
:root[data-theme='${CLAIR_ID}'][data-base='clair'] .cosmic-outline .composer-field {
  background: transparent;
}
:root[data-theme='${CLAIR_ID}'][data-base='clair'] :is(.theme-serious .brand, .cosmic-outline .conv-search, .artifact-preview) {
  background: #fdfdff;
}
/* Fond UNI (« Le plus blanc ») : le decor de fond ressortait en formes grises sur l'Accueil. */
:root[data-theme='${CLAIR_ID}'] .decor-de-fond {
  display: none;
}
/* CAPSULE D'ACTIONS (« 1 action terminee », conv-212 : « pas ouf »). Le noir la peint par sa couche
   generee : trait vif a gauche, teinte d'etat qui s'efface vers la droite. La base claire commune
   (theme-modes.css) la repeint en sarcelle (47,138,110) apres la couche generee du blanc : seule cette
   feuille, importee apres elle, peut la couvrir. Meme dessin que le noir, en clair : vert #09712c
   termine, bleu #3c6eeb en cours, rouge #b3261e echec, ambre #9a5b00 interrompu. */
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group {
  border: 1px solid rgba(20, 15, 40, 0.13);
  border-left: 2px solid #3c6eeb;
  background: #fdfdff;
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group:hover {
  background: #ffffff;
  border-color: rgba(20, 15, 40, 0.2);
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group[data-state='done'] {
  border-left-color: #09712c;
  background: linear-gradient(100deg, rgba(0, 190, 70, 0.14) 0%, rgba(0, 190, 70, 0.04) 45%, #fdfdff 85%);
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group[data-state='running'] {
  border-left-color: #3c6eeb;
  background: linear-gradient(100deg, rgba(60, 110, 235, 0.14) 0%, rgba(60, 110, 235, 0.04) 45%, #fdfdff 85%);
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group:is(.failed, [data-state='failed']) {
  border-left-color: #b3261e;
  background: linear-gradient(100deg, rgba(220, 50, 40, 0.12) 0%, rgba(220, 50, 40, 0.04) 45%, #fdfdff 85%);
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group[data-state='interrupted'] {
  border-left-color: #9a5b00;
  background: linear-gradient(100deg, rgba(232, 163, 61, 0.16) 0%, rgba(232, 163, 61, 0.05) 45%, #fdfdff 85%);
}
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .activity-group .activity-group-title {
  color: #1c172b;
}
/* ETIQUETTES DES THEMES DU GRAPHE (Knowledge). Leur texte prend la couleur du theme
   (var(--theme-color), des pastels faits pour un fond d'encre) : sur la nacre, « Decisions » tombait a
   1,7:1 (mesure du 2026-10-11). Une variable ne se calcule pas a la generation : le texte est ici
   la couleur du theme MELEE D'ENCRE (42 %), au moins 5,5:1 sur la nacre pour les pastels du graphe ;
   le bord garde la couleur pure, et les ombres noires d'origine deviennent legeres. */
:root[data-theme='${CLAIR_ID}'] .theme-cluster-label {
  color: color-mix(in srgb, var(--theme-color) 42%, #1c172b);
  background: rgba(253, 253, 255, 0.94);
  box-shadow: 0 2px 8px rgba(40, 30, 80, 0.12);
}
:root[data-theme='${CLAIR_ID}'] :is(.theme-cluster-label:hover, .theme-cluster-label:focus-visible, .theme-cluster-label.is-active) {
  background: color-mix(in srgb, var(--theme-color) 14%, #fdfdff);
  box-shadow: 0 3px 12px rgba(40, 30, 80, 0.16);
}
/* Texte BLANC sur les pastilles degradees (meme liste que la doree, qui y met son noir chaud). */
:root[data-theme='${CLAIR_ID}'] .nav-item.active,
:root[data-theme='${CLAIR_ID}'] .workflow-section-tab.is-active,
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .composer-send:not(.is-resume):not(.is-stop),
:root[data-theme='${CLAIR_ID}'] .cosmic-outline .conv-new-row .conv-new-title,
:root[data-theme='${CLAIR_ID}'] .conv-foot > .conv-status-filter:not([data-filter='toutes']),
:root[data-theme='${CLAIR_ID}'] .conv-foot > .conv-density-toggle:not([data-density='detail']),
:root[data-theme='${CLAIR_ID}'] .conv-foot > .conv-view-toggle[aria-checked='true'] {
  color: #ffffff;
}
`

/**
 * Holographique blanc = la feuille ecrite a la main d'Holographique noir, passee au clair
 * declaration par declaration (voir l'en-tete du bloc HOLOGRAPHIQUE BLANC).
 */
export function genererMainClair() {
  let source = readFileSync(join(RACINE, 'src/renderer/src/assets/theme-nebuleuse-verre.css'), 'utf8')
  for (const [avant, apres] of CLAIR_REMPLACEMENTS) {
    if (!source.includes(avant)) throw new Error(`genererMainClair : ligne introuvable dans la source : ${avant}`)
    source = source.replace(avant, apres)
  }
  if (!BLOC_FOND_PROPRE.test(source)) {
    throw new Error('genererMainClair : bloc FOND-PROPRE:DEBUT/FIN introuvable dans la source')
  }
  source = source.replace(BLOC_FOND_PROPRE, '/* __CLAIR_FOND__ */\n')
  const racine = postcss.parse(source)
  let lisereres = 0
  racine.walkDecls((decl) => {
    const regle = decl.parent
    const selecteur = regle && regle.type === 'rule' ? regle.selector : ''
    const garder = CLAIR_SUR_DEGRADE.test(selecteur)
    decl.value = recolorerValeurClair(decl.value, roleClair(decl.prop), garder)
    // Le lisere irise en premiere couche des panneaux qui portent le satin de la page (la saisie,
    // peinte autrement et coupee en `padding-box`, n'en recoit pas).
    if (decl.prop === 'background' && /var\(--nv-satin\) fixed\s*$/.test(decl.value)) {
      decl.value = `var(--nv-holo-lisere) left top / 100% 3px no-repeat,\n    ${decl.value.trim()}`
      lisereres += 1
    }
  })
  if (lisereres < 4) {
    throw new Error(`genererMainClair : lisere irise pose sur ${lisereres} panneau(x) seulement (4 attendus au moins)`)
  }
  let css = racine.toString().replace('/* __CLAIR_FOND__ */\n', FOND_CLAIR)
  for (const [jeton, valeur] of Object.entries(CLAIR_JETONS_FINAUX)) css = css.replaceAll(jeton, valeur)
  css = css.replaceAll("data-theme='nebuleuse-verre'", `data-theme='${CLAIR_ID}'`)
  return `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs ${CLAIR_ID}, depuis
   theme-nebuleuse-verre.css -- ne pas modifier a la main (modifier la source, puis regenerer). */\n\n${css}${COMPLEMENT_CLAIR}`
}

/* =================================================================================================
 * COUCHE GENEREE D'HOLOGRAPHIQUE BLANC (2026-10-11, conv-212 : « corrige les elements sombres », puis
 * « le bloc ask et 1 action terminee sont pas ouf »). Holographique noir a DEUX feuilles : sa feuille
 * ecrite a la main ET une couche generee (`generer`) qui retraduit les couleurs ECRITES EN DUR dans
 * les feuilles des composants. Le blanc n'avait que la premiere : chaque couleur en dur des vues
 * restait celle d'origine -- tuiles et boutons d'encre de Knowledge et d'Agent Studio, capsule
 * d'actions en degrade sarcelle (47,138,110) au lieu du vert du theme. La base claire commune
 * (theme-modes.css, theme-clair-gris.css) ne couvre que les gris neutres.
 *
 * Meme parcours que `generer` (memes feuilles, memes exclusions), mais la traduction vise le CLAIR et
 * lit la REGLE entiere : un fond d'encre devient nacre, et le texte clair de la MEME regle devient
 * encre -- sinon il disparaitrait sur la nacre. Familles du theme (alpha conserve) :
 *   - verts -> texte et traits #09712c (le --ok du blanc), fonds translucides vert vif ;
 *   - or et rose -> texte et traits #aa0e5f, fonds translucides #d02b8c ;
 *   - cyan -> texte et traits #0e31aa, fonds translucides #3c6eeb.
 * Un fond de famille OPAQUE reste tel quel : son texte a ete choisi pour lui.
 * Contrastes (calcules, sur la nacre #f8f7fb) : #09712c 6,4:1 · #aa0e5f 7,1:1 · #0e31aa 9,8:1.
 * ================================================================================================= */
const PREFIXE_CLAIR = `:root[data-theme='${CLAIR_ID}']`
const CLAIR_ENCRE = { r: 28, g: 23, b: 43 } // = --text du blanc (#1c172b)
const CLAIR_NACRE = { r: 253, g: 253, b: 255 }
const CLAIR_TEXTE_FAMILLE = {
  vert: { r: 9, g: 113, b: 44 },
  or: { r: 170, g: 14, b: 95 },
  rose: { r: 170, g: 14, b: 95 },
  cyan: { r: 14, g: 49, b: 170 }
}
const CLAIR_FOND_FAMILLE = {
  vert: { r: 0, g: 190, b: 70 },
  or: CLAIR_ROSE,
  rose: CLAIR_ROSE,
  cyan: { r: 60, g: 110, b: 235 }
}

function familleClair(rgb, h, s, l) {
  if (h >= 85 && h <= 178 && s >= 0.3 && l >= 0.12 && l <= 0.9) return 'vert'
  if (ORS.has(`${rgb.r},${rgb.g},${rgb.b}`)) return 'or'
  if (h >= 185 && h <= 212 && s >= 0.45 && l >= 0.18) return 'cyan'
  if (h >= 318 && h <= 342 && s >= 0.5 && l >= 0.2) return 'rose'
  return null
}

/** Une couleur d'ENCRE (fond sombre du theme d'origine), hors familles du theme. */
function estEncre(rgb) {
  const { h, s, l } = rgbVersHsl(rgb)
  return l < 0.16 && s < 0.75 && !familleClair(rgb, h, s, l)
}

function lireCouleur(brut) {
  if (brut.startsWith('#')) return [4, 5, 7, 9].includes(brut.length) ? hexVersRgb(brut) : null
  const n = brut.match(/[\d.]+/g).map(Number)
  return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
}

/** Couleur d'une feuille de composant -> couleur du blanc, ou null si elle reste. */
function transposerCoucheClaire(rgb, role, fondSombre) {
  const a = rgb.a ?? 1
  const { h, s, l } = rgbVersHsl(rgb)
  const famille = familleClair(rgb, h, s, l)
  const encre = !famille && l < 0.16 && s < 0.75
  if (role === 'texte') {
    if (famille) return { ...CLAIR_TEXTE_FAMILLE[famille], a }
    if (fondSombre && l > 0.55)
      return s < 0.25 ? { ...CLAIR_ENCRE, a } : { ...hslVersRgb({ h, s: borne(s, 0.55, 0.85), l: 0.32 }), a }
    return null
  }
  if (role === 'trait') {
    if (famille) return { ...CLAIR_TEXTE_FAMILLE[famille], a }
    // Seuil plus large pour un TRAIT : sous 26 % de luminosite, c'est un filet sombre sur la nacre.
    // Le contour du filtre de l'Observatory (39,51,63 : 20 %) passait sous le seuil des fonds.
    if (encre || (!famille && l < 0.26 && s < 0.75))
      return { r: 20, g: 15, b: 40, a: arrondi(a < 1 ? Math.min(0.3, a * 0.5 + 0.08) : 0.2) }
    if (fondSombre && l > 0.55) return { r: 20, g: 15, b: 40, a: 0.16 }
    return null
  }
  if (role === 'ombre' || role === 'masque' || role === 'garde') return null
  // fond, survol
  if (famille) return a >= 0.85 ? null : { ...CLAIR_FOND_FAMILLE[famille], a }
  if (encre) return a >= 0.5 ? { ...CLAIR_NACRE, a } : { r: 20, g: 15, b: 40, a: arrondi(a * 0.15) }
  return null
}

function prefixerClair(selecteur) {
  const s = selecteur.trim()
  if (/:root\[|data-base|data-theme/.test(s)) return null
  if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, PREFIXE_CLAIR)
  return `${PREFIXE_CLAIR} ${s}`
}

export function genererCoucheClaire() {
  const blocs = []
  let regles = 0
  let declarations = 0
  const hex = (n) => n.toString(16).padStart(2, '0')
  for (const fichier of fichiers()) {
    const racine = postcss.parse(readFileSync(fichier, 'utf8'), { from: fichier })
    const sortie = postcss.root()
    racine.walkRules((regle) => {
      if (regle.parent?.type === 'atrule' && /keyframes/i.test(regle.parent.name)) return
      const selecteurs = regle.selectors.map(prefixerClair).filter(Boolean)
      if (selecteurs.length === 0) return
      const directes = []
      regle.each((n) => {
        if (n.type === 'decl' && PROPRIETES_COULEUR.test(n.prop.toLowerCase())) directes.push(n)
      })
      // La regle pose-t-elle un FOND d'encre ? Alors son texte clair est pose dessus.
      const fondSombre = directes.some(
        (d) =>
          /^background/.test(d.prop.toLowerCase()) &&
          (d.value.match(COULEUR) ?? []).some((c) => {
            const rgb = lireCouleur(c)
            return rgb && (rgb.a ?? 1) >= 0.5 && estEncre(rgb)
          })
      )
      const nouvelles = []
      for (const decl of directes) {
        // Une valeur qui porte une IMAGE (le fond galaxie de theme.css) n'est jamais recopiee : la
        // recopier pour en changer la couleur ramenait l'image, que le blanc a retiree (capture
        // du 2026-10-11 : decor etoile revenu derriere les panneaux).
        if (/url\(/i.test(decl.value)) continue
        const role = roleClair(decl.prop)
        let change = false
        const valeur = decl.value.replace(COULEUR, (brut) => {
          const rgb = lireCouleur(brut)
          if (!rgb) return brut
          const t = transposerCoucheClaire(rgb, role, fondSombre)
          if (!t) return brut
          change = true
          return (t.a ?? 1) === 1 ? `#${hex(t.r)}${hex(t.g)}${hex(t.b)}` : `rgba(${t.r}, ${t.g}, ${t.b}, ${t.a})`
        })
        if (change) nouvelles.push(postcss.decl({ prop: decl.prop, value: valeur, important: decl.important }))
      }
      if (nouvelles.length === 0) return
      const copie = postcss.rule({ selectors: selecteurs })
      copie.append(nouvelles)
      let cible = copie
      for (let p = regle.parent; p && p.type === 'atrule'; p = p.parent) {
        const enveloppe = postcss.atRule({ name: p.name, params: p.params })
        enveloppe.append(cible)
        cible = enveloppe
      }
      sortie.append(cible)
      regles += 1
      declarations += nouvelles.length
    })
    if (sortie.nodes.length > 0) {
      blocs.push(`/* ---- ${relative(RACINE, fichier).replace(/\\/g, '/')} ---- */\n${sortie.toString()}`)
    }
  }
  const entete = `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs ${CLAIR_ID} -- ne pas modifier a la main.
   Theme « Holographique blanc » : couleurs ecrites en dur dans les composants, passees au clair
   (fonds d'encre -> nacre et leur texte -> encre, verts/or/cyan/rose -> teintes du theme).
   ${regles} regles, ${declarations} declarations. Voir genererCoucheClaire. */\n\n`
  return { css: entete + blocs.join('\n\n') + '\n', regles, declarations }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === CLAIR_ID) {
    const couche = genererCoucheClaire()
    writeFileSync(join(RACINE, `src/renderer/src/assets/theme-${CLAIR_ID}.genere.css`), couche.css)
    console.log(`theme-${CLAIR_ID}.genere.css : ${couche.regles} regles, ${couche.declarations} declarations`)
    writeFileSync(join(RACINE, `src/renderer/src/assets/theme-${CLAIR_ID}.css`), genererMainClair())
    console.log(`theme-${CLAIR_ID}.css : derive de theme-nebuleuse-verre.css`)
  } else {
    const { css, regles, declarations } = generer()
    writeFileSync(join(RACINE, SORTIE), css)
    console.log(`${SORTIE} : ${regles} regles, ${declarations} declarations`)
    if (DORE) {
      writeFileSync(join(RACINE, 'src/renderer/src/assets/theme-nebuleuse-doree.css'), genererMainDoree())
      console.log(`theme-nebuleuse-doree.css : derive de theme-nebuleuse-verre.css`)
    }
  }
}



/**
 * Nebuleuse doree = la feuille ecrite a la main de Nebuleuse de verre (une seule source, les
 * deux themes ne divergent pas), recolorée : roses -> or, violets/bleus -> bronze, textes lilas
 * -> ivoire, encres violettes -> noir chaud. Verts, rouges et ambres d'etat restent.
 * La zone de saisie reprend le degrade or clair -> noir (« B1 plus clair », conv-139).
 */
export function genererMainDoree() {
  const source = readFileSync(join(RACINE, 'src/renderer/src/assets/theme-nebuleuse-verre.css'), 'utf8')
  const recolorer = (rgb) => {
    const { h, s, l } = rgbVersHsl(rgb)
    // TEXTES lilas clairs -> BLANC / gris NEUTRES (conv-139, 2026-10-10 : « on dirait que tout
    // mon ecran a un filtre jaune, les textes doivent etre blancs »). Avant ce test, les lilas
    // pales tombaient dans les regles bronze/ivoire ci-dessous et teintaient tout le texte.
    if (h >= 215 && h < 300 && l >= 0.55) {
      const gris = Math.round(Math.min(1, l + 0.04) * 255)
      return { r: gris, g: gris, b: gris }
    }
    if (h >= 300 && h <= 345 && s >= 0.5) return hslVersRgb({ h: 43, s: 0.75, l: borne(l, 0.3, 0.88) })
    if (h >= 215 && h < 300 && s >= 0.35 && l >= 0.15) return hslVersRgb({ h: 36, s: 0.6, l: borne(l * 0.85, 0.25, 0.8) })
    if (h >= 215 && h < 300 && l >= 0.6) return hslVersRgb({ h: 40, s, l })
    if (h >= 215 && h < 300 && l < 0.2) return hslVersRgb({ h: 38, s: borne(s, 0, 0.35), l })
    return null
  }
  // LA SAISIE DE NEBULEUSE DOREE LUI APPARTIENT (conv-155) : Nebuleuse de verre a pris un noir a
  // cadre or et un bouton d'envoi rond qui s'allume ; la doree garde son degrade or -> noir
  // (« B1 plus clair », conv-139), son bord blanc fin et sa pastille d'envoi degradee. Seule la
  // FORME du bouton suit la source (rond : le coin pince est reserve aux bulles de message).
  // Chaque ligne de la source DOIT exister : une ligne introuvable arrete la generation au lieu
  // de laisser passer en silence la saisie de Nebuleuse de verre.
  let derive = source
  for (const [ligneVerre, ligneDoree] of SAISIE_DOREE) {
    if (!derive.includes(ligneVerre)) {
      throw new Error(`genererMainDoree : ligne de saisie introuvable dans la source : ${ligneVerre}`)
    }
    derive = derive.replace(ligneVerre, ligneDoree)
  }
  // Meme exigence pour la pastille « tour fini » (ETAT_FINI_DOREE).
  if (!derive.includes(ETAT_FINI_DOREE[0])) {
    throw new Error(
      'genererMainDoree : pastille « tour fini » (--chat-etat-fini) introuvable dans la source'
    )
  }
  derive = derive.replace(...ETAT_FINI_DOREE)
  // Meme exigence pour le fond (FOND_DOREE) : un bloc ou un en-tete introuvable arrete la generation.
  if (!BLOC_FOND_PROPRE.test(derive)) {
    throw new Error('genererMainDoree : bloc FOND-PROPRE:DEBUT/FIN introuvable dans la source')
  }
  if (!derive.includes(FOND_ENTETE_DOREE[0])) {
    throw new Error('genererMainDoree : ligne « Fond » de l en-tete introuvable dans la source')
  }
  derive = derive.replace(BLOC_FOND_PROPRE, FOND_DOREE).replace(...FOND_ENTETE_DOREE)
  if (!BLOC_RELIEF_PERLE.test(derive)) {
    throw new Error('genererMainDoree : bloc RELIEF-PERLE:DEBUT/FIN introuvable dans la source')
  }
  derive = derive.replace(BLOC_RELIEF_PERLE, '')
  if (!BLOC_CADRE_CHANFREIN.test(derive)) {
    throw new Error('genererMainDoree : bloc CADRE-CHANFREIN:DEBUT/FIN introuvable dans la source')
  }
  derive = derive.replace(BLOC_CADRE_CHANFREIN, '')
  if (!BLOC_RECHERCHE_GROSSE.test(derive)) {
    throw new Error('genererMainDoree : bloc RECHERCHE-GROSSE:DEBUT/FIN introuvable dans la source')
  }
  derive = derive.replace(BLOC_RECHERCHE_GROSSE, '')
  const css = derive
    .replace(COULEUR, (brut) => {
      if (brut.startsWith('#') && ![4, 5, 7, 9].includes(brut.length)) return brut
      const rgb = brut.startsWith('#')
        ? hexVersRgb(brut)
        : (() => {
            const n = brut.match(/[\d.]+/g).map(Number)
            return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
          })()
      const t = recolorer(rgb)
      if (!t) return brut
      return rgb.a === 1 ? `rgb(${t.r}, ${t.g}, ${t.b})` : `rgba(${t.r}, ${t.g}, ${t.b}, ${rgb.a})`
    })
    .replaceAll("data-theme='nebuleuse-verre'", "data-theme='nebuleuse-doree'")
  // LISIBILITE SUR L'OR : la pastille pleine (selection, onglet, envoi) recoloree en or clair
  // gardait le texte BLANC de la source -- « Chat » devenait illisible (capture du 2026-10-10,
  // conv-139, apres D6). Sur un fond or plein, le texte passe en noir chaud. « Nouveau fil » sur un
  // fil vide n'est plus assombri mais brillant (conv-201) : son titre suit, `.active` compris.
  const lisibilite = `
/* Texte NOIR CHAUD sur les pastilles or pleines (genere, voir genererMainDoree). */
:root[data-theme='nebuleuse-doree'] .nav-item.active,
:root[data-theme='nebuleuse-doree'] .workflow-section-tab.is-active,
:root[data-theme='nebuleuse-doree']
  .cosmic-outline
  .composer-send:not(.is-resume):not(.is-stop),
:root[data-theme='nebuleuse-doree'] .cosmic-outline .conv-new-row .conv-new-title,
:root[data-theme='nebuleuse-doree'] .conv-foot > .conv-status-filter:not([data-filter='toutes']),
:root[data-theme='nebuleuse-doree'] .conv-foot > .conv-density-toggle:not([data-density='detail']),
:root[data-theme='nebuleuse-doree'] .conv-foot > .conv-view-toggle[aria-checked='true'] {
  color: #141008;
}
/* Bloc ASK et bloc du cadrage (conv-202) : badge, Envoyer et reponse cochee portent le degrade,
   ici or plein. */
:root[data-theme='nebuleuse-doree'] .askd {
  --nv-askd-encre-bulle: #141008;
}
`
  return `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree, depuis
   theme-nebuleuse-verre.css -- ne pas modifier a la main (modifier la source, puis regenerer). */\n\n${css}${lisibilite}`
}
