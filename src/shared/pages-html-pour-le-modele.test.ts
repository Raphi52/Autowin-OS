import { describe, expect, it } from 'vitest'
import { pagesHtmlEnTexte, TEXTE_VISIBLE_PAGE_MAX } from './pages-html-pour-le-modele'

/**
 * LE MODELE RELIT SES PAGES HTML EN TEXTE, PAS EN CODE (2026-10-22).
 *
 * Mesure du scout : chaque bloc `html-render` d'une reponse etait renvoye au modele tel
 * quel — balises, `<style>` et couleurs compris — a chaque tour ou l'historique, le contexte d'un run
 * ou le compte-rendu d'un tour execute sans lui repartait. L'utilisateur voit une PAGE ; le modele
 * relisait son CODE source, des dizaines de milliers de caracteres pour quelques phrases visibles.
 *
 * ENTREE QUI FERAIT ECHOUER UNE MAUVAISE CORRECTION : `PAGE_LOURDE` — 30 000 caracteres, dont une
 * feuille `<style>` qui porte la couleur `#d4a94f` et un `<script>`. Un filtre qui retirerait
 * seulement les balises laisserait passer `#d4a94f` (contenu du `<style>`) ; un filtre qui
 * oublierait la borne rendrait les 30 000 caracteres de texte repete.
 */
const PARAGRAPHE = '<p class="aw-texte">Rappel mesuré du lot : CHIFFRE-CLE-42 sur la ligne 3.</p>'
const PAGE_LOURDE = [
  '<style>.carte{color:#d4a94f;background:#12161f}</style>',
  '<script>window.alerte = "CODE-DU-SCRIPT"</script>',
  '<!-- COMMENTAIRE-CACHE -->',
  '<div class="carte"><h2>Titre de la page</h2>',
  PARAGRAPHE.repeat(Math.ceil(30_000 / PARAGRAPHE.length)),
  '<table><tr><td>Colonne A</td><td>Colonne B</td></tr></table>',
  '</div>'
].join('\n')
const bloc = (html: string): string => '```html-render\n' + html + '\n```'

describe('pagesHtmlEnTexte — une page html-render devient son texte visible', () => {
  it('prémisse : la page de test pèse bien plus de 30 000 caractères', () => {
    expect(PAGE_LOURDE.length).toBeGreaterThan(30_000)
  })

  it('une page de 30 000 caractères ressort sans balise, sans style, sans script, et bornée', () => {
    const sortie = pagesHtmlEnTexte(`Voici le tableau :\n\n${bloc(PAGE_LOURDE)}\n\nFin de réponse.`)
    expect(sortie).not.toMatch(/<\/?[a-z!]/i)
    expect(sortie).not.toContain('#d4a94f')
    expect(sortie).not.toContain('CODE-DU-SCRIPT')
    expect(sortie).not.toContain('COMMENTAIRE-CACHE')
    expect(sortie).not.toContain('html-render\n')
    expect(sortie).toContain('Titre de la page')
    expect(sortie).toContain('CHIFFRE-CLE-42')
    // Le texte AUTOUR de la page est la reponse elle-meme : il reste mot pour mot.
    expect(sortie).toContain('Voici le tableau :')
    expect(sortie).toContain('Fin de réponse.')
    expect(sortie.length).toBeLessThan(TEXTE_VISIBLE_PAGE_MAX + 600)
  })

  it('ce qui est coupé est DIT, avec la taille retirée', () => {
    const sortie = pagesHtmlEnTexte(bloc(PAGE_LOURDE))
    expect(sortie).toMatch(/…/)
    expect(sortie).toMatch(/page html-render/)
    expect(sortie).toMatch(/\d[\d ]* caractères de code retirés/)
  })

  it('les cellules d’un tableau ne se soudent pas entre elles', () => {
    const sortie = pagesHtmlEnTexte(bloc(PAGE_LOURDE))
    expect(sortie).not.toContain('Colonne AColonne B')
  })

  it('les entités sont décodées : le modèle lit ce que l’utilisateur a lu', () => {
    const sortie = pagesHtmlEnTexte(bloc('<p>R&amp;D &mdash; 3&nbsp;%</p>'))
    expect(sortie).toContain('R&D')
    expect(sortie).not.toContain('&amp;')
    expect(sortie).not.toContain('&nbsp;')
  })

  it('une fence jamais refermée (réponse coupée) est filtrée jusqu’à la fin', () => {
    const sortie = pagesHtmlEnTexte(
      'Début.\n```html-render\n<style>.x{color:#e3ba55}</style><p>Texte visible'
    )
    expect(sortie).toContain('Début.')
    expect(sortie).toContain('Texte visible')
    expect(sortie).not.toContain('#e3ba55')
    expect(sortie).not.toMatch(/<\/?[a-z]/i)
  })

  it('une fence collée en fin de phrase (défaut conv-8) est filtrée aussi', () => {
    const sortie = pagesHtmlEnTexte(
      'C’est bien branché.```html-render\n<div style="color:#dde3ee">Page collée</div>\n```\nSuite.'
    )
    expect(sortie).toContain('C’est bien branché.')
    expect(sortie).toContain('Page collée')
    expect(sortie).toContain('Suite.')
    expect(sortie).not.toContain('#dde3ee')
  })

  it('deux pages dans la même réponse sont filtrées toutes les deux', () => {
    const sortie = pagesHtmlEnTexte(`${bloc('<b>UNE</b>')}\nentre\n${bloc('<i>DEUX</i>')}`)
    expect(sortie).toContain('UNE')
    expect(sortie).toContain('DEUX')
    expect(sortie).toContain('entre')
    expect(sortie).not.toMatch(/<\/?[a-z]/i)
  })

  it('une page sans texte visible le dit, au lieu de laisser un trou', () => {
    expect(pagesHtmlEnTexte(bloc('<svg><circle r="4"/></svg>'))).toMatch(/aucun texte/)
  })
})

/**
 * 2026-10-30 : une page ```html-interactif repartait en CODE, elle aussi. Mesure sur le
 * fil du jeu : 154 008 caractères de message pour une session neuve, contre 7 432 au tour d'avant,
 * parce que l'historique portait les 141 000 caractères de la page. `montrer_bloc` promettait
 * pourtant qu'un bloc ne part jamais au modèle.
 *
 * ENTREE QUI FERAIT ECHOUER UNE MAUVAISE CORRECTION : un texte qui ne porte QUE cette page. Élargir
 * le seul test de langue laisserait la sortie rapide du début renvoyer le texte tel quel.
 */
const blocInteractif = (html: string): string => '```html-interactif\n' + html + '\n```'

describe('pagesHtmlEnTexte — une page html-interactif se résume aussi', () => {
  it('une page de 30 000 caractères ressort sans son code, avec le texte autour', () => {
    const sortie = pagesHtmlEnTexte(`Le jeu :\n\n${blocInteractif(PAGE_LOURDE)}\n\nÀ toi.`)
    expect(sortie).not.toMatch(/<\/?[a-z!]/i)
    expect(sortie).not.toContain('CODE-DU-SCRIPT')
    expect(sortie).not.toContain('#d4a94f')
    expect(sortie).not.toContain('html-interactif\n')
    expect(sortie).toContain('Titre de la page')
    expect(sortie).toContain('Le jeu :')
    expect(sortie).toContain('À toi.')
    expect(sortie.length).toBeLessThan(TEXTE_VISIBLE_PAGE_MAX + 600)
  })

  it('le code d’un moteur en une ligne disparaît, attributs onclick compris', () => {
    const sortie = pagesHtmlEnTexte(
      blocInteractif(
        '<button onclick="lancer()">Jouer</button><script>if(a<b&&c>d){MOTEUR_3D()}</script>'
      )
    )
    expect(sortie).toContain('Jouer')
    expect(sortie).not.toContain('MOTEUR_3D')
    expect(sortie).not.toContain('lancer()')
  })

  it('le résumé nomme la bonne sorte de page', () => {
    const sortie = pagesHtmlEnTexte(blocInteractif('<p>Bonjour</p>'))
    expect(sortie).toMatch(/page html-interactif/)
    expect(sortie).not.toMatch(/page html-render/)
    expect(sortie).toMatch(/\d[\d ]* caractères de code retirés/)
  })

  it('il ne promet pas le texte que seuls les scripts écrivent', () => {
    // Le modèle prendrait sinon la page vide de départ pour tout ce que l'utilisateur a vu.
    const sortie = pagesHtmlEnTexte(
      blocInteractif('<div id="r"></div><script>r.textContent="x"</script>')
    )
    expect(sortie).not.toMatch(/texte visible/)
    expect(sortie).toMatch(/scripts/)
  })

  it('une page sans texte fixe le dit', () => {
    expect(pagesHtmlEnTexte(blocInteractif('<canvas id="c"></canvas>'))).toMatch(/aucun texte/)
  })

  it('une fence jamais refermée est filtrée jusqu’à la fin', () => {
    const sortie = pagesHtmlEnTexte('Début.\n```html-interactif\n<script>MOTEUR_3D()')
    expect(sortie).toContain('Début.')
    expect(sortie).not.toContain('MOTEUR_3D')
  })

  it('une fence collée en fin de phrase est filtrée aussi', () => {
    const sortie = pagesHtmlEnTexte(
      'C’est bien branché.```html-interactif\n<script>MOTEUR_3D()</script><p>Page collée</p>\n```\nSuite.'
    )
    expect(sortie).toContain('C’est bien branché.')
    expect(sortie).toContain('Page collée')
    expect(sortie).toContain('Suite.')
    expect(sortie).not.toContain('MOTEUR_3D')
  })

  it('une page de chaque sorte dans la même réponse : les deux sont filtrées', () => {
    const sortie = pagesHtmlEnTexte(
      `${bloc('<b>UNE</b>')}\nentre\n${blocInteractif('<i>DEUX</i>')}`
    )
    expect(sortie).toContain('UNE')
    expect(sortie).toContain('DEUX')
    expect(sortie).not.toMatch(/<\/?[a-z]/i)
  })

  it('le filtre est idempotent : repasser sur sa propre sortie ne change rien', () => {
    const une = pagesHtmlEnTexte(blocInteractif(PAGE_LOURDE))
    expect(pagesHtmlEnTexte(une)).toBe(une)
  })

  it('un html-interactif cité DANS une fence plus longue est du contenu, pas une page', () => {
    const texte = '````markdown\n```html-interactif\n<p>exemple cité</p>\n```\n````'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })

  it('une phrase qui PARLE de html-interactif, suivie de prose, laisse la réponse intacte', () => {
    const texte = 'Pour une page, ouvre une fence ```html-interactif\nPuis écris le contenu.\nFin.'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })
})

describe('pagesHtmlEnTexte — jumeaux acceptés : ce qui n’est pas une page reste intact', () => {
  it('un texte sans page ressort identique', () => {
    const texte = 'Réponse simple, avec `<div>` en code en ligne et a < b.'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })

  it('un bloc ```html (du code MONTRÉ comme code) reste tel quel', () => {
    const texte = 'Exemple :\n```html\n<div class="x">code</div>\n```'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })

  it('un html-render cité DANS une fence plus longue est du contenu, pas une page', () => {
    const texte = '````markdown\n```html-render\n<p>exemple cité</p>\n```\n````'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })

  it('le filtre est idempotent : repasser sur sa propre sortie ne change rien', () => {
    const une = pagesHtmlEnTexte(bloc(PAGE_LOURDE))
    expect(pagesHtmlEnTexte(une)).toBe(une)
  })
})

describe('pagesHtmlEnTexte — une phrase qui PARLE de html-render n’est pas une page', () => {
  it('« ```html-render » en fin de phrase, suivi de prose, laisse la réponse intacte', () => {
    const texte = 'Pour une page, ouvre une fence ```html-render\nPuis écris le contenu.\nFin.'
    expect(pagesHtmlEnTexte(texte)).toBe(texte)
  })
})
