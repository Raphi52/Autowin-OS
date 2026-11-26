import { describe, expect, it } from 'vitest'
import {
  ARBRE_TEXTE_MAX,
  argumentsArbre,
  interpreterArbre,
  outilsBureauCacheDuChat,
  texteArbre,
  zonesARelire,
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
 * Arbre d'accessibilité du bureau caché joint à `bureau_cache_observer`, appui par nom
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
  it('arbre d’une zone : -Racine COLLÉE à sa valeur, origine de l’image en option', () => {
    const a = argumentsArbre('R', 'b1', 500, { racine: ' @k3f9a2:e57 ', origine: { x: 7, y: 57 } })
    expect(a.slice(-5)).toEqual(['-Racine:@k3f9a2:e57', '-OrigineX', '7', '-OrigineY', '57'])
    // Séparée, « — » serait lu par PowerShell comme un nom de paramètre (code 2, sans message).
    expect(argumentsArbre('R', 'b1', 500, { racine: '— Total' })).toContain('-Racine:— Total')
    expect(argumentsArbre('R', 'b1', 500, { racine: '  ' }).join(' ')).not.toContain('-Racine')
    expect(argumentsArbre('R', 'b1', 500, { racine: 'Liste' })).not.toContain('-OrigineX')
    expect(() => argumentsArbre('R', 'b1', 500, { racine: 'x'.repeat(201) })).toThrow(/200/)
  })
  it('appui par nom : -Element, origine en option, jamais -X/-Y', () => {
    const a = argumentsElement('R', {
      id: 'b1',
      element: '  Valider la saisie ',
      origine: { x: 7, y: 57 }
    })
    expect(a.slice(-5)).toEqual(['-Element:Valider la saisie', '-OrigineX', '7', '-OrigineY', '57'])
    expect(a).not.toContain('-X')
    // Séparé, « — » serait lu par PowerShell comme un nom de paramètre (code 2, sans message).
    expect(argumentsElement('R', { id: 'b1', element: '—' })).toContain('-Element:—')
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
  it('garde l’identifiant de la lecture et le repère de chaque élément', () => {
    const l = interpreterArbre(
      '{"bureau":"b","lecture":"k3f9a2","fenetres":["F"],"total":1,"omis":0,"elements":[{"ref":"@k3f9a2:e1","type":"Edit","nom":"Nom","actif":true,"modifiable":true,"fenetre":0}]}'
    )
    expect(l.ok && l.arbre.lecture).toBe('k3f9a2')
    expect(l.ok && l.arbre.elements[0].ref).toBe('@k3f9a2:e1')
  })
  it('lecture d’une zone : l’élément racine est gardé', () => {
    const l = interpreterArbre(
      '{"bureau":"b","lecture":"m2","racine":{"ref":"@k3f9a2:e57","type":"List","actif":true,"fenetre":0},"fenetres":["F"],"total":0,"omis":0,"elements":[]}'
    )
    expect(l.ok && l.arbre.racine).toEqual({
      ref: '@k3f9a2:e57',
      type: 'List',
      actif: true,
      fenetre: 0
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
  it('repère de chaque élément et champs remplissables montrés ; en-tête qui cite la lecture', () => {
    const t = texteArbre(
      {
        ok: true,
        arbre: {
          lecture: 'k3f9a2',
          fenetres: ['Table des caractères'],
          total: 2,
          omis: 0,
          elements: [
            { ...SELECTIONNER, ref: '@k3f9a2:e4' },
            {
              ref: '@k3f9a2:e5',
              type: 'Edit',
              nom: 'Caractères à copier :',
              id: '104',
              actif: true,
              modifiable: true,
              x: 158,
              y: 405,
              largeur: 165,
              hauteur: 26,
              fenetre: 0
            }
          ]
        }
      },
      { x: 7, y: 57 }
    )
    expect(t).toContain('Button « Sélectionner » @k3f9a2:e4 id=103 (360,360)')
    expect(t).toMatch(/Edit « Caractères à copier : » @k3f9a2:e5 id=104 \(\d+,\d+\) remplissable/)
    expect(t.split('\n')[0]).toContain('lecture k3f9a2')
    expect(t.split('\n')[0]).toContain('repère')
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
  /*
   * Écran WPF mesuré le 2026-11-26 (pilote de tests, module Global) : 95 éléments, 0 hors écran ; le
   * texte s'arrêtait au 4e des 9 scénarios, et la liste qui les porte, sans nom, était tue. Même forme
   * ici : des boutons en tête, puis une liste SANS NOM dont les lignes ne tiennent plus.
   */
  const ecranCharge = (): ElementArbre[] => {
    const boutons = Array.from({ length: 30 }, (_, i): ElementArbre => ({
      ref: `@l1:e${i + 1}`,
      type: 'Button',
      nom: `Bouton de la barre ${i}`,
      actif: true,
      x: 10 + i * 40,
      y: 10,
      largeur: 30,
      hauteur: 20,
      fenetre: 0
    }))
    const liste: ElementArbre = {
      ref: '@l1:e31',
      type: 'List',
      actif: true,
      x: 0,
      y: 100,
      largeur: 600,
      hauteur: 800,
      fenetre: 0
    }
    const lignes = Array.from({ length: 60 }, (_, i): ElementArbre => ({
      ref: `@l1:e${32 + i}`,
      type: 'Text',
      nom: `Scénario ${i} : ouvrir la procédure et vérifier son état`,
      actif: true,
      x: 10,
      y: 110 + i * 12,
      largeur: 500,
      hauteur: 10,
      fenetre: 0
    }))
    return [...boutons, liste, ...lignes]
  }
  it('écran chargé : le texte cite la zone où lire le reste, avec son repère, et tient la limite', () => {
    const t = texteArbre(
      {
        ok: true,
        arbre: { lecture: 'l1', fenetres: ['Pilote'], total: 91, omis: 0, elements: ecranCharge() }
      },
      { x: 0, y: 0 }
    )
    expect(t.length).toBeLessThanOrEqual(ARBRE_TEXTE_MAX)
    expect(t).toContain('Zones où lire le reste — bureau_cache_observer avec `racine`')
    const zone = /^List @l1:e31 \(300,500\) : (\d+) non montré\(s\) sur 60$/m.exec(t)
    expect(zone).not.toBeNull()
    const fin =
      /… (\d+) élément\(s\) non montré\(s\) : (\d+) au-delà de la limite de ce texte\. Lis une zone ci-dessus\./.exec(
        t
      )
    expect(fin).not.toBeNull()
    expect(fin![1]).toBe(fin![2])
    expect(Number(zone![1])).toBe(Number(fin![1]))
    // La liste sans nom n'a pas sa propre ligne : seule, elle ne dit rien.
    expect(t).not.toMatch(/^List @l1:e31 \(300,500\)$/m)
  })
  it('zones : la plus petite à compte égal, une zone qui ne cache rien de plus est tue', () => {
    const els = ecranCharge()
    const page: ElementArbre = {
      ref: '@l1:e99',
      type: 'Pane',
      nom: 'Page',
      actif: true,
      x: 0,
      y: 0,
      largeur: 1400,
      hauteur: 1000,
      fenetre: 0
    }
    const caches = els.filter((e) => e.type === 'Text').slice(20)
    const z = zonesARelire([page, ...els], caches)
    expect(z.map((x) => x.zone.ref)).toEqual(['@l1:e31'])
    expect(z[0]).toMatchObject({ caches: 40, total: 60 })
    // Un bouton caché en plus, hors de la liste : la page cache davantage, elle passe en tête.
    const plus = zonesARelire([page, ...els], [...caches, els[0]])
    expect(plus.map((x) => x.zone.ref)).toEqual(['@l1:e99', '@l1:e31'])
  })
  it('lecture d’une zone : l’en-tête la nomme ; zone vide = la phrase le dit', () => {
    const racine: ElementArbre = { ref: '@l1:e31', type: 'List', actif: true, fenetre: 0 }
    const t = texteArbre(
      {
        ok: true,
        arbre: {
          lecture: 'm2',
          racine,
          fenetres: ['Pilote'],
          total: 1,
          omis: 0,
          elements: [{ ...ecranCharge()[31], ref: '@m2:e1' }]
        }
      },
      undefined
    )
    expect(t.split('\n')[0]).toMatch(/^Zone List @l1:e31 lue seule : .*lecture m2/)
    expect(t).toContain('Text « Scénario 0 : ouvrir la procédure et vérifier son état » @m2:e1')
    expect(
      texteArbre(
        { ok: true, arbre: { racine, fenetres: [], total: 0, omis: 0, elements: [] } },
        undefined
      )
    ).toMatch(/^Zone List @l1:e31 : aucun élément lisible dedans/)
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
  it('zone demandée : racine et origine partent à la lecture ; refus rendu avec son code', async () => {
    const recues: unknown[] = []
    const outils = (rendu: LectureArbre): ReturnType<typeof outilsBureauCacheDuChat> =>
      outilsBureauCacheDuChat({
        capteur: () => capteurFixe({ x: 7, y: 57 }),
        lireArbre: async (_id, options) => (recues.push(options), rendu),
        agir: async () => ({ ok: true })
      })
    await outils(arbre([SELECTIONNER])).observer('b1', ' @k3f9a2:e57 ')
    await outils(arbre([SELECTIONNER])).observer('b1')
    expect(recues).toEqual([{ racine: '@k3f9a2:e57', origine: { x: 7, y: 57 } }, undefined])
    const r = await outils({
      ok: false,
      code: 'PERIME',
      message: "Repere @k3f9a2:e57 : lecture 'k3f9a2' inconnue."
    }).observer('b1', '@k3f9a2:e57')
    expect(r).toMatchObject({ statut: 'ok', dataUrl: IMAGE.dataUrl })
    expect(r.arbre).toBe(
      "Zone « @k3f9a2:e57 » non lue [PERIME] : Repere @k3f9a2:e57 : lecture 'k3f9a2' inconnue."
    )
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
