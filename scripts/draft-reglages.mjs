/**
 * CURSEURS DE RÉGLAGE DU CARROUSEL /draft (conv-1339, 2026-10-30, piste du scout conv-1332).
 *
 * Une retouche chiffrée (« le 4 durée 1 second », « grand 2 lignes ») coûtait un tour complet du
 * modèle pour changer une valeur. Claude Design propose ces réglages à côté des variantes. Ici, le
 * JSON du carrousel déclare des VARIABLES CSS ; la page les montre en curseurs, l'aperçu change tout
 * de suite, et les boutons de choix portent les valeurs choisies.
 *
 *   "reglages": [
 *     { "nom": "Durée", "variable": "--ex-duree", "min": 0.2, "max": 2, "pas": 0.1, "valeur": 0.8, "unite": "s" },
 *     { "nom": "Accent", "variable": "--ex-accent", "couleur": "#e63ca0" }
 *   ]
 *
 * Les maquettes lisent `var(--ex-duree)` dans leur `css` ou leur `html`. Les valeurs d'origine sont
 * posées sur `.dkc-w` ; celles qu'on règle, sur la diapositive ET la vignette de la proposition
 * affichée seulement : chaque proposition garde les siennes (conv-1382, voir `SCRIPT_REGLAGES`).
 *
 * UN CURSEUR EXIGE DU CODE : le carrousel passe en page ```html-interactif, comme avec une scène 3D.
 * Ses boutons REMPLISSENT alors la saisie au lieu d'envoyer (amorce.js) ; l'utilisateur relit donc
 * les valeurs avant de les envoyer. Sans `reglages`, le carrousel reste un ```html-render sans script.
 *
 * CE QUI PART EST CE QUI EST ÉCRIT : les valeurs sont ajoutées AU LIBELLÉ VISIBLE des boutons, et
 * seules celles qui ont changé : une retouche se lit « Affiner la 2 · Creux — Durée 1 s », et un
 * bouton intact ne dit rien de plus qu'avant.
 *
 * UNE JAUGE VISIBLE FAIT BOUGER CE QU'ON REGARDE (conv-1382, 2026-10-31). Une jauge ne s'affiche que
 * sur les propositions qui la lisent, et le bouton d'une proposition ne porte que SES valeurs ; un
 * mélange porte celles de chaque proposition mélangée, nommées par leur rang (« la 2 : Rayon 20 px »). Le
 * panneau est au-dessus de la proposition : une jauge qui agrandit la maquette ne part pas sous la
 * souris. `html-interactif-apercu.mjs` le prouve en bougeant chaque jauge (code 9 sinon).
 */

const MAX_REGLAGES = 8
const VARIABLE = /^--[a-z][a-z0-9-]*$/i
const COULEUR = /^#[0-9a-f]{6}$/i
const UNITE = /^[a-z%]{0,4}$/i

const echapper = (texte) =>
  String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Le pas par défaut : 1 pour une grande étendue (des pixels), 0,1 pour une petite (une durée). */
const pasDe = (r) => r.pas ?? (r.max - r.min >= 10 ? 1 : 0.1)

const estUnNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur)

const valeurLue = (r) => (r.couleur ? r.couleur.toLowerCase() : `${r.valeur}${r.unite ?? ''}`)

/** Vraiment lue : `var(--x)` ou `var(--x, repli)`. Le nom seul ne suffit pas : `--ex-tail` ≠ `--ex-taille`. */
const litLaVariable = (texte, variable) => new RegExp(`var\\(\\s*${variable}\\s*[,)]`).test(texte)

/** Une maquette qui pose elle-même la variable la fixe plus près des éléments que le curseur. */
const poseLaVariable = (texte, variable) =>
  new RegExp(`(?:^|[\\s;{"'])${variable}\\s*:`).test(texte)

/** Le curseur natif ramène sa valeur sur un cran : hors cran, la maquette changerait toute seule. */
const surUnCran = (r) => {
  const crans = (r.valeur - r.min) / pasDe(r)
  return Math.abs(crans - Math.round(crans)) < 1e-6
}

/**
 * Les raisons pour lesquelles ces réglages ne peuvent pas devenir des curseurs ; [] si aucune.
 * `css` : tout le texte des maquettes, pour refuser un curseur que rien ne lit.
 */
export function verifierReglages(reglages, css = '') {
  if (!Array.isArray(reglages) || reglages.length < 1 || reglages.length > MAX_REGLAGES)
    return [`« reglages » : de 1 à ${MAX_REGLAGES} attendus`]
  const erreurs = []
  const vues = new Set()
  reglages.forEach((r, i) => {
    const rang = `réglage ${i + 1}`
    if (!r?.nom) erreurs.push(`${rang} : « nom » manquant`)
    if (typeof r?.variable !== 'string' || !VARIABLE.test(r.variable)) {
      erreurs.push(`${rang} : « variable » attendue sous la forme --ma-variable`)
      return
    }
    if (r.variable.startsWith('--dk-'))
      erreurs.push(`${rang} : le préfixe « --dk- » est réservé au carrousel`)
    if (vues.has(r.variable)) erreurs.push(`${rang} : ${r.variable} déclarée deux fois`)
    vues.add(r.variable)
    if (!litLaVariable(css, r.variable))
      erreurs.push(`${rang} : aucune maquette ne lit ${r.variable}, le curseur ne changerait rien`)
    if (poseLaVariable(css, r.variable))
      erreurs.push(`${rang} : une maquette pose ${r.variable}, elle écraserait le curseur`)
    if (r.couleur !== undefined) {
      if (typeof r.couleur !== 'string' || !COULEUR.test(r.couleur))
        erreurs.push(`${rang} : « couleur » attendue sous la forme #rrggbb`)
      return
    }
    if (!estUnNombre(r.min) || !estUnNombre(r.max) || r.min >= r.max)
      erreurs.push(`${rang} : « min » et « max » attendus, min sous max`)
    else if (!estUnNombre(r.valeur) || r.valeur < r.min || r.valeur > r.max)
      erreurs.push(`${rang} : « valeur » attendue entre min et max`)
    else if (r.pas === undefined || (estUnNombre(r.pas) && r.pas > 0)) {
      if (!surUnCran(r))
        erreurs.push(
          `${rang} : « valeur » ${r.valeur} tombe entre deux crans (min ${r.min}, pas ${pasDe(r)}), le curseur la remplacerait`
        )
    }
    if (r.pas !== undefined && !(estUnNombre(r.pas) && r.pas > 0))
      erreurs.push(`${rang} : « pas » attendu positif`)
    if (r.unite !== undefined && (typeof r.unite !== 'string' || !UNITE.test(r.unite)))
      erreurs.push(`${rang} : « unite » attendue courte (px, s, %, em…)`)
  })
  return erreurs
}

/**
 * Le panneau. Ni enfant direct de `.dkc-car` (`.dkc-car>input` y est caché, et les règles du carrousel
 * marchent par frères), ni `id` en `dkp`/`dkm` : ces champs ne pilotent rien d'autre que les variables.
 */
export function panneauReglages(reglages) {
  const champs = reglages.map((r, i) => {
    const id = `dkr${i + 1}`
    const communs = `id="${id}" data-variable="${r.variable}" data-nom="${echapper(r.nom)}"`
    const champ = r.couleur
      ? `<input type="color" ${communs} value="${r.couleur.toLowerCase()}">`
      : `<input type="range" ${communs} data-unite="${r.unite ?? ''}" min="${r.min}" max="${r.max}" step="${pasDe(r)}" value="${r.valeur}">`
    const lu = r.couleur ? r.couleur.toLowerCase() : `${r.valeur}${r.unite ? ` ${r.unite}` : ''}`
    return `<label for="${id}" class="dkc-rgl"><span class="dkc-rgn">${echapper(r.nom)}</span>${champ}<output class="dkc-rgv" for="${id}">${lu}</output></label>`
  })
  // Le titre dit la proposition réglée : chacune garde ses valeurs (le script le tient à jour).
  return `<div class="dkc-rg"><span class="dkc-rgt">Réglages de la 1</span>${champs.join('')}<button type="button" class="dkc-rgz">Valeurs d’origine</button></div>`
}

/**
 * Le style du panneau, et les valeurs d'origine en CSS : la maquette est juste même avant le script.
 * Mêmes aplats que le reste du carrousel (`background-image`, voir draft-carrousel.mjs : le thème
 * clair force `background-color`). Les boutons passent à la ligne : ils portent maintenant les valeurs.
 * Le panneau reste à sa place dans le document (les règles du carrousel marchent par frères) : `order`
 * seul le remonte, sous « Tout voir » et le compteur, qui passent donc devant lui.
 */
export function styleReglages(reglages) {
  const mono = 'var(--mono,ui-monospace,Consolas,monospace)'
  return `
.dkc-w{${reglages.map((r) => `${r.variable}:${valeurLue(r)}`).join(';')}}
.dkc-tog{order:-3}
.dkc-nav,.dkc-gtx{order:-2}
.dkc-rg{order:-1;flex:0 0 100%;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-bottom:10px;padding:8px 10px;box-sizing:border-box;border-radius:10px;background-image:linear-gradient(var(--dk-gris),var(--dk-gris))}
.dkc-rg[hidden],.dkc-rgl[hidden]{display:none}
.dkc-rgt{flex:0 0 auto;color:var(--dk-pale);font:600 10.5px/1.2 ${mono};letter-spacing:.06em;text-transform:uppercase}
.dkc-rgl{flex:1 1 170px;min-width:0;display:flex;flex-wrap:nowrap;align-items:center;gap:8px;color:var(--dk-dim);font-size:12px}
.dkc-rgn{flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dkc-rgl input[type=range]{flex:1 1 60px;min-width:40px;margin:0;accent-color:var(--dk-rose);cursor:pointer}
.dkc-rgl input[type=color]{flex:0 0 26px;width:26px;height:20px;margin:0;padding:0;border:0;background:none;cursor:pointer}
.dkc-rgv{flex:0 0 auto;color:var(--dk-texte);font:11px ${mono}}
.dkc-rgz{flex:0 0 auto;margin-left:auto;padding:4px 10px;border:0;border-radius:999px;background-image:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair));color:var(--dk-dim);font:inherit;font-size:11.5px;cursor:pointer}
.dkc-rgz:hover{color:var(--dk-texte)}
.dkc-ac .dkc-bt,.dkc-mxa a{white-space:normal;max-width:100%;padding-top:6px;padding-bottom:6px}`
}

/**
 * Le script de la page. CHAQUE PROPOSITION GARDE SES VALEURS (conv-1382, 2026-10-31) : le panneau
 * règle la proposition affichée (la carte choisie en « Tout voir »), et ses valeurs sont posées sur
 * SA diapositive et SA vignette ; les autres gardent les leurs. Avant, une seule valeur posée sur tout
 * le carrousel : « Rayon 20 » pour la 1 l'imposait aussi à la 2, qu'on avait peut-être réglée à 30.
 * Les valeurs sont retenues par rang dans le localStorage de la page (gardé par le fil) : une page
 * quittée puis rouverte revient sur ce qu'on avait réglé, comme le rang affiché d'une scène 3D
 * (`SCRIPT_PLACE_SCENE`). Chaque diapositive expose aussi ses valeurs dans `data-reglages`, pour le
 * message du Mixer par axe (draft-axes.mjs).
 *
 * Qui lit quoi se relève dans la page : le navigateur a déjà rangé les règles et sait à quels
 * éléments elles s'appliquent, là où `css` mêle toutes les maquettes. Un état (`:hover`) ou un
 * pseudo-élément ne dit rien du rang : on l'ôte du sélecteur. Dans le doute, la jauge reste (une règle
 * de `@keyframes`, un sélecteur illisible) : le contrôle de l'aperçu tranche ensuite par l'effet réel.
 */
export const SCRIPT_REGLAGES = `;(() => {
  const panneau = document.querySelector('.dkc-rg')
  if (!document.querySelector('.dkc-w') || !panneau) return
  const CLE = 'dkc-reglages'
  const champs = Array.from(panneau.querySelectorAll('input'))
  const titre = panneau.querySelector('.dkc-rgt')
  const rangsDe = (a) => (a.closest('.dkc-ac, .dkc-mxa span')?.className.match(/\\d+/g) ?? []).map(Number)
  const liens = Array.from(document.querySelectorAll('.dkc-ac a, .dkc-mxa a')).map((a) => [a, a.textContent, rangsDe(a)])
  const unite = (c) => c.dataset.unite || ''
  const lu = (c, valeur) => (unite(c) ? valeur + ' ' + unite(c) : valeur)
  const aPlat = (regles) => Array.from(regles ?? []).flatMap((r) => [r, ...aPlat(r.cssRules)])
  const regles = Array.from(document.styleSheets).flatMap((f) => aPlat(f.cssRules))
  const vise = (carte, selecteur) => {
    try {
      return Boolean(carte.querySelector(selecteur.replace(/::?[a-z-]+(\\([^)]*\\))?/gi, '') || '*'))
    } catch {
      return true
    }
  }
  const lit = (carte, variable) => {
    const motif = new RegExp('var\\\\(\\\\s*' + variable + '\\\\s*[,)]')
    return (
      motif.test(carte.innerHTML) ||
      regles.some((r) => r.style && motif.test(r.style.cssText) && (!r.selectorText || vise(carte, r.selectorText)))
    )
  }
  const cartes = Array.from(document.querySelectorAll('.dkc-sl .dkc-mq'))
  const rangs = cartes.map((_, i) => i + 1)
  const lectrices = new Map(
    champs.map((c) => [c, cartes.flatMap((carte, i) => (lit(carte, c.dataset.variable) ? [i + 1] : []))])
  )
  // Seules les valeurs qui diffèrent de l'origine, par rang : { 2: { dkr1: '30' } }.
  const valeurs = {}
  const rang = () => Number(document.querySelector('input[name=dkp]:checked')?.id.slice(3)) || 1
  const retenir = (n, c, valeur) => {
    const siennes = valeurs[n] || (valeurs[n] = {})
    if (valeur === c.defaultValue) delete siennes[c.id]
    else siennes[c.id] = valeur
    if (!Object.keys(siennes).length) delete valeurs[n]
  }
  const siennes = (n) =>
    champs
      .filter((c) => valeurs[n]?.[c.id] !== undefined && lectrices.get(c).includes(n))
      .map((c) => c.dataset.nom + ' ' + lu(c, valeurs[n][c.id]))
  const poser = (n) => {
    const porteuses = document.querySelectorAll('.dkc-s' + n + ', .dkc-t' + n)
    for (const c of champs)
      for (const e of porteuses)
        if (valeurs[n]?.[c.id] === undefined) e.style.removeProperty(c.dataset.variable)
        else e.style.setProperty(c.dataset.variable, valeurs[n][c.id] + unite(c))
  }
  const libeller = () => {
    for (const n of rangs) {
      const diapo = document.querySelector('.dkc-s' + n)
      if (diapo) diapo.dataset.reglages = siennes(n).join(', ')
    }
    for (const [a, base, sesRangs] of liens) {
      const suite = sesRangs
        .map((n) => [n, siennes(n).join(', ')])
        .filter(([, texte]) => texte)
        .map(([n, texte]) => (sesRangs.length > 1 ? 'la ' + n + ' : ' + texte : texte))
      a.textContent = base + (suite.length ? ' — ' + suite.join(' ; ') : '')
    }
  }
  const montrer = () => {
    const n = rang()
    for (const c of champs) {
      c.value = valeurs[n]?.[c.id] ?? c.defaultValue
      c.nextElementSibling.textContent = lu(c, c.value)
      c.closest('.dkc-rgl').hidden = !lectrices.get(c).includes(n)
    }
    panneau.hidden = !champs.some((c) => lectrices.get(c).includes(n))
    if (titre) titre.textContent = 'Réglages de la ' + n
  }
  const garder = () => {
    if (Object.keys(valeurs).length) localStorage.setItem(CLE, JSON.stringify(valeurs))
    else localStorage.removeItem(CLE)
  }
  // Le champ ramène une valeur retenue dans ses bornes et sur un cran : ce qui est posé est ce qu'il montre.
  const normale = (c, valeur) => {
    const avant = c.value
    c.value = valeur
    const lue = c.value
    c.value = avant
    return lue
  }
  try {
    const retenu = JSON.parse(localStorage.getItem(CLE) || '{}')
    for (const n of rangs) {
      const lot = retenu?.[n]
      if (!lot || typeof lot !== 'object') continue
      for (const c of champs) if (typeof lot[c.id] === 'string') retenir(n, c, normale(c, lot[c.id]))
    }
  } catch {
    localStorage.removeItem(CLE)
  }
  panneau.addEventListener('input', () => {
    const n = rang()
    for (const c of champs) {
      retenir(n, c, c.value)
      c.nextElementSibling.textContent = lu(c, c.value)
    }
    poser(n)
    libeller()
    garder()
  })
  panneau.querySelector('.dkc-rgz').addEventListener('click', () => {
    const n = rang()
    delete valeurs[n]
    poser(n)
    montrer()
    libeller()
    garder()
  })
  document.querySelector('.dkc-car')?.addEventListener('change', (e) => {
    if (!panneau.contains(e.target)) montrer()
  })
  for (const n of rangs) poser(n)
  montrer()
  libeller()
})()`
