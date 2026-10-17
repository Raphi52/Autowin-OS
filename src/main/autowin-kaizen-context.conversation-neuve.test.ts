import { describe, expect, it } from 'vitest'
import { kaizenConversationParCommande } from './autowin-kaizen-context'

/**
 * /kaizen TAPÉ DANS UNE CONVERSATION NEUVE : son dossier est vide par construction.
 *
 * Mesuré le 2026-10-17, conv-318, tour 5b0c4fcb-e354-410e-99b6-567740e86db1, saisie ts
 * 2026-10-17T15:40:06.421Z : « /kaizen le bloc 3d doit etre dans le bloc draft », premier message
 * d'une conversation neuve. Ni « conv N », ni citation, ni « /draft » avec sa barre : le dossier a
 * été construit sur conv-318 elle-même — promptCalls, turnEvents et saisies VIDES. Le /draft visé
 * était celui de conv-315 (tour a6fcfb6e-c5ce-41c9-86c8-dcde195c67f2, tapé à 15:10:38Z).
 */
const ts = (iso: string): number => Date.parse(iso)
const DEMANDE = '/kaizen le bloc 3d doit etre dans le bloc draft'
const AVANT = [
  {
    id: 'conv-312',
    title: '/draft les humains',
    messages: [
      {
        role: 'user',
        content: "/draft les humains les plus realiste possible pour le fond decran d'accueil",
        ts: ts('2026-10-17T13:56:33Z')
      }
    ]
  },
  {
    id: 'conv-315',
    title: "/draft refais la ville de gauche du fond d'écran de l'accueil",
    messages: [
      {
        role: 'user',
        content: "/draft refais la ville de gauche du fond d'écran de l'accueil",
        ts: ts('2026-10-17T15:10:38.191Z')
      },
      { role: 'assistant', content: '```threejs\n…\n```', ts: ts('2026-10-17T15:36:25Z') }
    ]
  },
  {
    id: 'conv-317',
    title: 'le timer du bloc',
    messages: [
      { role: 'user', content: 'le timer est fix dans ce bloc', ts: ts('2026-10-17T15:30:00Z') }
    ]
  }
]
const NEUVE = {
  id: 'conv-318',
  title: DEMANDE,
  messages: [
    { role: 'user', content: DEMANDE, ts: ts('2026-10-17T15:40:06.421Z') },
    { role: 'assistant', content: '', ts: ts('2026-10-17T15:40:06.421Z') }
  ]
}

/** Les procedures connues ; le defaut de la fonction lit celles du depot (skills/<nom>/SKILL.md). */
const COMMANDES = ['draft', 'build', 'kaizen', 'look']
/*
 * Rejoue sur les vraies conversations du poste, le mot « dans » de la demande etait d'abord lu comme
 * une commande : « /dans … » avait ete tape une fois, en conv-254. Seul un NOM DE PROCEDURE compte.
 */
const DANS = {
  id: 'conv-254',
  title: 'dans la conv',
  messages: [{ role: 'user', content: '/dans la conv 250 regarde', ts: ts('2026-10-11T11:09:46Z') }]
}

describe('/kaizen dans une conversation neuve', () => {
  it('lit « draft » sans barre comme la commande /draft : le dossier part sur conv-315', () => {
    const cible = kaizenConversationParCommande(
      DEMANDE,
      'conv-318',
      [DANS, ...AVANT, NEUVE],
      COMMANDES
    )
    expect(cible?.conversationId).toBe('conv-315')
    expect(cible?.avis).toMatch(/« draft »/)
    expect(cible?.avis).toMatch(/conv-312/)
  })

  it('sans commande reconnue, garde la conversation mais DIT qu’elle est vide et nomme les récentes', () => {
    const demande = '/kaizen le bloc 3d doit etre plus grand'
    const cible = kaizenConversationParCommande(
      demande,
      'conv-318',
      [
        DANS,
        ...AVANT,
        {
          ...NEUVE,
          messages: [{ role: 'user', content: demande, ts: ts('2026-10-17T15:40:06.421Z') }]
        }
      ],
      COMMANDES
    )
    expect(cible?.conversationId).toBe('conv-318')
    expect(cible?.avis).toMatch(/ne contient que cette demande/)
    // Les plus récentes d'abord, avec leur titre.
    expect(cible?.avis).toMatch(
      /conv-315 « \/draft refais la ville[^»]*».*conv-317|conv-317.*conv-315/
    )
    expect(cible?.avis?.indexOf('conv-315')).toBeLessThan(cible?.avis?.indexOf('conv-312') ?? -1)
  })

  it('ne lit PAS un mot nu comme une commande hors d’une conversation neuve', () => {
    const entamee = {
      ...NEUVE,
      messages: [
        { role: 'user', content: 'refais le décor', ts: ts('2026-10-17T15:38:00Z') },
        { role: 'user', content: DEMANDE, ts: ts('2026-10-17T15:40:06.421Z') }
      ]
    }
    expect(
      kaizenConversationParCommande(DEMANDE, 'conv-318', [...AVANT, entamee], COMMANDES)
    ).toBeUndefined()
  })
})
