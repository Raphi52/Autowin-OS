import { describe, expect, it } from 'vitest'
import {
  blocDuCarrousel,
  carrouselDraft,
  carrouselEnPage,
  pageDuCarrousel,
  verifierPropositions
} from './draft-carrousel.mjs'
import {
  panneauReglages,
  SCRIPT_REGLAGES,
  styleReglages,
  verifierReglages
} from './draft-reglages.mjs'

const DUREE = {
  nom: 'Durée',
  variable: '--ex-duree',
  min: 0.2,
  max: 2,
  pas: 0.1,
  valeur: 0.8,
  unite: 's'
}
const TAILLE = { nom: 'Taille', variable: '--ex-taille', min: 12, max: 40, valeur: 18, unite: 'px' }
const ACCENT = { nom: 'Accent', variable: '--ex-accent', couleur: '#E63CA0' }
const LU = 'var(--ex-duree) var(--ex-taille) var(--ex-accent)'

const spec = (partiel = {}) => ({
  titre: '/draft · bouton · tour 1',
  css: `.ex-b{transition-duration:var(--ex-duree);font-size:var(--ex-taille);color:var(--ex-accent)}`,
  propositions: [
    { nom: 'Plein', html: '<span class="ex-b">A</span>' },
    { nom: 'Creux', html: '<span class="ex-b">B</span>' }
  ],
  reglages: [DUREE, TAILLE, ACCENT],
  ...partiel
})

describe('verifierReglages', () => {
  it('accepte des curseurs et une couleur dont une maquette lit la variable', () => {
    expect(verifierReglages([DUREE, TAILLE, ACCENT], LU)).toEqual([])
  })

  it('refuse un curseur que rien ne lit : il bougerait sans rien changer', () => {
    expect(verifierReglages([DUREE], 'color:red').join(' ')).toContain('--ex-duree')
  })

  it.each([
    ['liste vide', [], 'de 1 à 8'],
    [
      'trop de curseurs',
      Array.from({ length: 9 }, (_, i) => ({ ...DUREE, variable: `--ex-${i}` })),
      'de 1 à 8'
    ],
    ['pas une liste', {}, 'de 1 à 8'],
    ['sans nom', [{ ...DUREE, nom: '' }], '« nom »'],
    ['variable invalide', [{ ...DUREE, variable: 'duree' }], '« variable »'],
    ['variable du carrousel', [{ ...DUREE, variable: '--dk-rose' }], 'réservé'],
    ['variable en double', [DUREE, { ...TAILLE, variable: DUREE.variable }], 'deux fois'],
    ['bornes inversées', [{ ...DUREE, min: 3, max: 1 }], 'min'],
    ['valeur hors bornes', [{ ...DUREE, valeur: 9 }], 'valeur'],
    ['bornes absentes', [{ nom: 'X', variable: '--x' }], 'min'],
    ['pas nul', [{ ...DUREE, pas: 0 }], '« pas »'],
    ['unité fantaisiste', [{ ...DUREE, unite: 'px;}' }], '« unite »'],
    ['couleur abrégée', [{ ...ACCENT, couleur: 'red' }], '« couleur »']
  ])('%s : refusé', (_cas, reglages, attendu) => {
    expect(
      verifierReglages(reglages, `${LU} var(--x) var(--dk-rose) var(--ex-0)`).join(' ')
    ).toContain(attendu)
  })
})

describe('panneauReglages', () => {
  const html = panneauReglages([DUREE, ACCENT])

  it('rend un curseur avec ses bornes, et une couleur en minuscules', () => {
    expect(html).toContain(
      '<input type="range" id="dkr1" data-variable="--ex-duree" data-nom="Durée" data-unite="s" min="0.2" max="2" step="0.1" value="0.8">'
    )
    // `input.value` rend les minuscules : sinon la couleur d'origine compterait pour un changement.
    expect(html).toContain('value="#e63ca0"')
    expect(html).toContain('0.8 s')
  })

  it('n’utilise aucun id du carrousel et reste hors des enfants directs de .dkc-car', () => {
    expect(html.startsWith('<div class="dkc-rg">')).toBe(true)
    expect(html).not.toMatch(/id="dk[pm]/)
  })

  it('échappe un nom : il finit dans un attribut et dans le message', () => {
    const piege = panneauReglages([{ ...DUREE, nom: 'A"<b>' }])
    expect(piege).toContain('data-nom="A&quot;&lt;b&gt;"')
  })

  it('un pas absent dépend de l’étendue : 1 pour des pixels, 0,1 pour une durée', () => {
    expect(panneauReglages([TAILLE])).toContain('step="1"')
    expect(panneauReglages([{ ...DUREE, pas: undefined }])).toContain('step="0.1"')
  })
})

describe('styleReglages', () => {
  it('pose les valeurs d’origine en CSS : la maquette est juste avant tout script', () => {
    const css = styleReglages([DUREE, ACCENT])
    expect(css).toContain('.dkc-w{--ex-duree:0.8s;--ex-accent:#e63ca0}')
  })

  it('laisse les boutons passer à la ligne : ils portent maintenant les valeurs', () => {
    expect(styleReglages([DUREE])).toMatch(/\.dkc-mxa a\{white-space:normal/)
  })
})

describe('le carrousel avec des réglages', () => {
  it('devient une page interactive, seul moyen de faire tourner un curseur', () => {
    expect(carrouselEnPage(spec())).toBe(true)
    expect(carrouselEnPage(spec({ reglages: undefined }))).toBe(false)
    expect(blocDuCarrousel(spec()).startsWith('```html-interactif\n')).toBe(true)
    expect(pageDuCarrousel(spec())).toContain(SCRIPT_REGLAGES)
  })

  it('sans réglages, le carrousel ne change pas d’un octet et reste sans script', () => {
    const sans = spec({ reglages: undefined })
    expect(blocDuCarrousel(sans).startsWith('```html-render\n')).toBe(true)
    expect(blocDuCarrousel(sans)).not.toContain('dkc-rg')
    expect(blocDuCarrousel(sans)).not.toContain('<script')
  })

  it('pose le panneau sous la proposition, avant les vignettes, et le dit dans l’aide', () => {
    const html = carrouselDraft(spec())
    expect(html.indexOf('class="dkc-rg"')).toBeGreaterThan(html.indexOf('class="dkc-stg"'))
    expect(html.indexOf('class="dkc-rg"')).toBeLessThan(html.indexOf('class="dkc-film"'))
    expect(html).toContain('curseurs')
    expect(html).toContain('remplissent ta saisie')
  })

  it('la validation du carrousel relit les réglages et voit le CSS des maquettes', () => {
    expect(verifierPropositions(spec())).toEqual([])
    const mort = spec({ reglages: [{ ...DUREE, variable: '--ex-rien' }] })
    expect(verifierPropositions(mort).join(' ')).toContain('--ex-rien')
    expect(() => carrouselDraft(mort)).toThrow(/--ex-rien/)
  })

  it('un réglage lu par le CSS d’UNE proposition compte aussi', () => {
    const local = spec({
      css: undefined,
      propositions: [
        { nom: 'Plein', html: '<i>A</i>', css: '.x{color:var(--ex-accent)}' },
        { nom: 'Creux', html: '<i style="width:var(--ex-duree)">B</i>' }
      ],
      reglages: [ACCENT, DUREE]
    })
    expect(verifierPropositions(local)).toEqual([])
  })

  it('cohabite avec une scène 3D : les deux scripts sont dans la page', () => {
    const avecScene = spec({
      scene3d: 'autowin.surChoix((n) => { document.body.dataset.n = n })'
    })
    const page = pageDuCarrousel(avecScene)
    expect(page).toContain(SCRIPT_REGLAGES)
    expect(page).toContain('data-dkc-scene')
    expect(page.indexOf(SCRIPT_REGLAGES)).toBeLessThan(page.indexOf('data-dkc-scene'))
  })
})
