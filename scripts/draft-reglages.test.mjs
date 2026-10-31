// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
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

  // conv-1382 : un simple `includes` acceptait ces trois jauges, mortes ou fausses à l'écran.
  it('refuse une variable seulement voisine d’une variable lue', () => {
    const erreurs = verifierReglages(
      [{ ...TAILLE, variable: '--ex-tail' }],
      'font-size:var(--ex-taille)'
    )
    expect(erreurs.join(' ')).toContain('aucune maquette ne lit --ex-tail')
  })

  it('refuse une variable nommée sans être lue', () => {
    expect(verifierReglages([TAILLE], '.a{--ex-taille:4px}').join(' ')).toContain('ne lit')
  })

  it('refuse une maquette qui repose la variable : elle masquerait le curseur', () => {
    const erreurs = verifierReglages([TAILLE], '.a{--ex-taille:4px;font-size:var(--ex-taille)}')
    expect(erreurs.join(' ')).toContain('écraserait le curseur')
  })

  it('accepte une lecture avec repli, ou une variable dérivée de la jauge', () => {
    expect(verifierReglages([TAILLE], 'font-size:var(--ex-taille, 12px)')).toEqual([])
    expect(verifierReglages([TAILLE], '.a{--ex-g:calc(var( --ex-taille ) * 2)}')).toEqual([])
  })

  // Le curseur natif ramène la valeur sur un cran : 0.3 devenait 0.25, et les boutons annonçaient
  // une retouche que personne n'avait faite (mesuré conv-1382, « Force 0.25 » sans aucun geste).
  it('refuse une valeur entre deux crans : le curseur la remplacerait', () => {
    const force = { nom: 'Force', variable: '--ex-f', min: 0, max: 1, pas: 0.25, valeur: 0.3 }
    expect(verifierReglages([force], 'var(--ex-f)').join(' ')).toContain('entre deux crans')
    expect(verifierReglages([{ ...force, valeur: 0.75 }], 'var(--ex-f)')).toEqual([])
  })

  it('juge les crans sans se tromper sur les décimales', () => {
    expect(verifierReglages([DUREE], LU)).toEqual([])
    expect(verifierReglages([{ ...DUREE, min: 0.1, valeur: 0.7 }], LU)).toEqual([])
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

  it('affiche le panneau au-dessus de la proposition et le dit dans l’aide', () => {
    const html = carrouselDraft(spec())
    // Une jauge qui agrandit la maquette ne doit pas partir sous la souris : le panneau reste à sa
    // place dans le document (les règles du carrousel marchent par frères), `order` le remonte.
    expect(styleReglages([DUREE])).toMatch(/\.dkc-rg\{order:-1/)
    expect(html.indexOf('class="dkc-rg"')).toBeLessThan(html.indexOf('class="dkc-film"'))
    expect(html).toContain('curseurs')
    expect(html).toContain('qui les utilisent')
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

// conv-1382 : la proposition 1 lit Rayon et Marge, la 2 lit Rayon, la 3 ne lit rien. Avant, les deux
// jauges restaient sous les trois, et « Affiner la 3 » portait des valeurs sans effet sur elle.
describe('une jauge n’existe que pour les propositions qu’elle change', () => {
  const RAYON = { nom: 'Rayon', variable: '--ex-r', min: 0, max: 32, valeur: 8, unite: 'px' }
  const MARGE = { nom: 'Marge', variable: '--ex-m', min: 0, max: 40, valeur: 16, unite: 'px' }

  const monter = (partiel = {}) => {
    document.body.innerHTML = carrouselDraft(
      spec({
        css: '.ex-a{padding:var(--ex-m);border-radius:var(--ex-r)}.ex-b:hover{border-radius:var(--ex-r)}',
        propositions: [
          { nom: 'Tout', html: '<span class="ex-a">A</span>' },
          { nom: 'Rayon', html: '<span class="ex-b">B</span>' },
          { nom: 'Rien', html: '<span class="ex-c">C</span>' }
        ],
        reglages: [RAYON, MARGE],
        ...partiel
      })
    )
    new Function(SCRIPT_REGLAGES)()
  }
  const visibles = () =>
    Array.from(document.querySelectorAll('.dkc-rgl'))
      .filter((l) => !l.hidden)
      .map((l) => l.querySelector('.dkc-rgn').textContent)
  // À la main : happy-dom ignore le clic sur un champ `display:none` et ne décoche pas le groupe.
  // Le vrai parcours à la souris est joué par html-interactif-apercu.mjs.
  const cocher = (champ, etat) => {
    champ.checked = etat
    champ.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const aller = (n) => {
    for (const r of document.querySelectorAll('input[name=dkp]')) r.checked = false
    cocher(document.getElementById(`dkp${n}`), true)
  }
  const bouger = (rang, valeur) => {
    const curseur = document.getElementById(`dkr${rang}`)
    curseur.value = valeur
    curseur.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const boutons = (n) =>
    Array.from(document.querySelectorAll(`.dkc-a${n} a`)).map((a) => a.textContent)

  beforeEach(() => {
    localStorage.clear()
  })

  it('montre seulement les jauges lues par la proposition affichée', () => {
    monter()
    expect(visibles()).toEqual(['Rayon', 'Marge'])
    aller(2)
    expect(visibles()).toEqual(['Rayon'])
  })

  it('cache tout le panneau sur une proposition qui ne lit aucune jauge', () => {
    monter()
    aller(3)
    expect(visibles()).toEqual([])
    expect(document.querySelector('.dkc-rg').hidden).toBe(true)
    aller(1)
    expect(document.querySelector('.dkc-rg').hidden).toBe(false)
  })

  it('« Tout voir » montre les jauges de toutes les propositions', () => {
    monter()
    aller(3)
    expect(visibles()).toEqual([])
    cocher(document.getElementById('dkall'), true)
    expect(visibles()).toEqual(['Rayon', 'Marge'])
  })

  it('un bouton ne porte que les valeurs qui changent SA proposition', () => {
    monter()
    bouger(1, '20')
    bouger(2, '30')
    expect(boutons(1)[0]).toBe('Affiner la 1 · Tout — Rayon 20 px, Marge 30 px')
    expect(boutons(2)[0]).toBe('Affiner la 2 · Rayon — Rayon 20 px')
    expect(boutons(3)[0]).toBe('Affiner la 3 · Rien')
  })

  it('un mélange porte les valeurs de chacune des propositions mélangées', () => {
    monter()
    bouger(2, '30')
    const melange = (texte) =>
      Array.from(document.querySelectorAll('.dkc-mxa a')).find((a) =>
        a.textContent.startsWith(texte)
      ).textContent
    expect(melange('Mixer 1 + 3')).toBe('Mixer 1 + 3 — Marge 30 px')
    expect(melange('Mixer 2 + 3')).toBe('Mixer 2 + 3')
  })

  it('lit les règles sous @media et les styles en ligne', () => {
    monter({
      css: '@media (min-width:1px){.ex-a{padding:var(--ex-m)}}',
      propositions: [
        { nom: 'Média', html: '<span class="ex-a">A</span>' },
        { nom: 'En ligne', html: '<span style="border-radius:var(--ex-r)">B</span>' },
        { nom: 'Rien', html: '<span>C</span>' }
      ]
    })
    expect(visibles()).toEqual(['Marge'])
    aller(2)
    expect(visibles()).toEqual(['Rayon'])
  })
})
