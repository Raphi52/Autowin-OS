import { describe, expect, it } from 'vitest'
import {
  canoniserReplis,
  estReplie,
  GROUPE_DIVERS,
  GROUPE_KAIZEN,
  groupeDe,
  groupesVisibles,
  grouperConversations,
  nomDeDossier,
  ordonnerGroupes
} from './conversation-groups'

/**
 * Ce que ces tests protègent : que la liste du Chat cesse d'être un mur plat, SANS qu'aucun modèle
 * n'intervienne — la contrainte explicite de la demande — et que les analyses Auto-Kaizen ne
 * reviennent jamais s'intercaler au milieu des conversations de l'utilisateur.
 */

const conv = (id: string, extra: Record<string, unknown> = {}): { id: string } & typeof extra => ({
  id,
  ...extra
})

describe('à quel groupe appartient une conversation', () => {
  it('sans dossier, elle va dans « Divers » — jamais dans un dossier deviné', () => {
    expect(groupeDe(conv('a'))).toMatchObject({ key: GROUPE_DIVERS, kind: 'divers' })
  })

  it('avec un dossier, le groupe EST le dossier', () => {
    expect(groupeDe(conv('a', { projectPath: 'C:\\Amitel\\Autowin OS' }))).toMatchObject({
      key: 'C:\\Amitel\\Autowin OS',
      label: 'Autowin OS',
      kind: 'dossier'
    })
  })

  it('une conversation Auto-Kaizen part chez les Auto-Kaizen MÊME si elle porte un dossier', () => {
    // La ranger sous son projet la remettrait exactement là où elle dérange : au milieu du travail.
    const c = conv('a', { projectPath: 'C:\\Amitel\\Autowin OS', autoKaizen: { sourceId: 'x' } })
    expect(groupeDe(c)).toMatchObject({ key: GROUPE_KAIZEN, kind: 'kaizen' })
  })

  it('un dossier vide ou fait d’espaces ne crée pas un groupe fantôme', () => {
    expect(groupeDe(conv('a', { projectPath: '   ' })).key).toBe(GROUPE_DIVERS)
    expect(groupeDe(conv('b', { projectPath: '' })).key).toBe(GROUPE_DIVERS)
  })
})

describe('le nom lisible d’un dossier', () => {
  it('garde le dernier segment, pas le chemin entier qui ferait déborder la barre', () => {
    expect(nomDeDossier('C:\\Amitel\\Autowin OS')).toBe('Autowin OS')
    expect(nomDeDossier('/home/raph/projets/rig')).toBe('rig')
  })

  it('tolère un séparateur final', () => {
    expect(nomDeDossier('C:\\Amitel\\Autowin OS\\')).toBe('Autowin OS')
  })

  it('deux dossiers homonymes restent DEUX groupes — la clé est le chemin, pas le libellé', () => {
    const groupes = grouperConversations([
      conv('a', { projectPath: 'C:\\un\\rig' }),
      conv('b', { projectPath: 'D:\\autre\\rig' })
    ])
    expect(groupes).toHaveLength(2)
    expect(groupes.map((g) => g.label)).toEqual(['rig', 'rig'])
  })

  it('un séparateur final ne duplique pas la catégorie du même dossier', () => {
    const groupes = grouperConversations([
      conv('a', { projectPath: 'C:\\Clients' }),
      conv('b', { projectPath: 'C:\\Clients\\' })
    ])

    expect(groupes).toHaveLength(1)
    expect(groupes[0].items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('l’ordre des groupes', () => {
  it('un dossier enfant devient une sous-catégorie du dossier parent présent', () => {
    const groupes = grouperConversations([
      conv('parent', { projectPath: 'C:\\Clients' }),
      conv('enfant', { projectPath: 'C:\\Clients\\Amitel' }),
      conv('autre', { projectPath: 'D:\\Projets' })
    ])

    expect(
      groupes.map((g) => ({ label: g.label, depth: g.depth, parentKey: g.parentKey }))
    ).toEqual([
      { label: 'Clients', depth: 0, parentKey: undefined },
      { label: 'Amitel', depth: 1, parentKey: 'C:\\Clients' },
      { label: 'Projets', depth: 0, parentKey: undefined }
    ])
  })

  it('masque une sous-catégorie quand sa catégorie parente est repliée', () => {
    const groupes = grouperConversations([
      conv('parent', { projectPath: 'C:\\Clients' }),
      conv('enfant', { projectPath: 'C:\\Clients\\Amitel' }),
      conv('autre', { projectPath: 'D:\\Projets' })
    ])

    // Entrée discriminante : si `C:\Clients` n'est pas marqué replié, Amitel doit rester visible.
    expect(groupesVisibles(groupes, { 'C:\\Clients': true }).map((g) => g.key)).toEqual([
      'C:\\Clients',
      'D:\\Projets'
    ])
  })

  it('les projets d’abord, « Divers » ensuite, « Auto-kaizen » en DERNIER', () => {
    // Le bruit descend : c'est la demande. S'il remontait, la séparation ne servirait à rien.
    const groupes = grouperConversations([
      conv('k', { autoKaizen: { sourceId: 'x' } }),
      conv('d'),
      conv('p', { projectPath: 'C:\\Amitel\\Autowin OS' })
    ])
    expect(groupes.map((g) => g.kind)).toEqual(['dossier', 'divers', 'kaizen'])
  })

  it('les projets sont alphabétiques, insensibles à la casse et aux accents', () => {
    const groupes = grouperConversations([
      conv('a', { projectPath: 'C:\\x\\zebre' }),
      conv('b', { projectPath: 'C:\\x\\Élan' }),
      conv('c', { projectPath: 'C:\\x\\alpha' })
    ])
    expect(groupes.map((g) => g.label)).toEqual(['alpha', 'Élan', 'zebre'])
  })

  it('ne RETRIE pas les conversations dans un groupe : l’ordre reçu est déjà le bon', () => {
    // Il vient de la recherche/pertinence en amont ; le refaire ici écraserait ce classement.
    const groupes = grouperConversations([
      conv('troisieme', { projectPath: 'C:\\x\\p' }),
      conv('premier', { projectPath: 'C:\\x\\p' })
    ])
    expect(groupes[0].items.map((i) => i.id)).toEqual(['troisieme', 'premier'])
  })

  it('une liste vide ne produit aucun groupe, pas des groupes vides', () => {
    expect(grouperConversations([])).toEqual([])
  })
})

describe('l’état replié', () => {
  it('« Auto-kaizen » est replié par DÉFAUT — sans ça, il faudrait le fermer à chaque fois', () => {
    expect(estReplie(GROUPE_KAIZEN, {})).toBe(true)
  })

  it('tous les autres sont ouverts par défaut', () => {
    // Un groupe fermé qu'on n'a pas fermé soi-même cache des conversations sans le dire.
    expect(estReplie(GROUPE_DIVERS, {})).toBe(false)
    expect(estReplie('C:\\Amitel\\Autowin OS', {})).toBe(false)
  })

  it('un choix explicite gagne toujours sur le défaut, dans les DEUX sens', () => {
    expect(estReplie(GROUPE_KAIZEN, { [GROUPE_KAIZEN]: false })).toBe(false)
    expect(estReplie(GROUPE_DIVERS, { [GROUPE_DIVERS]: true })).toBe(true)
  })
})

describe('canoniserReplis — l’état plié survit à la canonisation des chemins', () => {
  it('un groupe plié sous `C:/Clients` est encore plié sous `C:\\Clients`', () => {
    // L'utilisateur avait replié ce dossier AVANT que l'hydratation ne canonise les chemins.
    const stocke = { 'C:/Clients': true, [GROUPE_KAIZEN]: false }
    const relu = canoniserReplis(stocke)

    // Sans canonisation à la lecture, la clé ne correspond plus au groupe : le dossier se déplie.
    expect(estReplie('C:\\Clients', stocke)).toBe(false)
    expect(estReplie('C:\\Clients', relu)).toBe(true)
    // Les clés sentinelles traversent intactes, choix explicite inclus.
    expect(estReplie(GROUPE_KAIZEN, relu)).toBe(false)
  })

  it('deux dossiers homonymes de lecteurs différents gardent des états distincts', () => {
    const relu = canoniserReplis({ 'C:/Clients': true, 'd:/Clients/': false })
    expect(estReplie('C:\\Clients', relu)).toBe(true)
    expect(estReplie('D:\\Clients', relu)).toBe(false)
  })
})

/**
 * Le tri par date de la barre laterale a d'abord ete un `.sort()` a plat applique DANS la vue, ce
 * qui ecrasait les deux invariants testes plus haut. Ces tests-ci tiennent la composition : la date
 * arbitre entre freres, jamais entre rangs ni entre un parent et son enfant.
 *
 * Les chemins sont ecrits avec `/` : la parente accepte les deux separateurs (`[\/]`), et cela
 * garde le test lisible sans une foret d'echappements.
 */
describe('ordre des groupes quand la date entre en jeu', () => {
  const PARENT = 'C:/Clients'
  const ENFANT = 'C:/Clients/Amitel'
  const AUTRE = 'D:/Projets'
  const dates: Record<string, number> = {
    [PARENT]: 100,
    [ENFANT]: 900,
    [AUTRE]: 500,
    [GROUPE_DIVERS]: 950,
    [GROUPE_KAIZEN]: 999
  }
  const dateDe = (groupe: { key: string }): number => dates[groupe.key] ?? 0
  const groupes = (): ReturnType<typeof grouperConversations> =>
    grouperConversations([
      conv('k', { autoKaizen: { sourceId: 'x' } }),
      conv('d'),
      conv('parent', { projectPath: PARENT }),
      conv('enfant', { projectPath: ENFANT }),
      conv('autre', { projectPath: AUTRE })
    ])

  it('la filiation est bien etablie sur ce jeu (sinon les tests suivants ne prouvent rien)', () => {
    // Garde-fou : un `parentKey` absent rendrait la hierarchie triviale et les tests complaisants.
    expect(groupes().find((g) => g.key === ENFANT)?.parentKey).toBe(PARENT)
  })

  it('« Auto-kaizen » reste DERNIER meme en portant la conversation la plus recente', () => {
    // Entree discriminante : sa date (999) est la plus haute de toutes.
    const ordonnes = ordonnerGroupes(groupes(), dateDe, 'desc')
    expect(ordonnes.at(-1)?.kind).toBe('kaizen')
    expect(ordonnes.at(-2)?.kind).toBe('divers')
    expect(ordonnes.map((g) => g.kind).slice(0, 3)).toEqual(['dossier', 'dossier', 'dossier'])
  })

  it('un sous-dossier RECENT reste sous son parent, jamais au-dessus', () => {
    // ENFANT (900) est plus recent que son parent (100) ET que AUTRE (500) : a plat, il passerait
    // premier, indente comme s'il etait niche sous un groupe qui n'est pas le sien.
    const cles = ordonnerGroupes(groupes(), dateDe, 'desc').map((g) => g.key)
    expect(cles.indexOf(PARENT)).toBeLessThan(cles.indexOf(ENFANT))
    expect(cles.slice(0, 3)).toEqual([AUTRE, PARENT, ENFANT])
  })

  it('la date arbitre bien entre freres, dans les deux sens', () => {
    const desc = ordonnerGroupes(groupes(), dateDe, 'desc').map((g) => g.key)
    const asc = ordonnerGroupes(groupes(), dateDe, 'asc').map((g) => g.key)
    expect(desc.indexOf(AUTRE)).toBeLessThan(desc.indexOf(PARENT))
    expect(asc.indexOf(PARENT)).toBeLessThan(asc.indexOf(AUTRE))
    // L'inversion ne casse ni le rang ni la filiation.
    expect(asc.at(-1)).toBe(GROUPE_KAIZEN)
    expect(asc.indexOf(PARENT)).toBeLessThan(asc.indexOf(ENFANT))
  })

  it('ne perd AUCUN groupe, et reste stable a date egale', () => {
    const source = groupes()
    const ordonnes = ordonnerGroupes(source, () => 42, 'desc')
    expect(ordonnes).toHaveLength(source.length)
    expect(new Set(ordonnes.map((g) => g.key))).toEqual(new Set(source.map((g) => g.key)))
    expect(ordonnes.map((g) => g.key)).toEqual(
      ordonnerGroupes(source, () => 42, 'desc').map((g) => g.key)
    )
  })

  it('un groupe dont le parent est REPLIE (donc absent) reste rendu', () => {
    // `groupesVisibles` retire les descendants d'un groupe replie ; si l'un arrive quand meme sans
    // son parent, le perdre serait pire que le rendre a plat.
    const orphelin = grouperConversations([conv('enfant', { projectPath: ENFANT })])
    expect(ordonnerGroupes(orphelin, dateDe, 'desc').map((g) => g.key)).toEqual([ENFANT])
  })
})
