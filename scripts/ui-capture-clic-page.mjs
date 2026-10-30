/**
 * CLIQUER DANS UNE PAGE INTERACTIVE DU FIL — `ui-capture.mjs --clic-page` (conv-1304, 2026-10-30).
 *
 * Un bloc ```html-interactif tourne dans un cadre ISOLE (origine opaque, souvent un autre
 * processus) : la page de l'app ne voit pas son contenu, et `--click` (un `element.click()` dans la
 * page de l'app) ne l'atteint pas. Pire, un clic de script n'est pas un geste de l'utilisateur : le
 * fil refuse ce qu'une page demande sans vrai clic (copie, lien, remplissage de la saisie,
 * BlocHtmlInteractif.tsx). Ce geste-ci :
 *   1. trouve la cible DANS le cadre, par le protocole de debogage (monde isole du cadre, ou session
 *      du cadre s'il vit dans un autre processus) — ni le DOM ni les scripts de la page ne bougent ;
 *   2. amene son point a l'ecran par une vraie molette au-dessus du fil ;
 *   3. verifie que rien ne masque ce point dans la page de l'app (bouton flottant, tiroir) ;
 *   4. clique par une VRAIE souris (`Input.dispatchMouseEvent`) : le navigateur route le clic vers
 *      le cadre et donne l'activation utilisateur, exactement comme un clic a la main ;
 *   5. relit la zone de saisie et compte les messages de l'utilisateur, avant et apres.
 *
 * Ce module ne garde que les parties PURES (lecture des options, script cherche dans le cadre,
 * calcul du point, verdict) : `ui-capture.clic-page.test.mjs` les verrouille.
 */

/** Les elements qu'une cible `texte:` peut designer : ce qu'un utilisateur clique. */
export const CLIQUABLES_DE_PAGE =
  'a[href], button, summary, label, [role=button], input[type=button], input[type=submit]'

/** Le cadre d'une page interactive dans le fil (BlocHtmlInteractif.tsx). */
export const CADRE_DE_PAGE = '[data-testid="html-interactif-cadre"]'

/** Selecteur des messages de l'utilisateur dans le fil (ChatMessageRow.tsx). */
export const MESSAGES_UTILISATEUR = '[data-origine="message-utilisateur"]'

const valeurApres = (argv, nom) => {
  const i = argv.indexOf(nom)
  const v = i >= 0 ? argv[i + 1] : undefined
  return typeof v === 'string' && !v.startsWith('--') ? v : undefined
}

/**
 * Ce que `--clic-page <cible> [--page <selecteur>] [--saisie-attendue <texte>] [--champ <sel>]`
 * demande, ou null. Pure. La cible est un selecteur CSS DANS la page, ou `texte:<libelle>` : le
 * premier element cliquable VISIBLE dont le libelle vaut (ou commence par) ce texte. `--page` borne
 * la recherche a un bloc du fil (sa section ou son cadre) ; sans lui, chaque page montee est
 * fouillee dans l'ordre du fil.
 */
export function clicDansLaPage(argv) {
  const brut = valeurApres(argv, '--clic-page')
  if (brut === undefined || !brut.trim()) return null
  const texte = /^texte:\s*(.+)$/su.exec(brut.trim())
  return {
    cible: texte ? { texte: normaliser(texte[1]) } : { selecteur: brut.trim() },
    page: valeurApres(argv, '--page') ?? null,
    saisieAttendue: valeurApres(argv, '--saisie-attendue') ?? null,
    champ: valeurApres(argv, '--champ') ?? 'textarea'
  }
}

export const normaliser = (texte) =>
  String(texte ?? '')
    .replace(/\s+/gu, ' ')
    .trim()

/**
 * Le script joue DANS le cadre (monde isole) : la cible, son rectangle dans le cadre, son libelle,
 * et ce qui se trouve sous son centre. `null` si elle n'y est pas (encore). Une cible `texte:`
 * prefere un libelle EXACT, puis un libelle qui COMMENCE par le texte ; seuls les elements visibles
 * comptent — un carrousel garde ses boutons des autres propositions, caches.
 */
export function scriptCibleDansLaPage(cible) {
  return `(() => {
    const normaliser = (t) => String(t ?? '').replace(/\\s+/gu, ' ').trim()
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false
      return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true
    }
    const libelle = (el) => normaliser(el.value && el.tagName === 'INPUT' ? el.value : el.textContent)
    const cible = ${JSON.stringify(cible)}
    let el = null
    if (cible.selecteur) {
      el = [...document.querySelectorAll(cible.selecteur)].find(visible) ?? null
    } else {
      const candidats = [...document.querySelectorAll(${JSON.stringify(CLIQUABLES_DE_PAGE)})].filter(visible)
      el = candidats.find((c) => libelle(c) === cible.texte) ??
        candidats.find((c) => libelle(c).startsWith(cible.texte)) ?? null
    }
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const dessous = document.elementFromPoint(cx, cy)
    return {
      rect: { x: r.left, y: r.top, largeur: r.width, hauteur: r.height },
      libelle: libelle(el).slice(0, 200),
      balise: el.tagName.toLowerCase(),
      atteignable: Boolean(dessous && (dessous === el || el.contains(dessous)))
    }
  })()`
}

/**
 * Le point a cliquer dans la page de l'app : le centre de la cible, decale du coin du CONTENU du
 * cadre (bordure comprise). Pure. Les deux rectangles sont en pixels CSS de leur document : le zoom
 * de l'app s'applique au cadre comme a la page, ils s'additionnent sans conversion.
 */
export function pointDuClic(cadre, cible) {
  return {
    x: Math.round(cadre.x + (cadre.bordGauche ?? 0) + cible.x + cible.largeur / 2),
    y: Math.round(cadre.y + (cadre.bordHaut ?? 0) + cible.y + cible.hauteur / 2)
  }
}

/**
 * Le decalage vertical qui amene `y` au milieu de la zone visible, ou 0 s'il y est deja (marge de
 * 40 px aux bords : un bouton colle au bord peut passer sous une barre flottante). Pure.
 */
export function decalagePourVoir(y, zone) {
  const marge = Math.min(40, zone.hauteur / 4)
  if (y >= zone.haut + marge && y <= zone.haut + zone.hauteur - marge) return 0
  return Math.round(y - (zone.haut + zone.hauteur / 2))
}

/**
 * Les echecs nommes du geste, lus sur son rapport. Pure. Le geste doit avoir TROUVE et ATTEINT sa
 * cible ; avec `--saisie-attendue`, la saisie doit porter ce texte APRES le clic, et aucun message
 * ne doit etre parti — le contrat d'un bouton de choix de page interactive est de REMPLIR, jamais
 * d'envoyer.
 */
export function echecsDuClicPage(rapport) {
  if (!rapport) return []
  if (rapport.echec) return [rapport.echec]
  const echecs = []
  if (rapport.saisieAttendue !== null && rapport.saisieAttendue !== undefined) {
    if (normaliser(rapport.saisieApres) !== normaliser(rapport.saisieAttendue)) {
      echecs.push(`saisie-non-remplie(${normaliser(rapport.saisieApres).slice(0, 80) || 'vide'})`)
    }
    if ((rapport.messagesApres ?? 0) > (rapport.messagesAvant ?? 0)) {
      echecs.push(`message-envoye(${rapport.messagesAvant} -> ${rapport.messagesApres})`)
    }
  }
  return echecs
}
