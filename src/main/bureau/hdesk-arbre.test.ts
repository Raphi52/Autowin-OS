import { describe, expect, it } from 'vitest'
import {
  ARBRE_TEXTE_MAX,
  argumentsArbre,
  interpreterArbre,
  outilsBureauCacheDuChat,
  texteArbre,
  type ElementArbre,
  type LectureArbre
} from './hdesk-arbre'
import {
  argumentsAct,
  argumentsElement,
  pointEcran,
  type GesteElement,
  type GesteTv,
  type ImageTv
} from './hdesk-tv'

/*
 * conv-1457 : arbre d'accessibilité du bureau caché joint à `bureau_cache_observer`, appui par nom
 * dans `bureau_cache_agir`, et clic x/y converti comme la petite TV (capture recadrée).
 * Mesures réelles qui fondent les valeurs ci-dessous : Table des caractères dans un bureau caché le
 * 2026-11-03 — image recadrée d'origine (7,57), bouton « Sélectionner » id=103 en (329,405) 75×23.
 */
const SELECTIONNER: ElementArbre = {
  type: 'Button',
  nom: 'Sélectionner',
  id: '103',
  techno: 'Win32',
  actif: true,
  x: 329,
  y: 405,
  largeur: 75,
  hauteur: 23,
  fenetre: 0
}
const IMAGE_RECADREE: ImageTv = {
  statut: 'ok',
  id: 'x',
  dataUrl: 'data:image/png;base64,AA==',
  width: 507,
  height: 602
}
const arbre = (elements: ElementArbre[], omis = 0): LectureArbre => ({
  ok: true,
  arbre: { fenetres: ['Table des caractères'], total: elements.length + omis, omis, elements }
})

describe('arguments des scripts', () => {
  it('arbre : identifiant de bureau validé, plafond passé', () => {
    expect(argumentsArbre('R', 'chat-conv-1')).toEqual(
      expect.arrayContaining(['-InstanceId', 'chat-conv-1', '-Plafond', '500'])
    )
    expect(() => argumentsArbre('R', 'a;b')).toThrow(/Identifiant/)
  })
  it('appui par nom : -Element, origine en option, jamais -X/-Y', () => {
    const a = argumentsElement('R', {
      id: 'b1',
      element: '  Valider la saisie ',
      origine: { x: 7, y: 57 }
    })
    expect(a.slice(-6)).toEqual([
      '-Element',
      'Valider la saisie',
      '-OrigineX',
      '7',
      '-OrigineY',
      '57'
    ])
    expect(a).not.toContain('-X')
    expect(argumentsElement('R', { id: 'b1', element: '103' })).not.toContain('-OrigineX')
  })
  it('appui par nom : vide, blanc ou trop long → refus', () => {
    expect(() => argumentsElement('R', { id: 'b1', element: '   ' })).toThrow(/vide/)
    expect(() => argumentsElement('R', { id: 'b1', element: 'x'.repeat(201) })).toThrow(/200/)
    expect(() => argumentsElement('R', { id: 'a b', element: 'x' })).toThrow(/Identifiant/)
  })
  it('P2-15 : un x négatif reste invalide même avec une origine (refusé, pas décalé)', () => {
    const g = pointEcran({ id: 'a', x: -1, y: 5 }, { x: 7, y: 57 })
    expect(g).toEqual({ id: 'a', x: -1, y: 5 })
    expect(() => argumentsAct('R', g)).toThrow(/Coordonnées invalides/)
    expect(() =>
      argumentsAct('R', pointEcran({ id: 'a', x: 32767, y: 5 }, { x: 7, y: 57 }))
    ).toThrow(/hors bornes/)
  })
})

describe('lecture de la sortie de hdesk-arbre.ps1', () => {
  it('rend l’arbre de la dernière ligne JSON', () => {
    const l = interpreterArbre(
      `bruit\n{"bureau":"b","fenetres":["F"],"total":2,"omis":1,"elements":[{"type":"Button","nom":"Aide","actif":true,"fenetre":0}]}\n`
    )
    expect(l).toEqual({
      ok: true,
      arbre: {
        fenetres: ['F'],
        total: 2,
        omis: 1,
        elements: [{ type: 'Button', nom: 'Aide', actif: true, fenetre: 0 }]
      }
    })
  })
  it('sortie vide ou cassée → lecture ratée, jamais un arbre vide', () => {
    for (const out of ['', 'texte', '{pas du json', '{"elements":"x","fenetres":[]}'])
      expect(interpreterArbre(out).ok).toBe(false)
  })
})

describe('texte de l’arbre joint à l’observation', () => {
  it('positions = centre en pixels de l’IMAGE (origine retirée), états et valeurs lisibles', () => {
    const t = texteArbre(
      arbre([
        SELECTIONNER,
        {
          type: 'Button',
          nom: 'Copier',
          id: '102',
          actif: false,
          x: 410,
          y: 405,
          largeur: 75,
          hauteur: 23,
          fenetre: 0
        },
        {
          type: 'CheckBox',
          nom: 'Affichage avancé',
          id: '119',
          actif: true,
          coche: 'Off',
          x: 34,
          y: 449,
          largeur: 192,
          hauteur: 20,
          fenetre: 0
        },
        {
          type: 'Edit',
          nom: 'Caractères à copier :',
          id: '104',
          actif: true,
          valeur: '!',
          x: 158,
          y: 405,
          largeur: 165,
          hauteur: 26,
          fenetre: 0
        }
      ]),
      { x: 7, y: 57 }
    )
    // 329 + 75/2 - 7 = 359,5 → 360 ; 405 + 23/2 - 57 = 359,5 → 360
    expect(t).toContain('Button « Sélectionner » id=103 (360,360)')
    // 410 + 75/2 - 7 = 440,5 → 441
    expect(t).toContain('Button « Copier » id=102 (441,360) inactif')
    expect(t).toContain('coché=Off')
    expect(t).toContain('valeur=« ! »')
    expect(t).toContain('[Fenêtre « Table des caractères »]')
  })
  it('libellé montré quand le nom est vide ; élément hors écran tu', () => {
    const t = texteArbre(
      arbre([
        {
          type: 'Button',
          libelle: 'Valider la saisie',
          techno: 'WPF',
          actif: true,
          x: 0,
          y: 0,
          largeur: 10,
          hauteur: 10,
          fenetre: 0
        },
        { type: 'ListItem', nom: 'Caché', actif: true, horsEcran: true, fenetre: 0 }
      ]),
      undefined
    )
    expect(t).toContain('Button « Valider la saisie » (5,5)')
    expect(t).not.toContain('Caché')
    expect(t).toContain('1 élément(s) non montré(s)')
  })
  it('P2-13 : arbre énorme → 4 000 caractères au plus, contrôles d’abord, reste compté', () => {
    const cases = Array.from({ length: 600 }, (_, i): ElementArbre => ({
      type: 'DataItem',
      nom: `Case ${i}`,
      actif: true,
      x: i,
      y: 0,
      largeur: 10,
      hauteur: 10,
      fenetre: 0
    }))
    const t = texteArbre(arbre([...cases, SELECTIONNER], 40), { x: 0, y: 0 })
    expect(t.length).toBeLessThanOrEqual(ARBRE_TEXTE_MAX)
    expect(t.split('\n')[2]).toContain('Sélectionner')
    expect(t).toMatch(/… \d+ élément\(s\) non montré\(s\)/)
    const montres = t.split('\n').filter((l) => l.startsWith('DataItem')).length
    expect(Number(/… (\d+) élément/.exec(t)![1])).toBe(600 + 1 + 40 - montres - 1)
  })
  it('P2-12 : arbre vide → la phrase le dit ; lecture ratée → la raison, et vise x/y', () => {
    expect(texteArbre(arbre([]), undefined)).toMatch(/Aucun élément lisible.*vise x\/y/)
    expect(texteArbre({ ok: false, message: 'délai dépassé' }, undefined)).toMatch(
      /indisponible \(délai dépassé\).*vise x\/y/
    )
  })
})

describe('outils du chat : observation et geste', () => {
  const IMAGE: ImageTv = {
    statut: 'ok',
    id: 'b1',
    dataUrl: 'data:image/png;base64,AA==',
    width: 10,
    height: 10
  }
  const capteurFixe = (origine?: {
    x: number
    y: number
  }): ReturnType<Parameters<typeof outilsBureauCacheDuChat>[0]['capteur']> => ({
    image: async () => IMAGE,
    versEcran: (g) => pointEcran(g, origine),
    origine: () => origine
  })

  it('l’observation joint l’arbre, en pixels de l’image', async () => {
    const o = outilsBureauCacheDuChat({
      capteur: () => capteurFixe({ x: 7, y: 57 }),
      lireArbre: async () => arbre([SELECTIONNER]),
      agir: async () => ({ ok: true })
    })
    const r = await o.observer('b1')
    expect(r).toMatchObject({ statut: 'ok', dataUrl: IMAGE.dataUrl })
    expect(r.arbre).toContain('(360,360)')
  })
  it('un arbre en panne (rejet ou échec) laisse la capture intacte', async () => {
    for (const lireArbre of [
      async (): Promise<LectureArbre> => {
        throw new Error('PowerShell absent')
      },
      async (): Promise<LectureArbre> => ({ ok: false, message: 'Bureau introuvable' })
    ]) {
      const r = await outilsBureauCacheDuChat({
        capteur: () => capteurFixe(),
        lireArbre,
        agir: async () => ({ ok: true })
      }).observer('b1')
      expect(r).toMatchObject({ statut: 'ok', dataUrl: IMAGE.dataUrl })
      expect(r.arbre).toMatch(/indisponible/)
    }
  })
  it('bureau fermé → pas de lecture d’arbre', async () => {
    let lu = 0
    const r = await outilsBureauCacheDuChat({
      capteur: () => ({ ...capteurFixe(), image: async () => ({ statut: 'ferme', id: 'b1' }) }),
      lireArbre: async () => (lu++, arbre([])),
      agir: async () => ({ ok: true })
    }).observer('b1')
    expect(r).toEqual({ statut: 'ferme', id: 'b1' })
    expect(lu).toBe(0)
  })
  it('appui par nom : l’origine de l’image part avec, sans x/y', async () => {
    const recus: Array<GesteTv | GesteElement> = []
    await outilsBureauCacheDuChat({
      capteur: () => capteurFixe({ x: 7, y: 57 }),
      lireArbre: async () => arbre([]),
      agir: async (g) => (recus.push(g), { ok: true })
    }).agir({ id: 'b1', element: '103' })
    expect(recus).toEqual([{ id: 'b1', element: '103', origine: { x: 7, y: 57 } }])
  })
})

describe('outils du chat : le clic suit l’image recadrée', () => {
  /*
   * Pas de second CapteurHdesk réel ici : son constructeur purge TOUS les dossiers d'images du dossier
   * temporaire (`purgerDossiersOrphelins`), y compris celui d'un capteur qui tourne en parallèle dans
   * hdesk-tv.test.ts — mesuré le 2026-11-03 : 1 échec sur 2 en lançant les deux fichiers ensemble. Le
   * getter `origine` du vrai capteur est vérifié dans hdesk-tv.test.ts (« origine de la capture »).
   */
  it('après une capture d’origine (7,57), {x:10, y:20} part en X=17, Y=77', async () => {
    const recus: Array<GesteTv | GesteElement> = []
    const origines = new Map<string, { x: number; y: number }>()
    const outils = outilsBureauCacheDuChat({
      capteur: () => ({
        // Comme CapteurHdesk.image : l'origine de la réponse `shot` est retenue pour ce bureau.
        image: async (id) => (origines.set(id, { x: 7, y: 57 }), { ...IMAGE_RECADREE, id }),
        versEcran: (g) => pointEcran(g, origines.get(g.id)),
        origine: (id) => origines.get(id)
      }),
      lireArbre: async () => arbre([SELECTIONNER]),
      agir: async (g) => (recus.push(g), { ok: true })
    })
    const vu = await outils.observer('chat-conv-1')
    expect(vu.arbre).toContain('(360,360)')
    await outils.agir({ id: 'chat-conv-1', x: 10, y: 20 })
    expect(recus).toEqual([{ id: 'chat-conv-1', x: 17, y: 77 }])
  })
})
