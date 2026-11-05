import { describe, expect, it } from 'vitest'
import {
  ATTENTE_LANCEMENT_MAX_MS,
  ATTENTE_MAX_MS,
  attendreLancement,
  decrireEtape,
  dossierDeSortie,
  dureeMaxJaugesMs,
  dureeMaxScenarioMs,
  jaugesFausses,
  lireScenario,
  normaliserTexte,
  pageContient,
  verbeDe
} from './html-interactif-apercu-scenario.mjs'

const lire = (etapes) => lireScenario(JSON.stringify(etapes))

// conv-1586 (2026-11-05) : la sonde partait après 1,5 s fixes. Sous charge, la page n'avait pas encore
// dit « lancee » : « page jamais lancée » sur un carrousel sain, puis « parameter 1 is not of type
// 'Element' » sur une page d'une ligne (1 essai sur 2).
describe('attendreLancement : la sonde attend que la page ait démarré', () => {
  // Horloge simulée : chaque pause avance le temps, aucune vraie attente.
  const horloge = () => {
    let t = 0
    return { maintenant: () => t, pause: async (ms) => void (t += ms) }
  }
  const lecteur = (suite) => {
    let n = 0
    return async () => suite[Math.min(n++, suite.length - 1)]
  }

  it('attend le signal « lancee » au lieu de partir avant lui', async () => {
    const h = horloge()
    const r = await attendreLancement(lecteur([[], ['pret'], ['pret'], ['pret', 'lancee']]), h)
    expect(r).toEqual({ lancee: true, attenteMs: 300 })
  })

  it('une erreur au démarrage arrête aussi l’attente : elle sera rapportée', async () => {
    const h = horloge()
    const r = await attendreLancement(lecteur([['pret'], ['pret', 'erreur']]), h)
    expect(r.lancee).toBe(false)
    expect(r.attenteMs).toBe(100)
  })

  it('une page qui ne démarre jamais est rendue au plafond, pas attendue sans fin', async () => {
    const h = horloge()
    const r = await attendreLancement(lecteur([['pret']]), h)
    expect(r).toEqual({ lancee: false, attenteMs: ATTENTE_LANCEMENT_MAX_MS })
  })
})

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

  // conv-1382 (2026-10-31) : chaque proposition garde ses valeurs. Réglée sur la 1, une jauge qui
  // change aussi la 2 écrase le réglage qu'on y avait fait.
  it('refuse une jauge qui change d’autres propositions que celle qu’on règle', () => {
    expect(
      jaugesFausses([{ ...jauge([1, 2], [1, 2]), fuites: [{ depuis: 1, vers: [2, 3] }] }])
    ).toEqual([{ nom: 'Rayon', raison: 'reglee sur la 1, change aussi la 2, 3' }])
    expect(jaugesFausses([{ ...jauge([1, 2], [1, 2]), fuites: [] }])).toEqual([])
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

  // conv-1586 (2026-11-05) : 3 jauges x 6 propositions = 100,6 s de sonde mesurés, pour 73 s
  // accordés à toute la vérification. Electron était tué (SIGTERM) avant d'avoir rendu un verdict.
  it('rend la durée maximale de la sonde des jauges, selon jauges et propositions', () => {
    const jauge = '<label for="dkr1" class="dkc-rgl">'
    const radio = '<input type="radio" name="dkp" id="dkp1">'
    expect(dureeMaxJaugesMs('<p>sans carrousel</p>')).toBe(0)
    expect(dureeMaxJaugesMs(radio.repeat(6))).toBe(0)
    const sonde = dureeMaxJaugesMs(jauge.repeat(3) + radio.repeat(6))
    expect(sonde).toBeGreaterThan(100_600)
    expect(sonde).toBe(3 * 6 * 8_000)
  })

  it('nomme une étape comme le rapport la montrera', () => {
    const etape = { voir: 'x', dans: '#total' }
    expect(verbeDe(etape)).toBe('voir')
    expect(decrireEtape(etape)).toBe('voir "x" dans #total')
    expect(decrireEtape({ remplir: '#a', valeur: 3 })).toBe('remplir "#a" = 3')
  })
})
