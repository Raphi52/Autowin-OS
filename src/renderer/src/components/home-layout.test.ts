import { describe, expect, it } from 'vitest'
import {
  clampWidgetBox,
  defaultHomeLayout,
  fitLayoutToViewport,
  layoutFitsViewport,
  reconcileLayout,
  MIN_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  moveWidgetBox,
  parseHomeLayout,
  replaceWidget,
  resizeWidgetBox,
  scatterHomeLayout,
  serializeHomeLayout,
  type HomeWidgetBox
} from './home-layout'

const VIEW = { width: 1440, height: 900 }
const box = (over: Partial<HomeWidgetBox> = {}): HomeWidgetBox => ({
  id: 'agenda',
  x: 400,
  y: 200,
  w: 330,
  h: 258,
  z: -30,
  ...over
})

describe('pose libre des tuiles', () => {
  it('deplace exactement du geste demande, sans accroche', () => {
    // Des valeurs volontairement NON rondes : une grille les arrondirait, et c'est ce qui a ete rejete.
    expect(moveWidgetBox(box(), 37, -13, VIEW)).toMatchObject({ x: 437, y: 187 })
    expect(moveWidgetBox(box(), 1, 1, VIEW)).toMatchObject({ x: 401, y: 201 })
  })

  it('garde toujours une part de la tuile attrapable dans la fenetre', () => {
    const perdueADroite = moveWidgetBox(box(), 5000, 0, VIEW)
    expect(perdueADroite.x).toBeLessThan(VIEW.width)
    expect(perdueADroite.x + perdueADroite.w).toBeGreaterThan(VIEW.width)

    const perdueAGauche = moveWidgetBox(box(), -5000, 0, VIEW)
    expect(perdueAGauche.x + perdueAGauche.w).toBeGreaterThan(0)

    // Vers le haut, la borne est FRANCHE a 0 : une tuile dont l'etiquette passe au-dessus du bord
    // n'a plus de poignee visible du tout.
    expect(moveWidgetBox(box(), 0, -5000, VIEW).y).toBe(0)
    expect(moveWidgetBox(box(), 0, 5000, VIEW).y).toBeLessThan(VIEW.height)
  })

  it('ne recolle jamais une tuile posee volontairement en bord d ecran', () => {
    const enBord = moveWidgetBox(box({ x: 1200 }), 60, 0, VIEW)
    expect(enBord.x).toBe(1260)
  })
})

describe('redimensionnement', () => {
  it('agrandit vers l est et le sud sans bouger l origine', () => {
    const grandi = resizeWidgetBox(box(), 'se', 80, 60, VIEW)
    expect(grandi).toMatchObject({ x: 400, y: 200, w: 410, h: 318 })
  })

  it('deplace l origine quand on tire un bord ouest ou nord', () => {
    const ouest = resizeWidgetBox(box(), 'w', -50, 0, VIEW)
    expect(ouest).toMatchObject({ x: 350, w: 380 })
    // Le bord EST ne doit pas avoir bouge : x + w reste constant.
    expect(ouest.x + ouest.w).toBe(400 + 330)

    const nord = resizeWidgetBox(box(), 'n', 0, -40, VIEW)
    expect(nord).toMatchObject({ y: 160, h: 298 })
    expect(nord.y + nord.h).toBe(200 + 258)
  })

  it('refuse de descendre sous la taille minimale', () => {
    const ecrasee = resizeWidgetBox(box(), 'se', -1000, -1000, VIEW)
    expect(ecrasee.w).toBe(MIN_WIDGET_WIDTH)
    expect(ecrasee.h).toBe(MIN_WIDGET_HEIGHT)
  })

  it('bloque l origine au minimum quand on ecrase par le bord ouest', () => {
    const ecrasee = resizeWidgetBox(box(), 'w', 1000, 0, VIEW)
    expect(ecrasee.w).toBe(MIN_WIDGET_WIDTH)
    // Le bord est reste en place, donc l'origine s'est arretee juste a sa gauche.
    expect(ecrasee.x + ecrasee.w).toBe(400 + 330)
  })
})

describe('persistance de la disposition', () => {
  it('relit a l identique une disposition posee', () => {
    const pose = replaceWidget(defaultHomeLayout(), box({ x: 137, y: 641, w: 421, h: 233 }))
    expect(parseHomeLayout(JSON.parse(serializeHomeLayout(pose)))).toEqual(pose)
  })

  it('ne range pas les tuiles a la relecture', () => {
    // Une tuile deliberement posee en bas ne doit PAS remonter : c'est la promesse du deplacable.
    const relu = parseHomeLayout([{ id: 'mails', x: 12, y: 733, w: 300, h: 200, z: 0 }])
    expect(relu.find((entry) => entry.id === 'mails')).toMatchObject({ x: 12, y: 733 })
  })

  it('rend son defaut a un widget absent de l enregistrement', () => {
    const relu = parseHomeLayout([{ id: 'mails', x: 10, y: 20, w: 300, h: 200, z: 0 }])
    expect(relu.map((entry) => entry.id)).toEqual(
      defaultHomeLayout().map((entry) => entry.id)
    )
    expect(relu.find((entry) => entry.id === 'hublot')).toEqual(
      defaultHomeLayout().find((entry) => entry.id === 'hublot')
    )
  })

  it('accepte un enregistrement anterieur sans profondeur', () => {
    const relu = parseHomeLayout([{ id: 'agenda', x: 10, y: 20, w: 300, h: 200 }])
    expect(relu.find((entry) => entry.id === 'agenda')).toMatchObject({ x: 10, y: 20, z: 0 })
  })

  it('retombe sur le defaut devant un enregistrement corrompu', () => {
    expect(parseHomeLayout('nawak')).toEqual(defaultHomeLayout())
    expect(parseHomeLayout(null)).toEqual(defaultHomeLayout())
    expect(parseHomeLayout([{ id: 'inconnu', x: 0, y: 0, w: 300, h: 200 }])).toEqual(
      defaultHomeLayout()
    )
    expect(parseHomeLayout([{ id: 'mails', x: 'a', y: 0, w: 300, h: 200 }])).toEqual(
      defaultHomeLayout()
    )
    expect(parseHomeLayout([{ id: 'mails', x: NaN, y: 0, w: 300, h: 200 }])).toEqual(
      defaultHomeLayout()
    )
  })

  it('remonte une taille enregistree trop petite au minimum', () => {
    const relu = parseHomeLayout([{ id: 'mails', x: 10, y: 20, w: 4, h: 4, z: 0 }])
    expect(relu.find((entry) => entry.id === 'mails')).toMatchObject({
      w: MIN_WIDGET_WIDTH,
      h: MIN_WIDGET_HEIGHT
    })
  })
})

describe('disposition par defaut et dispersion', () => {
  it('livre les cinq widgets dans la fenetre', () => {
    const layout = defaultHomeLayout()
    expect(layout).toHaveLength(5)
    for (const entry of layout) {
      expect(clampWidgetBox(entry, VIEW)).toEqual(entry)
    }
  })

  it('disperse en gardant chaque tuile attrapable', () => {
    let seed = 0
    const disperse = scatterHomeLayout(defaultHomeLayout(), VIEW, () => {
      seed += 0.37
      return seed % 1
    })
    for (const entry of disperse) {
      expect(entry.x + entry.w).toBeGreaterThan(0)
      expect(entry.x).toBeLessThan(VIEW.width)
      expect(entry.y).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('la disposition suit la surface qui la porte', () => {
  // Defaut mesure le 2026-08-21 dans l'app : avec des positions en pixels absolus calibrees sur
  // 1440, une fenetre de 491 px mettait QUATRE tuiles sur cinq entierement hors champ.
  const surfaces = [
    { nom: 'large', width: 1440, height: 900 },
    { nom: 'moyenne', width: 900, height: 800 },
    { nom: 'etroite (fenetre reelle mesuree)', width: 405, height: 956 },
    { nom: 'minuscule', width: 260, height: 420 }
  ]

  it.each(surfaces)('garde les cinq tuiles atteignables sur une surface $nom', (surface) => {
    const layout = defaultHomeLayout(surface)
    expect(layout).toHaveLength(5)
    for (const entry of layout) {
      // Aucune tuile ne commence apres le bord droit, ni ne finit avant le bord gauche.
      expect(entry.x).toBeLessThan(surface.width)
      expect(entry.x + entry.w).toBeGreaterThan(0)
      expect(entry.y).toBeGreaterThanOrEqual(0)
      expect(entry.y).toBeLessThan(surface.height)
      expect(entry.w).toBeGreaterThanOrEqual(MIN_WIDGET_WIDTH)
      expect(entry.h).toBeGreaterThanOrEqual(MIN_WIDGET_HEIGHT)
    }
  })

  it('empile en une seule colonne quand trois colonnes ne tiennent pas', () => {
    const layout = defaultHomeLayout({ width: 405, height: 956 })
    const colonnes = new Set(layout.map((entry) => entry.x))
    expect(colonnes.size).toBe(1)
  })

  it('deploie trois colonnes quand la place existe', () => {
    const layout = defaultHomeLayout({ width: 1440, height: 900 })
    expect(new Set(layout.map((entry) => entry.x)).size).toBe(3)
  })

  it('recadre une disposition enregistree sur un ecran plus large', () => {
    const large = defaultHomeLayout({ width: 1440, height: 900 })
    const etroit = { width: 405, height: 956 }
    // Avant correctif, ce recadrage n'existait pas et ces tuiles restaient inatteignables.
    const horsChampAvant = large.filter((entry) => entry.x > etroit.width).length
    expect(horsChampAvant).toBeGreaterThan(0)

    const recadre = fitLayoutToViewport(large, etroit)
    for (const entry of recadre) {
      expect(entry.x).toBeLessThan(etroit.width)
      expect(entry.x + entry.w).toBeGreaterThan(0)
      expect(entry.w).toBeLessThanOrEqual(etroit.width)
    }
  })

  it('ne touche pas une tuile deja entierement visible', () => {
    const dedans = [
      { id: 'mails' as const, x: 40, y: 120, w: 300, h: 200, z: 0 },
      { id: 'agenda' as const, x: 400, y: 120, w: 300, h: 200, z: -30 }
    ]
    expect(fitLayoutToViewport(dedans, VIEW)).toEqual(dedans)
  })
})

describe('la disposition d origine ne se chevauche pas', () => {
  // Defaut mesure le 2026-08-21 sur capture de l'app : les hauteurs etaient exprimees en fractions
  // LIBRES d'une grille a deux lignes, et la tuile des remontees d'agents debordait sur le hublot.
  // Le chevauchement est acceptable APRES un geste de l'utilisateur ; il ne l'est pas a l'ouverture.
  const chevauchements = (layout: ReturnType<typeof defaultHomeLayout>): string[] => {
    const clashes: string[] = []
    for (let i = 0; i < layout.length; i += 1) {
      for (let j = i + 1; j < layout.length; j += 1) {
        const a = layout[i]
        const b = layout[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          clashes.push(`${a.id}/${b.id}`)
        }
      }
    }
    return clashes
  }

  it.each([
    { nom: 'trois colonnes', width: 1440, height: 900 },
    { nom: 'trois colonnes serrees', width: 1000, height: 700 },
    { nom: 'deux colonnes', width: 700, height: 800 }
  ])('n a aucun chevauchement en $nom', (surface) => {
    expect(chevauchements(defaultHomeLayout(surface))).toEqual([])
  })

  it('laisse une bande de decor visible sur les cotes', () => {
    // Sans plafond de largeur, les tuiles s etiraient jusqu aux bords et masquaient le decor 3D en
    // entier : mesure du 2026-08-21 sur capture de l app.
    const surface = { width: 1600, height: 900 }
    const layout = defaultHomeLayout(surface)
    const gauche = Math.min(...layout.map((entry) => entry.x))
    const droite = Math.max(...layout.map((entry) => entry.x + entry.w))
    expect(gauche).toBeGreaterThan(60)
    expect(surface.width - droite).toBeGreaterThan(60)
  })

  it('ne laisse aucune tuile sous la plaque de titre', () => {
    // La plaque de titre et les boutons occupent le haut de la surface : une etiquette de tuile
    // dessous serait illisible, ce qui etait le cas a l ouverture.
    for (const entry of defaultHomeLayout({ width: 1440, height: 900 })) {
      expect(entry.y).toBeGreaterThanOrEqual(130)
    }
  })

  it('remplit la hauteur utile sans deborder', () => {
    const surface = { width: 1440, height: 900 }
    const layout = defaultHomeLayout(surface)
    for (const entry of layout) {
      expect(entry.y + entry.h).toBeLessThanOrEqual(surface.height)
    }
    // La colonne la plus haute remplit la hauteur UTILE et s arrete sur la bande de decor : ni
    // gaspiller un tiers de l ecran, ni recouvrir la bande qui rend le decor 3D visible. Les deux
    // bornes sont serrees a dessein — l une seule laisserait passer la faute inverse.
    const bas = Math.max(...layout.map((entry) => entry.y + entry.h))
    expect(bas).toBeLessThanOrEqual(surface.height - 50)
    expect(bas).toBeGreaterThan(surface.height - 90)
  })
})

describe('une disposition d une autre surface n est pas une disposition de celle-ci', () => {
  // Defaut mesure le 2026-08-21 dans l app, fenetre de 491 px : la disposition en trois colonnes,
  // simplement RECADREE, empilait cinq tuiles de 376 px sur une surface de 405 — 155 % de la surface
  // couverte, tuiles superposees, decor invisible derriere. Recadrer corrige la position, pas
  // l arrangement.
  const ETROIT = { width: 405, height: 956 }

  it('detecte qu un arrangement large ne tient pas sur une surface etroite', () => {
    const large = defaultHomeLayout({ width: 1440, height: 900 })
    expect(layoutFitsViewport(fitLayoutToViewport(large, ETROIT), ETROIT)).toBe(false)
  })

  it('accepte un arrangement calcule pour la surface', () => {
    expect(layoutFitsViewport(defaultHomeLayout(ETROIT), ETROIT)).toBe(true)
    const large = { width: 1440, height: 900 }
    expect(layoutFitsViewport(defaultHomeLayout(large), large)).toBe(true)
  })

  it('reprend la disposition d origine quand l arrangement enregistre ne tient pas', () => {
    const large = defaultHomeLayout({ width: 1440, height: 900 })
    const reconcilie = reconcileLayout(large, ETROIT)
    expect(reconcilie).toEqual(defaultHomeLayout(ETROIT))
    const couvert = reconcilie.reduce((total, box) => total + box.w * box.h, 0)
    expect(couvert).toBeLessThanOrEqual(ETROIT.width * ETROIT.height * 1.12)
  })

  it('CONSERVE une disposition posee a la main quand elle tient encore', () => {
    // La contrepartie : on ne jette pas le travail de l utilisateur des qu il redimensionne un peu.
    const surface = { width: 1440, height: 900 }
    const pose = replaceWidget(defaultHomeLayout(surface), {
      id: 'agenda',
      x: 137,
      y: 641,
      w: 300,
      h: 180,
      z: -30
    })
    expect(reconcileLayout(pose, surface)).toEqual(fitLayoutToViewport(pose, surface))
  })
})

describe('le haut reserve est mesure, pas suppose', () => {
  // Defaut mesure le 2026-08-21 dans la fenetre reelle (491 px) : l en-tete se replie sur deux
  // rangees quand la fenetre est etroite, et une constante de 142 px laissait les tuiles passer
  // dessous. La hauteur reelle de l en-tete est donc un PARAMETRE.
  it('descend les tuiles sous un en-tete plus haut', () => {
    const bas = defaultHomeLayout({ width: 405, height: 956, top: 260 })
    for (const entry of bas) expect(entry.y).toBeGreaterThanOrEqual(260)
  })

  it('remonte les tuiles quand l en-tete est court', () => {
    const haut = defaultHomeLayout({ width: 1440, height: 900, top: 90 })
    expect(Math.min(...haut.map((entry) => entry.y))).toBe(90)
  })

  it('refuse de laisser glisser une tuile sous l en-tete', () => {
    const remontee = moveWidgetBox(box({ y: 400 }), 0, -1000, { ...VIEW, top: 200 })
    expect(remontee.y).toBe(200)
  })

  it('garde la hauteur utile coherente quand l en-tete grandit', () => {
    const surface = { width: 405, height: 956 }
    const court = defaultHomeLayout({ ...surface, top: 120 })
    const long = defaultHomeLayout({ ...surface, top: 260 })
    const hauteur = (layout: typeof court): number =>
      Math.max(...layout.map((entry) => entry.y + entry.h))
    // Un en-tete plus haut ne doit pas faire deborder la pile en bas.
    expect(hauteur(long)).toBeLessThanOrEqual(surface.height)
    expect(hauteur(court)).toBeLessThanOrEqual(surface.height)
  })
})
