/**
 * Assainit le HTML produit par un modele pour qu'il soit rendu DIRECTEMENT dans le fil du chat,
 * sans iframe (decision utilisateur 2026-08-08 : le rendu ne doit plus etre une « boite »).
 *
 * L'iframe etait la frontiere de securite ; en la retirant, le HTML du modele vit desormais dans le
 * DOM de l'application. Ce module est donc ce qui reste entre un modele et l'interface, et il
 * fonctionne par AUTORISATION EXPLICITE : tout ce qui n'est pas nomme ici est retire. Une whitelist
 * echoue en refusant du contenu legitime ; une blacklist echoue en laissant passer une attaque.
 *
 * Ce qui est refuse, et pourquoi :
 * - `<script>`, `on*=`, `javascript:` — execution de code dans l'origine de l'app ;
 * - `<style>` et `<link>` — une seule regle non scopee (`body{display:none}`) repeint TOUTE l'app ;
 * - `<iframe>`/`<object>`/`<embed>` — chargement distant et re-ouverture d'une surface d'execution ;
 * - `<form>`/`<input>` — hameconnage d'identifiants dans une fenetre qui a l'air d'etre l'app ;
 * - `position: fixed/absolute/sticky` et `z-index` en style inline — c'est ce qui permet a une
 *   reponse de RECOUVRIR l'interface au lieu de couler dedans (la faille d'un rendu inline) ;
 * - `url(...)` en CSS — vecteur de requete sortante depuis une valeur de style.
 */

/**
 * Au-dela de cette taille, le bloc n'est plus rendu : il est presente comme source repliee.
 * L'iframe precedente absorbait un document enorme dans un contexte separe ; en rendu inline, le
 * meme document devient des noeuds DOM de l'application et fige la fenetre. La limite est donc plus
 * necessaire qu'avant, pas moins.
 */
export const MAX_INLINE_HTML_CHARS = 1_000_000

/** Balises rendues. Mise en forme et structure de document uniquement — rien d'actif. */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var'
])

/**
 * Balises dont on retire l'ELEMENT ENTIER, contenu compris, au lieu de le deplier.
 * Le texte d'un `<script>` ou d'un `<style>` est du code : le conserver comme texte afficherait la
 * source brute au milieu de la reponse. Pour tout le reste, on deplie (un `<section>` inconnu ne doit
 * pas emporter le paragraphe qu'il contient).
 */
const DROP_WITH_CONTENT = new Set(['script', 'link', 'meta', 'title', 'noscript', 'template'])

const ALLOWED_ATTRS = new Set([
  'align',
  'alt',
  'class',
  'colspan',
  'datetime',
  'height',
  'rowspan',
  'span',
  'start',
  'title',
  'type',
  'value',
  'width'
])

/** Proprietes CSS inline autorisees : mise en forme dans le flux, jamais de positionnement. */
const ALLOWED_STYLE_PROPS = new Set([
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-color',
  'border-image',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-style',
  'border-top',
  'border-width',
  'color',
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'grid-template-columns',
  'height',
  'justify-content',
  'align-items',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'text-align',
  'text-decoration',
  'text-transform',
  'vertical-align',
  'white-space',
  'width',
  'word-break'
])

/**
 * Rythme vertical BORNE. Un bloc `html-render` arrive avec les marges genereuses que le modele
 * ecrit (sections a 40px, `line-height` a 2) : additionnees, elles forcent l'utilisateur a scroller
 * sur des ecrans de vide pour lire trois lignes. On ne supprime pas l'espacement — on le PLAFONNE,
 * cote inline comme cote feuille de style, seul endroit ou le rendu du fil peut trancher.
 */
const MAX_VERTICAL_SPACE_PX = 18
const MAX_LINE_HEIGHT = 1.6

const VERTICAL_SPACE_PROPS = new Set([
  'margin-top',
  'margin-bottom',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'padding-top',
  'padding-bottom',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'gap',
  'row-gap'
])

const BOX_SHORTHAND_PROPS = new Set(['margin', 'padding'])

/** Rend la longueur plafonnee, ou la valeur telle quelle si elle n'est pas une longueur bornable. */
function clampLength(token: string): string {
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/i.exec(token.trim())
  if (!match) return token
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  const pixels = unit === 'px' ? value : value * 16
  if (!(pixels > MAX_VERTICAL_SPACE_PX)) return token
  return `${MAX_VERTICAL_SPACE_PX}px`
}

/** Plafonne la valeur d'une declaration d'espacement vertical. Toute autre propriete ressort intacte. */
export function clampVerticalRhythm(property: string, value: string): string {
  const raw = value.trim()
  if (/var\(|calc\(|!important/i.test(raw)) return value

  if (property === 'line-height') {
    const numeric = /^(\d*\.?\d+)$/.exec(raw)
    if (numeric && Number(numeric[1]) > MAX_LINE_HEIGHT) return String(MAX_LINE_HEIGHT)
    const relative = /^(\d*\.?\d+)(em|rem)$/i.exec(raw)
    if (relative && Number(relative[1]) > MAX_LINE_HEIGHT) return String(MAX_LINE_HEIGHT)
    return value
  }

  if (VERTICAL_SPACE_PROPS.has(property))
    return raw.split(/\s+/).map(clampLength).join(' ')

  if (BOX_SHORTHAND_PROPS.has(property)) {
    const parts = raw.split(/\s+/)
    // Les composantes VERTICALES seules sont plafonnees : un retrait lateral voulu reste intact.
    if (parts.length === 1) return clampLength(parts[0])
    if (parts.length === 2) return `${clampLength(parts[0])} ${parts[1]}`
    if (parts.length === 3) return `${clampLength(parts[0])} ${parts[1]} ${clampLength(parts[2])}`
    if (parts.length === 4)
      return `${clampLength(parts[0])} ${parts[1]} ${clampLength(parts[2])} ${parts[3]}`
    return value
  }

  return value
}

/** `display` sert la mise en page, mais `display:none` cache du contenu — texte invisible copiable. */
const FORBIDDEN_STYLE_VALUES = /url\s*\(|expression\s*\(|@import|position\s*:|\\/i

function sanitizeStyle(value: string): string {
  const kept: string[] = []
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const propertyValue = declaration.slice(separator + 1).trim()
    if (!ALLOWED_STYLE_PROPS.has(property)) continue
    if (!propertyValue || FORBIDDEN_STYLE_VALUES.test(propertyValue)) continue
    if (property === 'display' && /none/i.test(propertyValue)) continue
    kept.push(`${property}: ${clampVerticalRhythm(property, propertyValue)}`)
  }
  return kept.join('; ')
}

/** N'accepte qu'une ancre interne ou un lien http(s) — jamais `javascript:`, `data:` ni `file:`. */
function sanitizeHref(value: string): string | null {
  const href = value.trim()
  if (href.startsWith('#')) return href
  // Une URL relative se resout contre l'origine de l'app : on la refuse plutot que de la deviner.
  if (!/^https?:\/\//i.test(href)) return null
  return href
}

/** Seules les images auto-portees passent : une URL distante ferait fuiter une visite au chargement. */
function sanitizeImageSource(value: string): string | null {
  const source = value.trim()
  return /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(source) ? source : null
}

/**
 * Empreinte stable et courte d'une source, pour donner a chaque bloc un domaine de style PROPRE.
 * Deux reponses de la meme conversation definissent volontiers toutes les deux `.card` ou `h2` : sans
 * domaine distinct, la feuille de la seconde repeindrait la premiere. Deterministe a dessein — un
 * identifiant aleatoire changerait a chaque rendu et rendrait le resultat intestable.
 */
function scopeToken(source: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** `html`, `body` et `:root` designent, dans le fil, le conteneur du bloc — pas la page de l'app. */
const ROOT_SELECTORS = /^(?:html|body|:root)$/i

function scopeSelector(selector: string, scope: string): string {
  return selector
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ''
      // Un selecteur de la feuille du modele ne doit JAMAIS pouvoir designer un noeud de l'app.
      const [head, ...rest] = trimmed.split(/\s+/)
      if (ROOT_SELECTORS.test(head)) return rest.length ? `${scope} ${rest.join(' ')}` : scope
      return `${scope} ${trimmed}`
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * Reecrit la feuille de style du modele pour qu'elle ne puisse peindre QUE l'interieur de son bloc.
 *
 * Sans cela, il fallait choisir entre supprimer `<style>` — et rendre des reponses nues, alors que
 * embellir les reponses est tout l'objectif — ou le laisser passer, ou une seule regle `body{...}`
 * repeindrait l'application entiere. Le confinement est la troisieme voie : la CSS est conservee,
 * mais chaque selecteur est prefixe par le domaine du bloc.
 *
 * Le positionnement reste retire : `contain: paint` sur le conteneur ancre deja un `position: fixed`
 * au bloc plutot qu'a la fenetre, mais une seconde barriere ne coute rien ici.
 */
export function scopeChatStyleSheet(css: string, scope: string): string {
  // Les regles-INSTRUCTION (`@import`, `@charset`, `@namespace`) se terminent par `;` et n'ont pas
  // de bloc : les laisser dans le flux collait leur texte au preambule de la regle SUIVANTE, qui
  // etait alors rejetee avec elles. On les retire avant de decouper.
  const withoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|charset|namespace)[^;{]*;/gi, '')
  const out: string[] = []
  let index = 0

  while (index < withoutComments.length) {
    const braceStart = withoutComments.indexOf('{', index)
    if (braceStart < 0) break

    // Corps equilibre : une regle imbriquee (`@media`) contient elle-meme des accolades.
    let depth = 0
    let braceEnd = -1
    for (let i = braceStart; i < withoutComments.length; i += 1) {
      if (withoutComments[i] === '{') depth += 1
      else if (withoutComments[i] === '}') {
        depth -= 1
        if (depth === 0) {
          braceEnd = i
          break
        }
      }
    }
    if (braceEnd < 0) break

    const prelude = withoutComments.slice(index, braceStart).trim()
    const body = withoutComments.slice(braceStart + 1, braceEnd)
    index = braceEnd + 1

    if (/^@(?:import|charset|namespace)/i.test(prelude)) continue
    if (/^@(?:media|supports|layer|container)/i.test(prelude)) {
      const inner = scopeChatStyleSheet(body, scope)
      if (inner.trim()) out.push(`${prelude}{${inner}}`)
      continue
    }
    // `@keyframes` et `@font-face` n'ont pas de selecteur a prefixer ; leur corps est inerte.
    if (prelude.startsWith('@')) {
      if (/url\s*\(/i.test(body)) continue
      out.push(`${prelude}{${body}}`)
      continue
    }

    const declarations = body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => {
        if (!declaration.includes(':')) return false
        const property = declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase()
        if (property === 'position' || property === 'z-index') return false
        return !/url\s*\(|expression\s*\(/i.test(declaration)
      })
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        const property = declaration.slice(0, separator).trim().toLowerCase()
        const propertyValue = declaration.slice(separator + 1).trim()
        return `${property}:${clampVerticalRhythm(property, propertyValue)}`
      })
    if (!declarations.length) continue

    const selector = scopeSelector(prelude, scope)
    if (selector) out.push(`${selector}{${declarations.join(';')}}`)
  }

  return out.join('\n')
}

export function sanitizeChatHtml(source: string, scopeSelector_ = ''): string {
  const template = document.createElement('template')
  template.innerHTML = source

  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) walk(child)

    const tag = node.tagName.toLowerCase()

    if (tag === 'style') {
      // Conservee mais CONFINEE. Sans domaine de style, on ne rendrait pas ce bloc plus beau, on
      // laisserait sa feuille repeindre l'application.
      const scoped = scopeSelector_
        ? scopeChatStyleSheet(node.textContent ?? '', scopeSelector_)
        : ''
      if (scoped) node.textContent = scoped
      else node.remove()
      return
    }

    if (DROP_WITH_CONTENT.has(tag)) {
      node.remove()
      return
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Deplier : on jette la BALISE inconnue, pas le texte qu'elle porte.
      node.replaceWith(...Array.from(node.childNodes))
      return
    }

    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase()

      if (name === 'style') {
        const style = sanitizeStyle(attribute.value)
        if (style) node.setAttribute('style', style)
        else node.removeAttribute('style')
        continue
      }

      if (name === 'href' && tag === 'a') {
        const href = sanitizeHref(attribute.value)
        if (href) {
          node.setAttribute('href', href)
          if (!href.startsWith('#')) {
            node.setAttribute('target', '_blank')
            node.setAttribute('rel', 'noopener noreferrer')
          }
        } else node.removeAttribute('href')
        continue
      }

      if (name === 'src' && tag === 'img') {
        const src = sanitizeImageSource(attribute.value)
        if (src) node.setAttribute('src', src)
        else node.remove()
        continue
      }

      // Tout le reste — `on*`, `srcset`, `formaction`, `data-*`… — part par defaut.
      if (!ALLOWED_ATTRS.has(name)) node.removeAttribute(attribute.name)
    }
  }

  for (const child of Array.from(template.content.children)) walk(child)
  return template.innerHTML
}

/**
 * Prepare un bloc `html-render` pour le fil : un identifiant de domaine propre au bloc, et le HTML
 * assaini dont la feuille de style est confinee a ce domaine.
 */
export function prepareChatHtml(source: string): { html: string; scopeId: string } {
  const scopeId = scopeToken(source)
  return { html: sanitizeChatHtml(source, `[data-html-scope="${scopeId}"]`), scopeId }
}
