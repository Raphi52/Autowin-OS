// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blocDuCarrousel,
  carrouselDraft,
  carrouselEnPage,
  MIXER_MAX,
  pageDuCarrousel,
  verifierPropositions
} from './draft-carrousel.mjs'
import { COMMENTAIRE_MAX, SCRIPT_AXES } from './draft-axes.mjs'
import { SCRIPT_REGLAGES } from './draft-reglages.mjs'

/**
 * MÉLANGER PAR AXE (conv-1338, 2026-10-30). Le profil de l'utilisateur demande « visuel de la 6,
 * fonctionnement de la 1 et 2 ». Le Mixer du carrousel ne sait mélanger que des propositions
 * entières : ses boutons précalculés ne peuvent ni croiser deux axes (448 groupes pour 6 propositions)
 * ni porter un commentaire (le filtre du fil n'accepte aucun champ de texte).
 */

const proposition = (n, plus = {}) => ({
  nom: `Variante ${n}`,
  html: `<span class="ex-b">Maquette ${n}</span>`,
  visuel: `visuel ${n}`,
  fonctionnement: `fonctionnement ${n}`,
  ...plus
})

const spec = (n = 6, plus = {}) => ({
  titre: '/draft · barre · tour 1',
  propositions: Array.from({ length: n }, (_, i) => proposition(i + 1)),
  ...plus
})

const sansAxes = (n = 3) => ({
  titre: '/draft · barre · tour 1',
  propositions: Array.from({ length: n }, (_, i) => ({
    nom: `Variante ${i + 1}`,
    html: `<span class="ex-b">Maquette ${i + 1}</span>`
  }))
})

describe('verifierPropositions : les axes', () => {
  it('nominal : aucune erreur', () => {
    expect(verifierPropositions(spec())).toEqual([])
  })

  it('absents partout : aucune erreur', () => {
    expect(verifierPropositions(sansAxes())).toEqual([])
  })

  it('présents sur une partie seulement : refus qui nomme la proposition', () => {
    const partiel = spec(3)
    delete partiel.propositions[1].visuel
    delete partiel.propositions[1].fonctionnement
    expect(verifierPropositions(partiel).join(' ')).toContain('proposition 2')
  })

  it('un seul des deux axes sur une proposition : refus', () => {
    const partiel = spec(2)
    delete partiel.propositions[0].fonctionnement
    const erreurs = verifierPropositions(partiel).join(' ')
    expect(erreurs).toContain('proposition 1')
    expect(erreurs).toContain('fonctionnement')
  })

  it.each([
    ['vide', ''],
    ['en espaces', '   '],
    ['un nombre', 6],
    ['une liste', ['a']],
    ['nul', null]
  ])('« visuel » %s : refus', (_nom, valeur) => {
    const invalide = spec(2)
    invalide.propositions[0].visuel = valeur
    expect(verifierPropositions(invalide).join(' ')).toContain('proposition 1 : « visuel »')
  })

  it('10 propositions avec axes : acceptées, rien n’est précalculé', () => {
    expect(verifierPropositions(spec(10))).toEqual([])
    expect(verifierPropositions(spec(10, { mixer: true }))).toEqual([])
  })

  // Jumeau : sans axes, le Mixer précalculé garde sa limite.
  it('7 propositions sans axes avec « mixer » : refus inchangé', () => {
    expect(verifierPropositions({ ...sansAxes(MIXER_MAX + 1), mixer: true }).join(' ')).toContain(
      '« mixer »'
    )
  })

  it('11 propositions : refus inchangé', () => {
    expect(verifierPropositions(spec(11)).join(' ')).toContain('de 2 à 10')
  })
})

describe('le carrousel avec des axes', () => {
  it('devient une page interactive, seule à pouvoir composer un message', () => {
    expect(carrouselEnPage(spec())).toBe(true)
    expect(blocDuCarrousel(spec()).startsWith('```html-interactif\n')).toBe(true)
    expect(pageDuCarrousel(spec())).toContain(SCRIPT_AXES)
  })

  it('le dit dans l’aide : les boutons remplissent la saisie', () => {
    const html = carrouselDraft(spec())
    expect(html).toContain('remplissent ta saisie')
    expect(html).toContain('Mixer par axe')
  })

  it('chaque fiche montre son visuel et son fonctionnement', () => {
    const html = carrouselDraft(spec(2))
    expect(html).toContain('visuel 1')
    expect(html).toContain('fonctionnement 2')
  })

  it('remplace les boutons précalculés : deux cases par proposition, un commentaire', () => {
    const hote = document.createElement('div')
    hote.innerHTML = carrouselDraft(spec(6))
    expect(hote.querySelector('.dkc-mxa')).toBeNull()
    expect(hote.querySelectorAll('.dkc-ax input[data-axe="visuel"]')).toHaveLength(6)
    expect(hote.querySelectorAll('.dkc-ax input[data-axe="fonctionnement"]')).toHaveLength(6)
    expect(hote.querySelector('.dkc-ax textarea')).toBeTruthy()
  })

  it('un texte d’axe reste du texte sur la fiche', () => {
    const piege = spec(2)
    piege.propositions[0].visuel = '<script>alert(1)</script>'
    const html = carrouselDraft(piege)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)')
  })

  it('« mixer » false : pas de cases, le carrousel reste un bloc sans script', () => {
    const sansMixer = spec(3, { mixer: false })
    expect(carrouselEnPage(sansMixer)).toBe(false)
    const bloc = blocDuCarrousel(sansMixer)
    expect(bloc.startsWith('```html-render\n')).toBe(true)
    expect(bloc).not.toContain('class="dkc-ax"')
    expect(bloc).not.toContain('<script')
    // La fiche reste renseignée : c'est le mélange qui est retiré, pas la description.
    expect(bloc).toContain('visuel 1')
  })

  // Dans un bloc ordinaire, le filtre du fil borne chaque élément. Une page n'a pas ce filtre : à 10
  // propositions, la bande de vignettes débordait de 108 px à 560 px de large (mesuré, code 5).
  it('dans une page, la bande de vignettes reste bornée à sa colonne', () => {
    expect(carrouselDraft(spec(10))).toMatch(/\.dkc-film\{[^}]*min-width:0/u)
  })

  it('sans axes : le carrousel ne bouge pas, boutons précalculés compris', () => {
    const bloc = blocDuCarrousel(sansAxes())
    expect(bloc.startsWith('```html-render\n')).toBe(true)
    expect(bloc).not.toContain('dkc-ax')
    expect(bloc).toContain('dkc-mxa')
    expect(bloc).not.toContain('<script')
  })

  it('avec les réglages et une scène : une seule page, chaque script une fois', () => {
    const complet = spec(2, {
      css: '.ex-b{width:var(--ex-l)}',
      reglages: [{ nom: 'Largeur', variable: '--ex-l', min: 1, max: 9, valeur: 3, unite: 'px' }],
      scene3d: 'autowin.surChoix((n) => { document.body.dataset.n = n })'
    })
    expect(verifierPropositions(complet)).toEqual([])
    const page = pageDuCarrousel(complet)
    expect(page.split(SCRIPT_AXES)).toHaveLength(2)
    expect(page.split(SCRIPT_REGLAGES)).toHaveLength(2)
    expect(page).toContain('data-dkc-scene')
    expect(blocDuCarrousel(complet).match(/^```html-interactif$/gmu)).toHaveLength(1)
  })
})

describe('la page : composer le message', () => {
  let remplirSaisie

  const monter = (specDuTour = spec()) => {
    document.body.innerHTML = carrouselDraft(specDuTour)
    new Function(SCRIPT_AXES)()
  }
  const casePour = (axe, n) =>
    document.querySelector(`.dkc-ax input[data-axe="${axe}"][data-n="${n}"]`)
  const cocher = (axe, n) => casePour(axe, n).click()
  const commenter = (texte) => {
    const champ = document.querySelector('.dkc-ax textarea')
    champ.value = texte
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const bouton = (verbe) => document.querySelector(`.dkc-ax button[data-verbe="${verbe}"]`)
  const apercu = () => document.querySelector('.dkc-ax output').textContent

  beforeEach(() => {
    remplirSaisie = vi.fn(() => true)
    window.autowin = { remplirSaisie }
  })

  afterEach(() => {
    delete window.autowin
    document.body.replaceChildren()
  })

  it('nominal : le message exact, et ce qui part est ce qui est affiché', () => {
    monter()
    cocher('visuel', 6)
    cocher('fonctionnement', 1)
    cocher('fonctionnement', 2)
    commenter('plus dense')
    const attendu = 'Mixer : visuel de la 6 · fonctionnement de la 1 + 2 — plus dense'
    expect(apercu()).toBe(attendu)
    bouton('Mixer').click()
    expect(remplirSaisie).toHaveBeenCalledWith(attendu)
  })

  it('« Implémenter » porte le même mélange', () => {
    monter()
    cocher('visuel', 6)
    cocher('fonctionnement', 1)
    bouton('Implémenter').click()
    expect(remplirSaisie).toHaveBeenCalledWith(
      'Implémenter : visuel de la 6 · fonctionnement de la 1'
    )
  })

  it('commentaire vide : aucun tiret final', () => {
    monter()
    cocher('visuel', 3)
    cocher('fonctionnement', 4)
    commenter('   ')
    expect(apercu()).toBe('Mixer : visuel de la 3 · fonctionnement de la 4')
  })

  it('un seul axe sur deux propositions : l’autre axe n’est pas nommé', () => {
    monter()
    cocher('visuel', 1)
    cocher('visuel', 2)
    expect(apercu()).toBe('Mixer : visuel de la 1 + 2')
    expect(bouton('Mixer').disabled).toBe(false)
  })

  it('aucune case cochée : boutons inactifs, consigne affichée', () => {
    monter()
    expect(bouton('Mixer').disabled).toBe(true)
    expect(bouton('Implémenter').disabled).toBe(true)
    expect(apercu()).toContain('Coche')
  })

  it('une seule proposition, même sur ses deux axes : boutons inactifs', () => {
    monter()
    cocher('visuel', 2)
    cocher('fonctionnement', 2)
    expect(bouton('Mixer').disabled).toBe(true)
  })

  // Jumeau à la même borne : la deuxième proposition rend le mélange possible.
  it('deux propositions : boutons actifs', () => {
    monter()
    cocher('visuel', 2)
    cocher('fonctionnement', 3)
    expect(bouton('Mixer').disabled).toBe(false)
    expect(bouton('Implémenter').disabled).toBe(false)
  })

  it('décocher repasse sous la borne : boutons inactifs', () => {
    monter()
    cocher('visuel', 2)
    cocher('fonctionnement', 3)
    cocher('fonctionnement', 3)
    expect(bouton('Mixer').disabled).toBe(true)
  })

  it('commentaire sur plusieurs lignes : rassemblé en une seule', () => {
    monter()
    cocher('visuel', 1)
    cocher('fonctionnement', 2)
    commenter('plus dense\n\n  et plus sombre')
    expect(apercu()).toBe(
      'Mixer : visuel de la 1 · fonctionnement de la 2 — plus dense et plus sombre'
    )
  })

  it('un commentaire avec du HTML reste du texte', () => {
    monter()
    cocher('visuel', 1)
    cocher('fonctionnement', 2)
    commenter('<b>gras</b>')
    expect(document.querySelector('.dkc-ax output').children).toHaveLength(0)
    expect(apercu()).toContain('<b>gras</b>')
  })

  it('le champ borne le commentaire : le message reste sous la limite de la saisie', () => {
    monter()
    expect(document.querySelector('.dkc-ax textarea').getAttribute('maxlength')).toBe(
      String(COMMENTAIRE_MAX)
    )
    expect(COMMENTAIRE_MAX).toBeLessThan(3000)
  })

  it('10 propositions : les cases du bout marchent aussi', () => {
    monter(spec(10))
    cocher('visuel', 10)
    cocher('fonctionnement', 9)
    expect(apercu()).toBe('Mixer : visuel de la 10 · fonctionnement de la 9')
  })

  it('le bouton recliqué redonne le même message, sans le doubler', () => {
    monter()
    cocher('visuel', 1)
    cocher('fonctionnement', 2)
    bouton('Mixer').click()
    bouton('Mixer').click()
    expect(remplirSaisie.mock.calls).toEqual([
      ['Mixer : visuel de la 1 · fonctionnement de la 2'],
      ['Mixer : visuel de la 1 · fonctionnement de la 2']
    ])
  })

  it('un bouton inactif ne remplit rien', () => {
    monter()
    bouton('Mixer').click()
    expect(remplirSaisie).not.toHaveBeenCalled()
  })

  it('des réglages modifiés font partie du message, comme sur les autres boutons', () => {
    const avecReglages = spec(2, {
      css: '.ex-b{width:var(--ex-l)}',
      reglages: [{ nom: 'Largeur', variable: '--ex-l', min: 1, max: 9, valeur: 3, unite: 'px' }]
    })
    document.body.innerHTML = carrouselDraft(avecReglages)
    new Function(SCRIPT_REGLAGES)()
    new Function(SCRIPT_AXES)()
    cocher('visuel', 1)
    cocher('fonctionnement', 2)
    commenter('plus dense')
    const curseur = document.querySelector('.dkc-rg input')
    curseur.value = '5'
    curseur.dispatchEvent(new Event('input', { bubbles: true }))
    expect(apercu()).toBe(
      'Mixer : visuel de la 1 · fonctionnement de la 2 — Largeur 5 px — plus dense'
    )
  })
})
