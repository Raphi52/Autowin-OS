/**
 * Copie PROPRE vers les autres applications (Gmail, Outlook, Word…).
 *
 * Pourquoi (conv-1073, 2026-10-22) : un Ctrl+C dans Autowin collé dans Gmail donnait des bandes
 * NOIRES, une par paragraphe. Cause reproduite dans Chromium : à la copie, Chromium sérialise le
 * HTML sélectionné AVEC les styles calculés de chaque bloc — `background-color: rgb(11, 15, 23)`
 * (le fond sombre de l'app, hérité d'un ancêtre), `color` clair, police, taille… —, et Gmail garde
 * ces styles en ligne. Le défaut n'est donc pas dans un message précis mais dans le presse-papiers
 * produit par toute sélection de l'app.
 *
 * Correctif à la source : à l'événement `copy`, on remplace ce HTML par un clone de la sélection
 * débarrassé de tout style, classe et attribut d'interface. La STRUCTURE reste (paragraphes, gras,
 * listes, tableaux, liens) ; le thème, lui, reste dans l'app. Le texte brut est inchangé.
 */

/** Éléments d'interface, jamais du contenu : ils n'ont rien à faire dans un mail. */
const ELEMENTS_RETIRES = new Set([
  'BUTTON',
  'SVG',
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'IFRAME',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'NOSCRIPT',
  'TEMPLATE'
])

/** Seuls attributs qui portent du CONTENU, par balise. Tout le reste (style, class, id, data-*) part. */
const ATTRIBUTS_GARDES: Record<string, readonly string[]> = {
  A: ['href'],
  IMG: ['src', 'alt'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  OL: ['start']
}

/**
 * Ancêtres à remettre autour d'une sélection PARTIELLE : `cloneContents` ne rend que l'intérieur
 * de l'ancêtre commun, donc un mot sélectionné dans un `<strong>` perdrait son gras, et des lignes
 * de tableau perdraient leur `<table>`. On ne remet que ce qui change le SENS ou la validité,
 * jamais un `<div>` ou un `<p>` de mise en page.
 */
const ANCETRES_A_REMETTRE = new Set([
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'DEL',
  'CODE',
  'PRE',
  'A',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'UL',
  'OL',
  'BLOCKQUOTE'
])

function urlSure(valeur: string): boolean {
  return /^(https?:|mailto:|data:image\/)/i.test(valeur.trim())
}

/** Retire en place tout ce qui vient du thème ou de l'interface. */
export function nettoyerPourCopie(racine: ParentNode): void {
  const elements = Array.from(racine.querySelectorAll('*'))
  for (const el of elements) {
    const balise = el.tagName.toUpperCase()
    if (ELEMENTS_RETIRES.has(balise) || el.getAttribute('aria-hidden') === 'true') {
      el.remove()
      continue
    }
    const gardes = ATTRIBUTS_GARDES[balise] ?? []
    for (const attribut of Array.from(el.attributes)) {
      const nom = attribut.name.toLowerCase()
      const garde =
        gardes.includes(nom) && (nom === 'href' || nom === 'src' ? urlSure(attribut.value) : true)
      if (!garde) el.removeAttribute(attribut.name)
    }
  }
}

function enveloppeVide(original: Element, document: Document): Element {
  const copie = document.createElement(original.tagName.toLowerCase())
  const gardes = ATTRIBUTS_GARDES[original.tagName.toUpperCase()] ?? []
  for (const nom of gardes) {
    const valeur = original.getAttribute(nom)
    if (valeur !== null && (nom === 'href' || nom === 'src' ? urlSure(valeur) : true))
      copie.setAttribute(nom, valeur)
  }
  return copie
}

/** HTML propre d'une plage : son contenu, ré-enveloppé dans ses ancêtres porteurs de sens. */
export function htmlPropreDeLaPlage(plage: Range): string {
  const document = plage.startContainer.ownerDocument
  if (!document) return ''
  let contenu: Node = plage.cloneContents()
  let ancetre: Node | null = plage.commonAncestorContainer
  if (ancetre && ancetre.nodeType !== Node.ELEMENT_NODE) ancetre = ancetre.parentNode
  while (ancetre && ancetre.nodeType === Node.ELEMENT_NODE && ancetre !== document.body) {
    const el = ancetre as Element
    if (ANCETRES_A_REMETTRE.has(el.tagName.toUpperCase())) {
      const enveloppe = enveloppeVide(el, document)
      enveloppe.appendChild(contenu)
      contenu = enveloppe
    }
    ancetre = el.parentNode
  }
  const boite = document.createElement('div')
  boite.appendChild(contenu)
  nettoyerPourCopie(boite)
  return boite.innerHTML
}

/** Un champ de saisie garde sa copie native (texte brut, ou l'éditeur qui gère la sienne). */
function dansUnChampDeSaisie(cible: EventTarget | null): boolean {
  if (!cible || !(cible instanceof Element)) return false
  const el = cible as HTMLElement
  return (
    el.isContentEditable ||
    el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') !== null
  )
}

/**
 * Remplit le presse-papiers avec la version propre. Rend `false` — et laisse alors la copie
 * native intacte — quand il n'y a rien à nettoyer ou que la copie vient d'un champ de saisie.
 */
export function gererCopie(evenement: ClipboardEvent, selection: Selection | null): boolean {
  if (!evenement.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0)
    return false
  if (dansUnChampDeSaisie(evenement.target)) return false
  const texte = selection.toString()
  if (!texte) return false
  const morceaux: string[] = []
  for (let i = 0; i < selection.rangeCount; i += 1)
    morceaux.push(htmlPropreDeLaPlage(selection.getRangeAt(i)))
  evenement.clipboardData.setData('text/plain', texte)
  evenement.clipboardData.setData('text/html', morceaux.join(''))
  evenement.preventDefault()
  return true
}

/** Branché une fois, pour toute la vie de la fenêtre (comme la sonde de gels). */
export function installerCopiePropre(cible: Document = document): void {
  cible.addEventListener('copy', (evenement) => {
    gererCopie(evenement, cible.getSelection())
  })
}
