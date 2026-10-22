/**
 * LE MODELE RELIT SES PAGES HTML EN TEXTE, PAS EN CODE — regle PURE, partagee par tous les endroits
 * ou Autowin renvoie au modele un texte qu'il a deja ecrit.
 *
 * DEFAUT MESURE (scout de conv-1074, 2026-10-22). Une reponse peut porter une page `html-render` :
 * l'utilisateur voit la page dessinee, mais le texte renvoye au modele en portait le CODE entier —
 * balises, `<style>`, couleurs, parfois 30 000 caracteres pour quelques phrases visibles. Ce code
 * repartait a chaque tour par quatre chemins : l'historique d'une session neuve
 * (`chat-turn-messages.ts`, ligne « TOI: »), le dernier run relu en entier (`dernier-run-entier.ts`),
 * le contexte d'un run (`orchestration-context.ts`) et le compte-rendu d'un tour execute sans le
 * modele (`agent-pilot.ts`), qui reste ensuite dans sa session pour tous les tours suivants.
 *
 * Ce qui RESTE : le texte que l'utilisateur a lu sur la page, borne, et l'avis que l'app a retire le
 * code — le modele sait qu'il a montre une page, et ne la prend pas pour une phrase qu'il a ecrite.
 * Ce qui est coupe est DIT (« … », taille retiree) : une troncature muette ferait lire un extrait
 * comme s'il etait le tout (meme regle que `flattenChatPartsForModel`).
 *
 * Seules les VRAIES pages sont touchees — les fences `html-render` que l'affichage dessine. Un bloc
 * ```html (du code MONTRE comme code) et un `html-render` cite a l'interieur d'une fence plus longue
 * sont du contenu : ils restent mot pour mot. Une fence jamais refermee (reponse coupee) et une fence
 * collee en fin de phrase (defaut conv-8, `collage-blocs-texte.ts`) sont filtrees aussi : le code y
 * est le meme.
 */

/** Plafond du texte visible garde par page. Au-dela, la fin est coupee — et c'est dit. */
export const TEXTE_VISIBLE_PAGE_MAX = 3_000

const OUVERTURE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/
const OUVERTURE_COLLEE = /(`{3,}|~{3,})[ \t]*html-render[ \t]*$/i

/** Une ligne ferme-t-elle la fence ouverte par `marqueur` ? Meme caractere, au moins aussi long. */
function fermeLaFence(ligne: string, marqueur: string): boolean {
  const nette = ligne.replace(/\r$/, '')
  const motif = new RegExp(
    `^[ \\t]{0,3}${marqueur[0] === '`' ? '`' : '~'}{${marqueur.length},}[ \\t]*$`
  )
  return motif.test(nette)
}

/** Rang de la ligne qui ferme la fence ouverte avant `depuis` ; `lignes.length` si aucune. */
function rangDeFermeture(lignes: string[], depuis: number, marqueur: string): number {
  let rang = depuis
  while (rang < lignes.length && !fermeLaFence(lignes[rang], marqueur)) rang++
  return rang
}

function premiereLigneNonVide(lignes: string[], depuis: number): string | undefined {
  for (let rang = depuis; rang < lignes.length; rang++)
    if (lignes[rang].trim() !== '') return lignes[rang]
  return undefined
}

const ENTITES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  times: '×',
  rarr: '→',
  larr: '←',
  check: '✓'
}

function decoderEntites(texte: string): string {
  return texte
    .replace(/&#(\d{1,7});/g, (brut, code: string) => {
      const point = Number(code)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : brut
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (brut, code: string) => {
      const point = Number.parseInt(code, 16)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : brut
    })
    .replace(/&([a-z]+);/gi, (brut, nom: string) => ENTITES[nom.toLowerCase()] ?? brut)
    .replace(/&amp;/gi, '&')
}

const BLOCS =
  'p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|tr|table|thead|tbody|tfoot|' +
  'blockquote|pre|figure|figcaption|details|summary|dl|dt|dd|hr|caption'

/** Le texte qu'un lecteur voit sur la page : sans code, sans balise, espaces resserres. */
export function texteVisibleDUnePage(html: string): string {
  const sansCode = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    // Un `<style>` ou `<script>` jamais referme (page coupee) court jusqu'a la fin : rien n'y est visible.
    .replace(/<(style|script|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(new RegExp(`</?(?:${BLOCS})\\b[^>]*>`, 'gi'), '\n')
    // Les cellules d'un tableau sont separees a l'ecran : elles ne se soudent pas ici non plus.
    .replace(/<\/t[dh]\s*>/gi, ' · ')
    .replace(/<[^>]*>/g, '')
    // Une balise coupee en fin de page (`<div class="x`) n'a rien de visible.
    .replace(/<[a-z!/][^>]*$/i, '')
  return decoderEntites(sansCode)
    .split('\n')
    .map((ligne) =>
      ligne
        .replace(/[ \t\u00a0]+/g, ' ')
        .trim()
        .replace(/^(?:· ?)+|(?: ?·)+$/g, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
}

/** Espace simple entre les milliers : l'espace fine de `toLocaleString` ne se retrouve pas au clavier. */
function milliers(nombre: number): string {
  return String(nombre).replace(/\B(?=(\d{3})+$)/g, ' ')
}

function resumeDeLaPage(code: string): string {
  const visible = texteVisibleDUnePage(code)
  const garde =
    visible.length > TEXTE_VISIBLE_PAGE_MAX
      ? `${visible.slice(0, TEXTE_VISIBLE_PAGE_MAX).trimEnd()} … (+${milliers(visible.length - TEXTE_VISIBLE_PAGE_MAX)} caractères de texte coupés)`
      : visible
  return (
    `[page html-render affichée à l'utilisateur — ${milliers(code.length)} caractères de code retirés ` +
    `par l'app ; texte visible : ${garde || 'aucun texte'}]`
  )
}

/**
 * Remplace chaque page `html-render` d'un texte par son texte visible. Rend le texte INCHANGE (meme
 * chaine) quand il ne porte aucune page.
 */
export function pagesHtmlEnTexte(texte: string): string {
  if (!/html-render/i.test(texte)) return texte
  const lignes = texte.split('\n')
  const sortie: string[] = []
  let change = false
  let rang = 0
  while (rang < lignes.length) {
    const ligne = lignes[rang]
    const ouverture = OUVERTURE.exec(ligne.replace(/\r$/, ''))
    if (ouverture) {
      const [, marqueur, langue] = ouverture
      const fin = rangDeFermeture(lignes, rang + 1, marqueur)
      if (langue.toLowerCase() === 'html-render') {
        sortie.push(resumeDeLaPage(lignes.slice(rang + 1, fin).join('\n')))
        change = true
      } else {
        // Une autre fence : son contenu est du CODE, un `html-render` cite dedans n'est pas une page.
        sortie.push(...lignes.slice(rang, Math.min(fin + 1, lignes.length)))
      }
      rang = fin + 1
      continue
    }
    const collee = OUVERTURE_COLLEE.exec(ligne.replace(/\r$/, ''))
    // Collee en fin de phrase, la fence n'est reconnue que si une BALISE suit : une phrase qui
    // parle de « ```html-render » sans en ouvrir ne doit pas avaler le reste de la reponse.
    // La ligne suivante n'est cherchee QUE sur une fence collee : la chercher a chaque ligne recopiait
    // tout le reste du texte a chaque fois (cout quadratique sur une longue reponse).
    if (
      collee &&
      collee.index > 0 &&
      premiereLigneNonVide(lignes, rang + 1)
        ?.trimStart()
        .startsWith('<')
    ) {
      const fin = rangDeFermeture(lignes, rang + 1, collee[1])
      sortie.push(ligne.slice(0, collee.index))
      sortie.push(resumeDeLaPage(lignes.slice(rang + 1, fin).join('\n')))
      change = true
      rang = fin + 1
      continue
    }
    sortie.push(ligne)
    rang++
  }
  return change ? sortie.join('\n') : texte
}
