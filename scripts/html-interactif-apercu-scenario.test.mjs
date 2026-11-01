import { describe, expect, it } from 'vitest'
import {
  ATTENTE_MAX_MS,
  decrireEtape,
  dossierDeSortie,
  dureeMaxScenarioMs,
  jaugesFausses,
  lireScenario,
  normaliserTexte,
  pageContient,
  verbeDe
} from './html-interactif-apercu-scenario.mjs'

const lire = (etapes) => lireScenario(JSON.stringify(etapes))

describe('jaugesFausses : une jauge visible change ce qu’on regarde', () => {
  const jauge = (visible, effet) => ({ nom: 'Rayon', variable: '--ex-r', visible, effet })

  it('une jauge juste, ou aucune jauge : rien à redire', () => {
    expect(jaugesFausses([jauge([1, 2], [1, 2])])).toEqual([])
    expect(jaugesFausses(undefined)).toEqual([])
  })

  it('refuse une jauge qui ne change rien, même cachée partout', () => {
    expect(jaugesFausses([jauge([], [])])).toEqual([
      { nom: 'Rayon', raison: 'ne change aucune proposition' }
    ])
  })

  it('nomme les propositions où elle reste visible sans effet', () => {
    expect(jaugesFausses([jauge([1, 2, 3], [1])])).toEqual([
      { nom: 'Rayon', raison: 'visible sans effet sur la 2, 3' }
    ])
  })

  it('nomme les propositions où elle manque alors qu’elle agit', () => {
    expect(jaugesFausses([jauge([1], [1, 2])])).toEqual([
      { nom: 'Rayon', raison: "cachee alors qu'elle change la 2" }
    ])
  })
})

describe('lireScenario : ce qui part vers Electron', () => {
  it('accepte chaque verbe, avec ses options', () => {
    const etapes = [
      { remplir: '#montant', valeur: '200000' },
      { choisir: '#type', valeur: 'RTT' },
      { cliquer: 'texte=Calculer' },
      { cliquer: 'canvas', x: 0.25, y: 1 },
      { survoler: 'canvas', x: 0, y: 0.5 },
      { touche: 'Enter' },
      { attendre: 500 },
      { voir: '1 109,20', dans: '#mensualite' },
      { pasVoir: 'NaN' },
      { demande: 'prompt', contient: 'Congés' },
      { demande: 'copier' }
    ]
    expect(lire(etapes)).toEqual({ etapes })
  })

  it.each([
    ['JSON cassé', '[{', /JSON illisible/u],
    ['objet au lieu d’un tableau', '{"cliquer":"#a"}', /tableau/u],
    ['tableau vide', '[]', /tableau/u]
  ])('refuse la forme : %s', (_nom, texte, motif) => {
    expect(lireScenario(texte).erreur).toMatch(motif)
  })

  // Le numéro d'étape est dans la phrase : le modèle corrige sans relire le code de l'outil.
  it.each([
    ['aucun verbe', [{ clique: '#a' }], /etape 1 : .*seul verbe/u],
    ['deux verbes', [{ cliquer: '#a', voir: 'x' }], /seul verbe/u],
    ['valeur manquante', [{ remplir: '#a' }], /exige le champ « valeur »/u],
    ['champ inconnu', [{ cliquer: '#a', valeur: '1' }], /n'accepte pas le champ/u],
    ['cible vide', [{ cliquer: ' ' }], /selecteur CSS/u],
    ['fraction hors bornes', [{ cliquer: '#a', x: 50 }], /fraction/u],
    ['touche inconnue', [{ touche: 'Entree' }], /touche inconnue/u],
    ['attente trop longue', [{ attendre: ATTENTE_MAX_MS + 1 }], /millisecondes/u],
    ['texte vide', [{ voir: '' }], /texte cherche/u],
    ['demande inconnue', [{ demande: 'envoyer' }], /copier, lien, prompt/u],
    ['zone vide', [{ voir: 'x', dans: '' }], /« dans »/u],
    ['étape non objet', ['#a'], /objet/u]
  ])('refuse : %s', (_nom, etapes, motif) => {
    expect(lire(etapes).erreur).toMatch(motif)
  })

  it('nomme le rang de la première étape fautive', () => {
    expect(lire([{ attendre: 1 }, { attendre: 2 }, { voir: '' }]).erreur).toMatch(/etape 3/u)
  })
})

describe('pageContient : lire comme un œil', () => {
  // toLocaleString('fr-FR') : espace fine insécable. Le scénario est écrit au clavier.
  it('ignore les espaces fines et insécables des nombres', () => {
    expect(pageContient('1\u202f109,20\u00a0€', '1 109,20 €')).toBe(true)
  })

  it('ignore la casse et les retours à la ligne', () => {
    expect(pageContient('MENSUALITÉ\n\n  666', 'mensualité 666')).toBe(true)
  })

  it('ne confond pas deux textes voisins', () => {
    expect(pageContient('1 109,21', '1 109,20')).toBe(false)
    expect(pageContient('', 'x')).toBe(false)
  })

  it('normaliserTexte supporte l’absence de texte', () => {
    expect(normaliserTexte(undefined)).toBe('')
  })
})

describe('dossierDeSortie : un dossier par page', () => {
  it('sépare deux pages de même nom, et garde le même dossier d’un essai à l’autre', () => {
    const a = dossierDeSortie('/depot', '/fil-a/page.html')
    const b = dossierDeSortie('/depot', '/fil-b/page.html')
    expect(a).not.toBe(b)
    expect(dossierDeSortie('/depot', '/fil-a/page.html')).toBe(a)
  })
})

describe('décrire et borner', () => {
  it('rend la durée maximale, attentes comprises', () => {
    expect(dureeMaxScenarioMs(undefined)).toBe(0)
    expect(dureeMaxScenarioMs([{ attendre: 1000 }, { voir: 'x' }])).toBeGreaterThanOrEqual(3000)
  })

  it('nomme une étape comme le rapport la montrera', () => {
    const etape = { voir: 'x', dans: '#total' }
    expect(verbeDe(etape)).toBe('voir')
    expect(decrireEtape(etape)).toBe('voir "x" dans #total')
    expect(decrireEtape({ remplir: '#a', valeur: 3 })).toBe('remplir "#a" = 3')
  })
})
