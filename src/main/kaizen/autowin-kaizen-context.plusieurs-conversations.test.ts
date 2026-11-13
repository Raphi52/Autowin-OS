import { describe, expect, it } from 'vitest'
import {
  avisNumerosEcartes,
  avisNumerosNus,
  buildAutowinKaizenTaskPlusieurs,
  conversationsNommees,
  exigenceAppuiSourcesNeuves,
  type AutowinKaizenEvidence
} from './autowin-kaizen-context'
import { tacheAvecLectureRetenue } from '../chat/deux-lectures'
import type { Conversation } from '../store/conversations'
import type { AppCommandBus } from '../commands/commands'
import { composerTacheDOrchestration } from '../commands/orchestration-tache'

/*
 * Un /kaizen qui nomme plusieurs conversations construit un dossier PAR conversation, réunis dans une
 * seule tâche. Il n'y a qu'un objet JSON entre les deux marqueurs : le contrôle hors modèle
 * (exigenceAppuiSourcesNeuves) y lit les sources de toutes les conversations. Cinq conversations au
 * plus ; les suivantes sont nommées dans la tâche. Un nombre nu n'est une conversation que s'il a au
 * moins trois chiffres.
 */

const DEBUT = '=== DOSSIER DE PREUVE AUTOWIN OS ==='
const FIN = '=== FIN DU DOSSIER ==='

const fil = (id: string, ...contenus: string[]): Conversation =>
  ({
    id,
    title: `titre de ${id}`,
    provider: 'claude',
    messages: contenus.map((content) => ({ role: 'user', content, ts: 1000 }))
  }) as Conversation

const preuve = (
  conversation: Conversation,
  extra: Partial<AutowinKaizenEvidence> = {}
): AutowinKaizenEvidence => ({
  conversation: {
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages.map((message) => ({
      role: 'user' as const,
      content: message.content,
      ts: 1000
    }))
  },
  activity: [],
  brainTraces: [],
  causalEvents: [],
  runs: [],
  promptCalls: [],
  turnEvents: [],
  saisies: [],
  ...extra
})

const appel = (turnId: string) => ({
  ts: '2026-11-08T08:00:00.000Z',
  turnId,
  iteration: 1,
  actor: 'build',
  provider: 'claude',
  boundary: 'appel',
  limitation: 'aucune',
  response: 'réponse'
})

function construire(
  tache: string,
  convs: Conversation[],
  collecter: (conversation: Conversation) => AutowinKaizenEvidence = (c) => preuve(c)
): string {
  return buildAutowinKaizenTaskPlusieurs({
    requestedTask: tache,
    tache,
    conversations: convs,
    obtenir: (id) => convs.find((c) => c.id === id),
    collecter
  })
}

/** Le seul objet JSON entre les marqueurs du dossier joint. */
function objetJoint(texte: string): Record<string, unknown> {
  const corps = texte.slice(texte.indexOf(DEBUT) + DEBUT.length, texte.lastIndexOf(FIN))
  return JSON.parse(corps) as Record<string, unknown>
}

/** Les dossiers joints : le seul objet JSON entre les marqueurs. */
function dossiersDe(texte: string): Array<{ conversation: { id: string } }> {
  return objetJoint(texte).dossiers as Array<{ conversation: { id: string } }>
}

/** Ce qui précède le dossier joint : la demande et les alertes. */
const entete = (texte: string): string => texte.slice(0, texte.indexOf(DEBUT))

describe('conversationsNommees — les conversations nommées d’une demande /kaizen', () => {
  it('lit chaque conversation nommée, dans l’ordre de la demande', () => {
    expect(
      conversationsNommees('/kaizen conv-1583 conv-1584 1591 le lien est cassé').retenues
    ).toEqual(['conv-1583', 'conv-1584', 'conv-1591'])
  })

  it('suit l’ordre écrit, « conv N » et nombres nus mêlés : le plafond écarte les dernières', () => {
    expect(conversationsNommees('/kaizen 1591 conv-1583 le lien').retenues).toEqual([
      'conv-1591',
      'conv-1583'
    ])
    const { retenues, ecartees } = conversationsNommees(
      '/kaizen 1581 1582 1583 1584 1585 conv-1586 le lien'
    )
    expect(retenues).toEqual(['conv-1581', 'conv-1582', 'conv-1583', 'conv-1584', 'conv-1585'])
    expect(ecartees).toEqual(['conv-1586'])
  })

  it('un nombre nu de deux chiffres ne désigne pas une conversation, un nombre de trois chiffres oui', () => {
    expect(conversationsNommees('/kaizen conv-1583 2 bugs')).toEqual({
      retenues: ['conv-1583'],
      ecartees: [],
      numerosNus: ['2'],
      numerosEcartes: []
    })
    expect(conversationsNommees('/kaizen 612 le lien').retenues).toEqual(['conv-612'])
    expect(conversationsNommees('/kaizen 61 le lien')).toEqual({
      retenues: [],
      ecartees: [],
      numerosNus: ['61'],
      numerosEcartes: []
    })
  })

  it('une mention « conv N » garde son numéro, même court', () => {
    expect(conversationsNommees('/kaizen conv 61 le lien').retenues).toEqual(['conv-61'])
  })

  it('une quantité suivie d’une unité ne désigne aucune conversation', () => {
    expect(conversationsNommees('/kaizen conv-1583 3 fois')).toEqual({
      retenues: ['conv-1583'],
      ecartees: [],
      numerosNus: [],
      numerosEcartes: []
    })
    expect(conversationsNommees('/kaizen 1263 lignes').retenues).toEqual([])
  })

  it('au plus cinq conversations retenues ; les suivantes sont écartées et nommées', () => {
    const tache =
      '/kaizen conv-1581 conv-1582 conv-1583 conv-1584 conv-1585 conv-1586 conv-1587 le lien'
    const { retenues, ecartees } = conversationsNommees(tache)
    expect(retenues).toEqual(['conv-1581', 'conv-1582', 'conv-1583', 'conv-1584', 'conv-1585'])
    expect(ecartees).toEqual(['conv-1586', 'conv-1587'])
  })

  it('une conversation nommée dans la lecture écartée ne compte pas', () => {
    const tache = tacheAvecLectureRetenue(
      '/kaizen conv-1583 le lien',
      'Corriger le lien.',
      'Auditer conv-1306 à la place.'
    )
    expect(conversationsNommees(tache).retenues).toEqual(['conv-1583'])
  })

  // fix-ok: cause mesurée — conversationsNommees lisait toute la phrase (matchAll sur MENTION_CONVERSATION) : chaque « conv N » de contexte devenait une cible.
  it('une mention « conv N » de la phrase, hors de la tête, ne vise aucune conversation de plus', () => {
    expect(conversationsNommees('/kaizen conv-1583 le lien, comme dans conv 150').retenues).toEqual(
      ['conv-1583']
    )
    expect(
      conversationsNommees('/kaizen conv-1583 conv-1584 le lien, comme dans conv 150').retenues
    ).toEqual(['conv-1583', 'conv-1584'])
  })

  it('sans mention en tête, la première mention de la phrase seule vise une conversation', () => {
    expect(conversationsNommees('/kaizen le lien de conv 150 et conv 151').retenues).toEqual([
      'conv-150'
    ])
    expect(conversationsNommees('/kaizen 1263 le lien de conv 150').retenues).toEqual(['conv-150'])
  })

  // fix-ok: cause mesurée — conversationsNommees (autowin-kaizen-context.ts:922-927) remplaçait la tête « 1263 » par la mention « conv 150 » sans rien dire : ni retenu, ni écarté, ni cité dans la tâche.
  it('un nombre nu de tête remplacé par la mention « conv N » de la phrase est nommé, non retenu', () => {
    expect(conversationsNommees('/kaizen 1263 le lien de conv 150')).toEqual({
      retenues: ['conv-150'],
      ecartees: [],
      numerosNus: [],
      numerosEcartes: ['1263']
    })
    expect(conversationsNommees('/kaizen 1263 conv 150').numerosEcartes).toEqual([])
    expect(conversationsNommees('/kaizen 12 conv 150').numerosEcartes).toEqual([])
  })

  it('le nombre remplacé se dit en une ligne, rien sans nombre remplacé', () => {
    expect(avisNumerosEcartes(['1263'])).toContain('« 1263 »')
    expect(avisNumerosEcartes([])).toBeUndefined()
  })

  it('une tête qui mêle un numéro nu et une mention « conv N » les vise toutes les deux', () => {
    expect(conversationsNommees('/kaizen 1263 conv 150').retenues).toEqual([
      'conv-1263',
      'conv-150'
    ])
  })

  it('sans conversation nommée, rien', () => {
    expect(conversationsNommees('/kaizen le lien est casse').retenues).toEqual([])
    expect(conversationsNommees('/frame conv-61').retenues).toEqual([])
  })

  it('les nombres nus écartés se disent en une ligne, rien sans nombre écarté', () => {
    expect(avisNumerosNus(['2'])).toContain('« 2 »')
    expect(avisNumerosNus([])).toBeUndefined()
  })
})

describe('buildAutowinKaizenTaskPlusieurs — un dossier par conversation nommée', () => {
  it('réunit un dossier par conversation dans une seule tâche', () => {
    const texte = construire('/kaizen conv-1583 conv-1584 1591 le lien est cassé', [
      fil('conv-1583', 'a'),
      fil('conv-1584', 'b'),
      fil('conv-1591', 'c')
    ])
    expect(texte.split(DEBUT).length - 1).toBe(1)
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual([
      'conv-1583',
      'conv-1584',
      'conv-1591'
    ])
  })

  it('cinq dossiers au plus ; les conversations écartées sont nommées dans la tâche', () => {
    const convs = [1581, 1582, 1583, 1584, 1585, 1586, 1587].map((n) => fil(`conv-${n}`, 'x'))
    const texte = construire(
      '/kaizen conv-1581 conv-1582 conv-1583 conv-1584 conv-1585 conv-1586 conv-1587 le lien',
      convs
    )
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual([
      'conv-1581',
      'conv-1582',
      'conv-1583',
      'conv-1584',
      'conv-1585'
    ])
    expect(entete(texte)).toContain('conv-1586')
    expect(entete(texte)).toContain('conv-1587')
  })

  it('le total reste sous le plafond global, même pour cinq conversations pleines', () => {
    const pleine = (id: string) => fil(id, ...Array.from({ length: 24 }, () => 'x'.repeat(700)))
    const convs = ['conv-1581', 'conv-1582', 'conv-1583', 'conv-1584', 'conv-1585'].map(pleine)
    const lourde = (conversation: Conversation) =>
      preuve(conversation, {
        runs: Array.from({ length: 4 }, (_, rang) => ({
          path: `RUN-${rang}.md`,
          content: 'r'.repeat(4000)
        }))
      })
    const texte = construire(
      '/kaizen conv-1581 conv-1582 conv-1583 conv-1584 conv-1585 le lien',
      convs,
      lourde
    )
    expect(texte.length).toBeLessThanOrEqual(28_000)
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual([
      'conv-1581',
      'conv-1582',
      'conv-1583',
      'conv-1584',
      'conv-1585'
    ])
  })

  it('une conversation nommée inconnue est dite, sans dossier', () => {
    const texte = construire('/kaizen conv-99999 conv-1583 le lien', [fil('conv-1583', 'a')])
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual(['conv-1583'])
    expect(entete(texte)).toContain('conv-99999')
    expect(entete(texte)).toMatch(/introuvable/i)
  })

  it('deux conversations nommées introuvables : aucun dossier, et la tâche les nomme toutes les deux', () => {
    const texte = construire('/kaizen conv-99999 conv-88888 le lien', [fil('conv-1583', 'a')])
    expect(texte).not.toContain(DEBUT)
    expect(texte).toContain('conv-99999')
    expect(texte).toContain('conv-88888')
    expect(texte).toContain('Aucun dossier de preuve')
  })

  it('une citation trouvée dans une autre conversation nommée redirige le dossier, et le dit', () => {
    const texte = construire(
      '/kaizen conv-1583 conv-1584 le lien : « le bouton ne répond pas au clic »',
      [fil('conv-1583', 'autre chose'), fil('conv-1584', 'le bouton ne répond pas au clic')]
    )
    // Les deux noms désignent la même conversation : elle n'apparaît qu'une fois.
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual(['conv-1584'])
    expect(entete(texte)).toContain('construit sur conv-1584')
  })

  it('un nombre nu écarté est écrit dans la tâche', () => {
    const texte = construire('/kaizen conv-1583 conv-1584 2 bugs le lien', [
      fil('conv-1583', 'a'),
      fil('conv-1584', 'b')
    ])
    expect(entete(texte)).toContain('« 2 »')
    expect(dossiersDe(texte).map((d) => d.conversation.id)).toEqual(['conv-1583', 'conv-1584'])
  })

  it('le contrôle hors modèle cite un identifiant venu de n’importe quelle conversation', () => {
    const texte = construire(
      '/kaizen conv-1583 conv-1584 le lien',
      [fil('conv-1583', 'a'), fil('conv-1584', 'b')],
      (conversation) =>
        preuve(conversation, {
          promptCalls: [
            appel(
              conversation.id === 'conv-1584'
                ? 'bbbbbbbb-2222-4333-8444-555555555555'
                : 'aaaaaaaa-1111-4222-8333-444444444444'
            )
          ]
        })
    )
    const verdict = exigenceAppuiSourcesNeuves(
      texte,
      'Correction : le tour bbbbbbbb montre la panne.'
    )
    expect(verdict.applicable).toBe(true)
    expect(verdict.identifiants).toEqual(
      expect.arrayContaining([
        'aaaaaaaa-1111-4222-8333-444444444444',
        'bbbbbbbb-2222-4333-8444-555555555555'
      ])
    )
    expect(verdict.cites).toEqual(['bbbbbbbb-2222-4333-8444-555555555555'])
    expect(verdict.manque).toBe(false)
    // Jumeau : une correction qui ne cite aucun identifiant du dossier est refusée.
    expect(exigenceAppuiSourcesNeuves(texte, 'Correction sans citation.').manque).toBe(true)
  })
})

// fix-ok: cause mesurée — la réunion des dossiers dans la tâche envoyée se fait dans composerTacheDOrchestration (src/main/commands/orchestration-tache.ts). Cette suite l'exécute, pour prouver ce que le texte seul ne prouve pas.
describe('composerTacheDOrchestration — la tâche envoyée réunit les dossiers', () => {
  const convs = [fil('conv-1583', 'a'), fil('conv-1584', 'b'), fil('conv-1591', 'c')]
  // Bus minimal : seules la lecture des conversations et le dossier de travail sont appelés ici.
  const bus = {
    os: {
      conversations: {
        get: (id: string) => convs.find((c) => c.id === id),
        listAvecMessages: () => convs,
        listAvecTexte: () => convs
      }
    },
    workspaceDuTour: ''
  } as unknown as AppCommandBus

  it('/kaizen à plusieurs conversations : un dossier par conversation, dans une seule tâche', () => {
    const { task } = composerTacheDOrchestration(
      bus,
      { task: '/kaizen conv-1583 conv-1584 1591 le lien est cassé' },
      'conv-1716',
      []
    )
    expect(task.split(DEBUT).length - 1).toBe(1)
    expect(dossiersDe(task).map((d) => d.conversation.id)).toEqual([
      'conv-1583',
      'conv-1584',
      'conv-1591'
    ])
  })

  it('une seule conversation nommée : un dossier, sans liste de dossiers', () => {
    const { task } = composerTacheDOrchestration(
      bus,
      { task: '/kaizen conv-1583 le lien est cassé' },
      'conv-1716',
      []
    )
    const joint = objetJoint(task)
    expect(joint.dossiers).toBeUndefined()
    expect((joint.conversation as { id: string }).id).toBe('conv-1583')
  })

  it('une mention de contexte dans la phrase ne fait pas un /kaizen à plusieurs conversations', () => {
    const { task } = composerTacheDOrchestration(
      bus,
      { task: '/kaizen conv-1583 le lien est cassé, comme dans conv 150' },
      'conv-1716',
      []
    )
    const joint = objetJoint(task)
    expect(joint.dossiers).toBeUndefined()
    expect((joint.conversation as { id: string }).id).toBe('conv-1583')
  })

  it('un nombre de tête remplacé par une mention « conv N » est écrit dans la tâche, un seul dossier', () => {
    const { task } = composerTacheDOrchestration(
      bus,
      { task: '/kaizen 1263 le lien de conv 1583' },
      'conv-1716',
      []
    )
    expect(entete(task)).toContain('« 1263 »')
    const joint = objetJoint(task)
    expect(joint.dossiers).toBeUndefined()
    expect((joint.conversation as { id: string }).id).toBe('conv-1583')
  })

  it('un nombre nu écarté avec une seule conversation nommée : écrit dans la tâche, un seul dossier', () => {
    const { task } = composerTacheDOrchestration(
      bus,
      { task: '/kaizen conv-1583 2 bugs le lien est cassé' },
      'conv-1716',
      []
    )
    expect(entete(task)).toContain('« 2 »')
    const joint = objetJoint(task)
    expect(joint.dossiers).toBeUndefined()
    expect((joint.conversation as { id: string }).id).toBe('conv-1583')
  })
})
