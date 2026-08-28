import { describe, expect, it } from 'vitest'
import {
  SEUILS,
  VUES_CONNUES,
  resoudreVue,
  verdictCapture,
  verdictMouvement
} from '../../scripts/ui-capture.mjs'

/**
 * LE HARNAIS DE CAPTURE DOIT ÊTRE INCAPABLE DE RENDRE UN FAUX VERT.
 *
 * Contexte mesuré le 2026-08-12 : le juge exigeait « une preuve UI live sur un binaire packagé
 * frais » (conv-1135) et « la capture/CDP de l'application réelle » (conv-1137) alors que le
 * producteur in-app ne dispose que de Read/Grep/Glob + Bash/Edit/Write. On met donc la preuve à
 * sa portée — mais une preuve qui peut mentir ne vaut pas mieux que pas de preuve du tout.
 *
 * Ces tests verrouillent le verdict PUR : chaque façon d'obtenir une capture creuse (mauvaise vue,
 * navigation non appliquée, page blanche, PNG vide) doit être NOMMÉE, pas seulement rejetée.
 */
describe('verdict du harnais de capture', () => {
  const bon = {
    vue: 'worktree',
    destinationActive: 'worktree',
    longueurTexte: 800,
    elements: 240,
    octetsPng: 180_000
  }

  it('valide une capture réellement rendue', () => {
    expect(verdictCapture(bon)).toEqual({ ok: true, echecs: [] })
  })

  it('refuse une capture prise sur une AUTRE vue que celle demandée', () => {
    const v = verdictCapture({ ...bon, destinationActive: 'chat' })
    expect(v.ok).toBe(false)
    expect(v.echecs.join()).toContain('navigation-non-appliquee(chat)')
  })

  it('refuse une page blanche même si le PNG est gros', () => {
    // Le cas dangereux : l'écran est noir ou vide, le fichier pèse lourd, tout « a l'air » bon.
    const v = verdictCapture({ ...bon, longueurTexte: 3, elements: 1 })
    expect(v.ok).toBe(false)
    expect(v.echecs).toContain('vue-vide-texte')
    expect(v.echecs).toContain('vue-vide-elements')
  })

  it('refuse un PNG de la taille d’une image vide', () => {
    const v = verdictCapture({ ...bon, octetsPng: 900 })
    expect(v.ok).toBe(false)
    expect(v.echecs).toContain('png-trop-petit')
  })

  it('refuse une vue inconnue au lieu de capturer n’importe quoi', () => {
    expect(verdictCapture({ ...bon, vue: undefined }).echecs).toContain('vue-inconnue')
  })

  it('cumule les motifs plutôt que de s’arrêter au premier', () => {
    const v = verdictCapture({
      vue: 'worktree',
      destinationActive: 'chat',
      longueurTexte: 0,
      elements: 0,
      octetsPng: 0
    })
    expect(v.echecs.length).toBeGreaterThanOrEqual(4)
  })
})

describe('résolution du nom de vue', () => {
  it('accepte les identifiants réels du catalogue applicatif', () => {
    for (const vue of VUES_CONNUES) expect(resoudreVue(vue)).toBe(vue)
  })

  it('tolère le pluriel qui traîne dans les scripts et la doc', () => {
    expect(resoudreVue('worktrees')).toBe('worktree')
  })

  it('rejette un nom inventé plutôt que de deviner', () => {
    expect(resoudreVue('dashboard')).toBeUndefined()
    expect(resoudreVue('')).toBeUndefined()
  })
})

describe('seuils', () => {
  it('reste au-dessus d’une capture vide typique', () => {
    // Un PNG 1×1 pèse ~100 octets, une frame noire compressée quelques ko : le seuil doit être
    // franchement au-dessus, sinon il laisse passer exactement ce qu'il prétend attraper.
    expect(SEUILS.octetsPng).toBeGreaterThanOrEqual(4 * 1024)
  })
})

/**
 * PROUVER UN ETAT QU'IL FAUT OUVRIR.
 *
 * Defaut vecu le 2026-08-26 (conv-1420) : un travail juste — test rouge puis vert, falsifiabilite
 * demontree par mutation — a ete refuse par le juge, qui exigeait « une capture du popover OUVERT
 * montrant la jauge ». Le harnais navigue par le bouton `nav-<vue>` puis capture : il ne peut donc
 * prouver QUE des etats atteignables sans interaction. Popover, menu, onglet, modale : hors de
 * portee. Deux runs, 1,95 $, pour un code qui n'avait rien a se reprocher.
 *
 * Le declencheur seul ne suffit pas. Un selecteur TROUVE mais inerte — deja ouvert, clic absorbe,
 * handler non pose — rendrait une capture de la vue FERMEE avec un verdict vert : exactement le
 * faux vert que ce harnais existe pour rendre impossible. Le verdict exige donc un DELTA DOM.
 */
describe('verdict quand la preuve exige un clic', () => {
  const ouvert = {
    vue: 'chat',
    destinationActive: 'chat',
    longueurTexte: 800,
    elements: 260,
    octetsPng: 40_000,
    declencheur: '[data-testid="quota-indicator"]',
    declencheurTrouve: true,
    elementsAvantClic: 240
  }

  it('accepte une capture dont le clic a REELLEMENT change la vue', () => {
    expect(verdictCapture(ouvert)).toEqual({ ok: true, echecs: [] })
  })

  it('nomme le declencheur introuvable au lieu de capturer la vue fermee', () => {
    const verdict = verdictCapture({ ...ouvert, declencheurTrouve: false })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('declencheur-absent([data-testid="quota-indicator"])')
  })

  it('refuse un clic SANS EFFET — le piege du vert creux', () => {
    // Le declencheur existe, le clic part, et rien ne s'ouvre. Sans cette garde, la capture
    // montrerait la vue fermee et le verdict dirait « prouve ».
    const verdict = verdictCapture({ ...ouvert, elementsAvantClic: 260 })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('clic-sans-effet([data-testid="quota-indicator"])')
  })

  it('laisse INTACTES les captures sans clic', () => {
    // Sans `--click`, aucune des deux gardes ne doit mordre : le comportement d'origine est le
    // contrat de tous les appels existants.
    const sansClic = {
      vue: 'chat',
      destinationActive: 'chat',
      longueurTexte: 800,
      elements: 240,
      octetsPng: 40_000
    }
    expect(verdictCapture(sansClic)).toEqual({ ok: true, echecs: [] })
  })
})

/**
 * PROUVER QU'UN ELEMENT BOUGE.
 *
 * Defaut vecu le 2026-08-28 (conv-1507 puis conv-1498) : le chantier « spinner » a livre une
 * animation declaree correcte sur la foi d'un `tsc` vert et d'une capture PNG FIXE. C'est
 * l'utilisateur qui a du signaler « c'est cense bouger, la il est static », puis refuter d'un « nn »
 * l'hypothese de cause qui a suivi. Une image immobile ne peut pas, par construction, dire si ce
 * qu'elle montre tourne : l'oracle manquait, et aucun soin apporte au code ne pouvait le remplacer.
 *
 * Le piege JUMEAU, et la raison pour laquelle le diff se mesure au rendu VRAI : le dessin etait
 * concu a 160 px et rendu a 18 px, ou la trainee tombait a 0,3 px. L'animation tournait bel et bien
 * — elle faisait tourner de l'invisible. Un diff calcule sur un agrandi ×8 aurait vu ce detail
 * sous-pixel et rendu « ca bouge » sur exactement l'ecran ou l'utilisateur ne voyait rien.
 */
describe('verdict de mouvement', () => {
  const anime = {
    selecteur: '.spinner',
    occurrences: [
      { largeur: 18, hauteur: 18, ratios: [0.21, 0.19, 0.23] },
      { largeur: 14, hauteur: 14, ratios: [0.16, 0.18, 0.15] }
    ]
  }

  it('valide un element qui bouge reellement sur toutes ses occurrences', () => {
    expect(verdictMouvement(anime)).toEqual({ ok: true, echecs: [] })
  })

  it('NOMME l element immobile — le defaut que cet outil existe pour attraper', () => {
    // Le cas du 28/08 : l animation tourne, mais ne deplace rien de visible. Les frames sont
    // identiques a la fraction de pixel pres, donc le ratio de diff est nul.
    const verdict = verdictMouvement({
      ...anime,
      occurrences: [{ largeur: 18, hauteur: 18, ratios: [0, 0.0001, 0] }]
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('mouvement-absent(.spinner#1, 18x18, max=0.0001)')
  })

  it('refuse un selecteur qui ne matche RIEN au lieu de conclure a l immobilite', () => {
    // Sans cette garde, zero occurrence = zero ratio sous le seuil = « immobile » : le harnais
    // accuserait le CSS alors que la preuve n a jamais ete prise.
    const verdict = verdictMouvement({ selecteur: '.spinner', occurrences: [] })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toEqual(['selecteur-sans-occurrence(.spinner)'])
  })

  it('nomme une occurrence de taille nulle plutot que de la diffuser comme immobile', () => {
    const verdict = verdictMouvement({
      selecteur: '.spinner',
      occurrences: [{ largeur: 0, hauteur: 18, ratios: [0, 0] }]
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('occurrence-invisible(.spinner#1, 0x18)')
    // Une occurrence invisible ne doit PAS etre accusee en plus d etre immobile : un seul motif,
    // le vrai. Deux motifs pour une cause envoient le producteur corriger l animation d un element
    // qui n est meme pas affiche.
    expect(verdict.echecs).toHaveLength(1)
  })

  it('accuse l occurrence FAUTIVE, pas la moyenne — le piege du spinner qui bouge ailleurs', () => {
    // Exactement le « il agit pas de la meme facon selon ou il est » du 12:18 : le rail tourne, la
    // pastille de la sidebar est morte. Une moyenne, ou un « au moins une bouge », aurait rendu
    // vert et laisse le defaut en place.
    const verdict = verdictMouvement({
      selecteur: '.spinner',
      occurrences: [
        { largeur: 18, hauteur: 18, ratios: [0.2, 0.22] },
        { largeur: 14, hauteur: 14, ratios: [0, 0] }
      ]
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toEqual(['mouvement-absent(.spinner#2, 14x14, max=0)'])
  })

  it('exige au moins DEUX frames — une seule ne peut rien prouver', () => {
    const verdict = verdictMouvement({
      selecteur: '.spinner',
      occurrences: [{ largeur: 18, hauteur: 18, ratios: [] }]
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('frames-insuffisantes(.spinner#1)')
  })

  it('garde un seuil de mouvement franchement au-dessus du bruit d anticrenelage', () => {
    // Trop bas, le seuil laisse passer le scintillement d un rendu identique ; trop haut, il refuse
    // une rotation lente et legitime. Le cas mesure separe largement : 0 contre ~0,2.
    expect(SEUILS.mouvement).toBeGreaterThan(0.0005)
    expect(SEUILS.mouvement).toBeLessThan(0.05)
  })
})
