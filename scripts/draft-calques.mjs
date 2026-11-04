/**
 * CALQUES NOMMÉS ET ÉTATS D'UNE PROPOSITION /draft (conv-1470, 2026-11-04, pistes du /steal Hera et
 * Lottie Creator).
 *
 * Hera rend des visuels dont chaque partie se retouche seule ; ici une proposition était un bloc
 * `html` opaque : pour changer son bouton, il fallait le décrire en toutes lettres. Une maquette
 * NOMME maintenant ses parties avec `data-calque="Bouton"` ; le panneau de la proposition affichée
 * les liste, et un clic remplit la saisie avec « Proposition 2 — calque Bouton : » (page
 * ```html-interactif : les liens remplissent la saisie, amorce.js).
 *
 * Lottie Creator montre une animation dans ses états ; une maquette /draft ne montrait que son état
 * de repos. Une proposition déclare `"etats": ["survol", "chargement", "erreur"]` ; un bouton par
 * état pose la classe `dk-etat-<état>` sur SA diapositive et SA vignette seulement (comme les
 * réglages, conv-1382 : un contrôle d'une proposition ne change jamais une autre). La maquette
 * écrit ses règles en conséquence : `.dk-etat-erreur .ex-champ{border-color:…}`.
 *
 * Sans `data-calque` ni `etats`, rien n'est ajouté : le carrousel reste octet pour octet le même.
 */

export const MAX_CALQUES = 12
const NOM_ETAT = /^[a-z0-9-]+$/

const echapper = (texte) =>
  String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Les noms de calques d'une maquette, dans l'ordre, sans doublon ni nom vide. */
export function calquesDe(html) {
  const noms = []
  for (const [, nom] of String(html ?? '').matchAll(/\bdata-calque\s*=\s*"([^"]*)"/gi)) {
    const propre = nom.trim()
    if (propre && !noms.includes(propre)) noms.push(propre)
  }
  return noms
}

const etatsDe = (p) => (Array.isArray(p?.etats) ? p.etats : [])

/** Au moins un calque ou un état : il faut le panneau, donc une page. */
export const propositionsAvecCalques = (propositions) =>
  Array.isArray(propositions) &&
  propositions.some((p) => calquesDe(p?.html).length || etatsDe(p).length)

/** Les raisons pour lesquelles ces `etats` ne peuvent pas devenir des boutons ; [] si aucune. */
export function verifierEtats(propositions) {
  const erreurs = []
  propositions.forEach((p, i) => {
    if (p?.etats === undefined) return
    const rang = `proposition ${i + 1}`
    if (!Array.isArray(p.etats)) {
      erreurs.push(`${rang} : « etats » : une liste de noms attendue, ex. ["survol","erreur"]`)
      return
    }
    const vus = new Set()
    for (const etat of p.etats) {
      if (typeof etat !== 'string' || !NOM_ETAT.test(etat))
        erreurs.push(
          `${rang} : état « ${String(etat)} » : lettres minuscules, chiffres et « - » seulement`
        )
      else if (vus.has(etat)) erreurs.push(`${rang} : état « ${etat} » déclaré deux fois`)
      vus.add(etat)
    }
  })
  return erreurs
}

/**
 * Un panneau par proposition, enfant DIRECT de `.dkc-car` (les cases radio `dkp` le montrent par
 * frères) ; rien pour une proposition sans calque ni état.
 */
export function panneauCalques(P) {
  return P.map((p) => {
    const calques = calquesDe(p.html)
    const etats = etatsDe(p)
    if (!calques.length && !etats.length) return ''
    const boutonsEtats = etats.length
      ? `<span class="dkc-cqt">États</span><button type="button" class="dkc-ce" data-rang="${p.n}" data-etat="" aria-pressed="true">repos</button>${etats
          .map(
            (e) =>
              `<button type="button" class="dkc-ce" data-rang="${p.n}" data-etat="${e}" aria-pressed="false">${e}</button>`
          )
          .join('')}<span class="dkc-cev">État de la ${p.n} : repos</span>`
      : ''
    const montres = calques.slice(0, MAX_CALQUES)
    const liensCalques = calques.length
      ? `<span class="dkc-cqt">Calques</span>${montres
          .map(
            (c) =>
              `<a href="#autowin-prompt" class="dkc-cl">Proposition ${p.n} — calque ${echapper(c)} : </a>`
          )
          .join(
            ''
          )}${calques.length > MAX_CALQUES ? `<span class="dkc-clx">+${calques.length - MAX_CALQUES}</span>` : ''}`
      : ''
    return `<div class="dkc-cq dkc-cq${p.n}">${boutonsEtats}${liensCalques}</div>`
  })
    .filter(Boolean)
    .join('\n')
}

/** Le style : seul le panneau de la proposition cochée se voit. Aplats en `background-image` (thème clair). */
export function styleCalques(n) {
  const mono = 'var(--mono,ui-monospace,Consolas,monospace)'
  const rangs = Array.from({ length: n }, (_, i) => `#dkp${i + 1}:checked~.dkc-cq${i + 1}`).join(
    ','
  )
  return `
.dkc-cq{display:none;flex:0 0 100%;min-width:0;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;padding:8px 10px;box-sizing:border-box;border-radius:10px;background-image:linear-gradient(var(--dk-gris),var(--dk-gris))}
${rangs}{display:flex}
.dkc-cqt{color:var(--dk-pale);font:600 10.5px/1.2 ${mono};letter-spacing:.06em;text-transform:uppercase}
.dkc-ce,.dkc-cl{padding:3px 9px;border:0;border-radius:999px;background-image:linear-gradient(var(--dk-gris-clair),var(--dk-gris-clair));color:var(--dk-dim);font:inherit;font-size:11.5px;text-decoration:none;cursor:pointer}
.dkc-ce:hover,.dkc-cl:hover,.dkc-ce[aria-pressed=true]{color:var(--dk-texte)}
.dkc-cev,.dkc-clx{color:var(--dk-dim);font:11px ${mono}}`
}

/** Le script : un état posé sur la diapositive et la vignette de SA proposition, jamais d'une autre. */
export const SCRIPT_CALQUES = `;(() => {
  for (const b of document.querySelectorAll('.dkc-ce')) {
    b.addEventListener('click', () => {
      const n = b.dataset.rang
      for (const e of document.querySelectorAll('.dkc-s' + n + ', .dkc-t' + n)) {
        for (const c of Array.from(e.classList)) if (c.startsWith('dk-etat-')) e.classList.remove(c)
        if (b.dataset.etat) e.classList.add('dk-etat-' + b.dataset.etat)
      }
      const panneau = b.closest('.dkc-cq')
      for (const autre of panneau.querySelectorAll('.dkc-ce')) autre.setAttribute('aria-pressed', String(autre === b))
      const lu = panneau.querySelector('.dkc-cev')
      if (lu) lu.textContent = 'État de la ' + n + ' : ' + (b.dataset.etat || 'repos')
    })
  }
})()`
