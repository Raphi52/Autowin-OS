/**
 * MÉLANGER PAR AXE DANS LE CARROUSEL /draft (conv-1338, 2026-10-30, piste du scout conv-1332).
 *
 * Le profil de l'utilisateur : « chaque proposition a un visuel ET un fonctionnement distincts et
 * nommés, pour pouvoir mixer (visuel de la 6, fonctionnement de la 1 et 2) ». Le Mixer du carrousel
 * ne mélange que des propositions entières, par des boutons précalculés : croiser deux axes en
 * demanderait 448 pour 6 propositions, et le filtre du fil n'accepte aucun champ de commentaire.
 *
 *   "propositions": [
 *     { "nom": "Rail", "html": "…", "visuel": "rail sombre, filets fins", "fonctionnement": "onglets" }
 *   ]
 *
 * Les deux champs sont facultatifs, mais présents sur TOUTES les propositions ou sur aucune : un
 * mélange demi-renseigné nommerait un axe qui n'existe pas.
 *
 * UN COMMENTAIRE EXIGE DU CODE : le carrousel passe en page ```html-interactif, comme avec une scène
 * ou des réglages (`carrouselEnPage`), et ce mélange REMPLACE les boutons précalculés. Ses boutons
 * REMPLISSENT alors la saisie au lieu d'envoyer (amorce.js) : un Entrée de plus, y compris sur
 * « Affiner la N ». Sans ces champs, le carrousel reste un ```html-render sans script. Avec
 * `"mixer": false`, la fiche garde sa description et le carrousel reste lui aussi sans script.
 *
 * CE QUI PART EST CE QUI EST ÉCRIT : le message est affiché en toutes lettres au-dessus des boutons,
 * et c'est ce texte-là qui part : « Mixer : visuel de la 6 · fonctionnement de la 1 + 2 — plus dense ».
 * Les réglages modifiés y figurent, comme sur les boutons du carrousel (draft-reglages.mjs).
 */

/** Le message entier reste loin des 4 000 caractères de la saisie (`MAX_SAISIE`, amorce.js). */
export const COMMENTAIRE_MAX = 1000

export const AXES = [
  ['visuel', 'Visuel'],
  ['fonctionnement', 'Fonctionnement']
]

const aDesAxes = (p) => AXES.some(([axe]) => p?.[axe] !== undefined)

/** Vrai si au moins une proposition décrit ses axes. */
export const propositionsAvecAxes = (propositions) =>
  Array.isArray(propositions) && propositions.some(aDesAxes)

/** Le mélange par axe remplace le Mixer ; `"mixer": false` les retire tous les deux. */
export const carrouselAvecAxes = (spec) =>
  spec.mixer !== false && propositionsAvecAxes(spec.propositions)

/** Les raisons pour lesquelles ces axes ne sont pas utilisables ; [] si aucune. */
export function verifierAxes(propositions) {
  if (!propositionsAvecAxes(propositions)) return []
  const erreurs = []
  propositions.forEach((p, i) => {
    for (const [axe] of AXES)
      if (typeof p?.[axe] !== 'string' || !p[axe].trim())
        erreurs.push(`proposition ${i + 1} : « ${axe} » attendu en texte, sur chaque proposition`)
  })
  return erreurs
}

/**
 * Le panneau, replié par défaut comme le Mixer. Deux rangées de cases numérotées plutôt que deux
 * cases sous chaque vignette : à 10 propositions, une vignette fait 50 px, « Fonctionnement » n'y
 * tient pas. Le numéro est celui de la vignette.
 */
export function panneauAxes(propositions) {
  const rangee = ([axe, nom]) =>
    `<div class="dkc-axr"><span class="dkc-axn">${nom}</span>${propositions
      .map((_, i) => {
        const n = i + 1
        return `<label class="dkc-axc"><input type="checkbox" data-axe="${axe}" data-n="${n}"><span>${n}</span></label>`
      })
      .join('')}</div>`
  return (
    `<details class="dkc-ax"><summary>Mixer par axe</summary>${AXES.map(rangee).join('')}` +
    `<textarea rows="2" maxlength="${COMMENTAIRE_MAX}" placeholder="Commentaire (facultatif)"></textarea>` +
    '<output></output><div class="dkc-axb">' +
    '<button type="button" data-verbe="Mixer" disabled>Mixer</button>' +
    '<button type="button" data-verbe="Implémenter" disabled>Implémenter</button>' +
    '</div></details>'
  )
}

/**
 * Les aplats passent par `background-image`, comme tout le carrousel : le thème clair force
 * `background-color` (voir l'en-tête de draft-carrousel.mjs).
 */
export function styleAxes() {
  const mono = 'var(--mono,ui-monospace,Consolas,monospace)'
  return `
.dkc-axf{display:flex;flex-direction:column;flex-wrap:nowrap;gap:2px;margin-top:8px;color:var(--dk-dim);font-size:12.5px}
.dkc-axf b{color:var(--dk-texte);font-weight:600;margin-right:4px}
.dkc-ax{flex:0 0 100%;min-width:0;margin-top:10px;padding:8px 10px;box-sizing:border-box;border-radius:10px;background-image:linear-gradient(var(--dk-gris),var(--dk-gris))}
.dkc-ax summary{color:var(--dk-texte);font-size:12.5px;font-weight:600;cursor:pointer}
.dkc-axr{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:8px}
.dkc-axn{flex:0 0 100px;color:var(--dk-dim);font-size:12px}
.dkc-axc{display:inline-flex;align-items:center;gap:3px;padding:2px 4px;border-radius:6px;background-image:linear-gradient(var(--dk-plaque),var(--dk-plaque));color:var(--dk-texte);font:11px ${mono};cursor:pointer}
.dkc-axc input{margin:0;accent-color:var(--dk-rose);cursor:pointer}
.dkc-ax textarea{display:block;width:100%;margin-top:8px;padding:6px 8px;box-sizing:border-box;border:0;border-radius:8px;background-image:linear-gradient(var(--dk-plaque),var(--dk-plaque));color:var(--dk-texte);font:inherit;font-size:12.5px;resize:vertical}
.dkc-ax output{display:block;margin-top:8px;color:var(--dk-dim);font-size:12.5px;overflow-wrap:anywhere}
.dkc-axb{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.dkc-axb button{min-height:32px;padding:0 14px;border:0;border-radius:999px;background-image:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair));color:var(--dk-texte);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.dkc-axb button:first-child{background-image:var(--dk-degrade);color:#ffffff;-webkit-text-fill-color:#ffffff}
.dkc-axb button:disabled{opacity:.45;cursor:default}`
}

/**
 * Le script de la page. Le message n'existe qu'une fois : affiché, puis remis à la saisie tel quel.
 * Il faut au moins 2 propositions, comme pour le Mixer : une seule, même sur ses deux axes, n'est pas
 * un mélange. Les réglages sont relus à chaque changement dans le panneau voisin, y compris au clic
 * sur « Valeurs d'origine », qui ne produit aucun événement `input`.
 */
export const SCRIPT_AXES = `;(() => {
  const zone = document.querySelector('.dkc-ax')
  if (!zone) return
  const cases = Array.from(zone.querySelectorAll('input[type=checkbox]'))
  const commentaire = zone.querySelector('textarea')
  const sortie = zone.querySelector('output')
  const boutons = Array.from(zone.querySelectorAll('button'))
  const AUCUN = 'Coche au moins 2 propositions à mélanger'
  const cochees = (axe) => cases.filter((c) => c.checked && c.dataset.axe === axe).map((c) => c.dataset.n)
  const axe = (nom, numeros) => (numeros.length ? [nom + ' de la ' + numeros.join(' + ')] : [])
  const reglages = () =>
    Array.from(document.querySelectorAll('.dkc-rg input'))
      .filter((c) => c.value !== c.defaultValue)
      .map((c) => c.dataset.nom + ' ' + (c.dataset.unite ? c.value + ' ' + c.dataset.unite : c.value))
  const message = (verbe) => {
    const melange = [...axe('visuel', cochees('visuel')), ...axe('fonctionnement', cochees('fonctionnement'))]
    const valeurs = reglages()
    const mot = commentaire.value.replace(/\\s+/g, ' ').trim()
    return (
      verbe + ' : ' + melange.join(' · ') +
      (valeurs.length ? ' — ' + valeurs.join(', ') : '') +
      (mot ? ' — ' + mot : '')
    )
  }
  const pret = () => new Set([...cochees('visuel'), ...cochees('fonctionnement')]).size >= 2
  const actualiser = () => {
    const possible = pret()
    for (const b of boutons) b.disabled = !possible
    sortie.textContent = possible ? message('Mixer') : AUCUN
  }
  for (const b of boutons)
    b.addEventListener('click', () => {
      if (pret()) window.autowin.remplirSaisie(message(b.dataset.verbe))
    })
  const racine = document.querySelector('.dkc-w') ?? zone
  racine.addEventListener('input', actualiser)
  racine.addEventListener('click', actualiser)
  actualiser()
})()`
