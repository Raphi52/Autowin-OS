import { describe, expect, it } from 'vitest'
import {
  estReplie,
  GROUPE_DIVERS,
  GROUPE_KAIZEN,
  groupeDe,
  grouperConversations,
  nomDeDossier
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
      kind: 'projet'
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
})

describe('l’ordre des groupes', () => {
  it('les projets d’abord, « Divers » ensuite, « Auto-kaizen » en DERNIER', () => {
    // Le bruit descend : c'est la demande. S'il remontait, la séparation ne servirait à rien.
    const groupes = grouperConversations([
      conv('k', { autoKaizen: { sourceId: 'x' } }),
      conv('d'),
      conv('p', { projectPath: 'C:\\Amitel\\Autowin OS' })
    ])
    expect(groupes.map((g) => g.kind)).toEqual(['projet', 'divers', 'kaizen'])
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
