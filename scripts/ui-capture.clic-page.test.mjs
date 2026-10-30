// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  clicDansLaPage,
  decalagePourVoir,
  echecsDuClicPage,
  pointDuClic,
  scriptCibleDansLaPage
} from './ui-capture-clic-page.mjs'

/**
 * Pourquoi ce test existe (conv-1304, 2026-10-30) : `--click` clique dans la page de l'app, il
 * n'atteint pas le contenu d'une page interactive (cadre isole), et un clic de script n'est pas un
 * geste de l'utilisateur — le fil refuse ce qu'une page demande sans vrai clic. `--clic-page`
 * cherche la cible DANS le cadre, puis clique a la souris. Verrouille ici :
 *   - la lecture des options (selecteur ou `texte:`, page, saisie attendue) ;
 *   - le choix de la cible : VISIBLE seulement, libelle exact avant libelle qui commence pareil
 *     (un carrousel garde, caches, les boutons des autres propositions) ;
 *   - le point (coin du contenu du cadre + centre de la cible) et le defilement pour le voir ;
 *   - le verdict : saisie differente ou message parti = echec nomme.
 */
afterEach(() => {
  document.body.innerHTML = ''
})

describe('ui-capture --clic-page — options', () => {
  it('lit un selecteur, ou un libelle `texte:` normalise', () => {
    expect(clicDansLaPage(['--clic-page', '.dkc-a1 .dkc-bt1'])).toEqual({
      cible: { selecteur: '.dkc-a1 .dkc-bt1' },
      page: null,
      saisieAttendue: null,
      champ: 'textarea'
    })
    expect(
      clicDansLaPage([
        '--clic-page',
        'texte:  Affiner   la 1',
        '--page',
        '#bloc',
        '--saisie-attendue',
        'Affiner la 1 · Braise',
        '--champ',
        '.chat textarea'
      ])
    ).toEqual({
      cible: { texte: 'Affiner la 1' },
      page: '#bloc',
      saisieAttendue: 'Affiner la 1 · Braise',
      champ: '.chat textarea'
    })
  })

  it('sans cible, ou une option a la place de la cible : aucun geste', () => {
    expect(clicDansLaPage(['--view', 'chat'])).toBeNull()
    expect(clicDansLaPage(['--clic-page', '--page', '#x'])).toBeNull()
  })
})

describe('ui-capture --clic-page — cible cherchee dans le cadre', () => {
  // happy-dom ne calcule aucune mise en page : chaque element dit sa taille.
  const poser = (html, tailles) => {
    document.body.innerHTML = html
    for (const [selecteur, rect] of Object.entries(tailles)) {
      const el = document.querySelector(selecteur)
      el.getBoundingClientRect = () => ({
        left: rect[0],
        top: rect[1],
        width: rect[2],
        height: rect[3],
        right: rect[0] + rect[2],
        bottom: rect[1] + rect[3]
      })
    }
    document.elementFromPoint = () => document.querySelector('#visible')
  }
  const jouer = (cible) => (0, eval)(scriptCibleDansLaPage(cible))

  it('prend le bouton VISIBLE, jamais celui d une proposition cachee', () => {
    poser(
      '<span><a id="cache" href="#autowin-prompt">Affiner la 2 · Glacier</a></span>' +
        '<span><a id="visible" href="#autowin-prompt">Affiner la 1 · Braise</a></span>',
      { '#cache': [0, 0, 0, 0], '#visible': [10, 600, 120, 32] }
    )
    expect(jouer({ texte: 'Affiner la' })).toEqual({
      rect: { x: 10, y: 600, largeur: 120, hauteur: 32 },
      libelle: 'Affiner la 1 · Braise',
      balise: 'a',
      atteignable: true
    })
  })

  it('un libelle exact passe avant un libelle qui commence pareil', () => {
    poser('<button id="long">Mixer 1 + 3</button><button id="visible">Mixer</button>', {
      '#long': [0, 0, 80, 20],
      '#visible': [0, 30, 60, 20]
    })
    expect(jouer({ texte: 'Mixer' }).libelle).toBe('Mixer')
  })

  it('dit si un calque couvre la cible, et rend null si elle manque', () => {
    poser('<button id="b">Composer</button><div id="visible"></div>', {
      '#b': [0, 0, 80, 20],
      '#visible': [0, 0, 80, 20]
    })
    expect(jouer({ selecteur: '#b' }).atteignable).toBe(false)
    expect(jouer({ texte: 'Absent' })).toBeNull()
    expect(jouer({ selecteur: '#nulle-part' })).toBeNull()
  })
})

describe('ui-capture --clic-page — point et defilement', () => {
  it('additionne le coin du contenu du cadre et le centre de la cible', () => {
    expect(
      pointDuClic(
        { x: 500, y: -200, bordGauche: 1, bordHaut: 1 },
        { x: 10, y: 600, largeur: 120, hauteur: 32 }
      )
    ).toEqual({ x: 571, y: 417 })
  })

  it('ne defile pas un point deja bien dans la zone ; sinon le ramene au milieu', () => {
    const zone = { haut: 100, hauteur: 400 }
    expect(decalagePourVoir(300, zone)).toBe(0)
    expect(decalagePourVoir(900, zone)).toBe(600)
    expect(decalagePourVoir(-100, zone)).toBe(-400)
    // Colle au bord : il pourrait passer sous une barre flottante.
    expect(decalagePourVoir(495, zone)).toBe(195)
  })
})

describe('ui-capture --clic-page — verdict', () => {
  const rapport = {
    saisieAttendue: 'Affiner la 1 · Braise',
    saisieAvant: '',
    saisieApres: 'Affiner la 1 · Braise',
    messagesAvant: 1,
    messagesApres: 1
  }

  it('vert : la saisie porte le texte attendu et rien n est parti', () => {
    expect(echecsDuClicPage(rapport)).toEqual([])
    expect(echecsDuClicPage(undefined)).toEqual([])
  })

  it('rouge : saisie vide ou autre, message envoye, ou geste empeche', () => {
    expect(echecsDuClicPage({ ...rapport, saisieApres: '' })).toEqual(['saisie-non-remplie(vide)'])
    expect(echecsDuClicPage({ ...rapport, saisieApres: '', messagesApres: 2 })).toEqual([
      'saisie-non-remplie(vide)',
      'message-envoye(1 -> 2)'
    ])
    expect(echecsDuClicPage({ echec: 'clic-page-masque(button.chat-jump)' })).toEqual([
      'clic-page-masque(button.chat-jump)'
    ])
  })

  it('sans saisie attendue, le clic se rapporte sans etre juge', () => {
    expect(echecsDuClicPage({ ...rapport, saisieAttendue: null, saisieApres: 'x' })).toEqual([])
  })
})
