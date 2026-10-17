import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kaizenConversationParCommande } from './autowin-kaizen-context'

/**
 * /kaizen SANS CONVERSATION NOMMÉE : le dossier visait la conversation du /kaizen elle-même, vide.
 *
 * Mesuré le 2026-10-17, conv-314, tour f5733ff5-07ff-4c61-8dc3-c4d75fad8f32 : « /kaizen dans mes
 * convs d'aujourd'hui j'ai eu un bug récurrent c'est que /draft ne me render pas le bbloc… ». Aucune
 * « conv N » dans la phrase, aucune citation : le dossier a été construit sur conv-314, qui ne
 * contenait que cette demande — appels modèle, journal des tours et saisies VIDES. Les traces du
 * défaut étaient dans conv-310, conv-311 et conv-312, où « /draft » avait été tapé.
 */
const ts = (iso: string): number => Date.parse(iso)
const DU_JOUR = [
  {
    id: 'conv-310',
    messages: [
      { role: 'user', content: "/draft des moyens de rendre le fond d'écran de l'acceuil magnifique", ts: ts('2026-10-17T13:22:07Z') },
      { role: 'user', content: '1 et 3', ts: ts('2026-10-17T13:54:08Z') }
    ]
  },
  {
    id: 'conv-311',
    messages: [
      { role: 'user', content: "/draft des éléments plus trash et chaotiques pour le fond d'écran d'acceuil", ts: ts('2026-10-17T13:56:18Z') }
    ]
  },
  {
    id: 'conv-312',
    messages: [
      { role: 'user', content: "/draft les humains les plus realiste possible pour le fond decran d'accueil", ts: ts('2026-10-17T13:56:33Z') },
      { role: 'user', content: 'je vois pas le block draft pour faire mon choix', ts: ts('2026-10-17T14:35:30Z') }
    ]
  },
  {
    id: 'conv-313',
    messages: [{ role: 'user', content: 'le timer est fix dans ce bloc', ts: ts('2026-10-17T13:59:04Z') }]
  }
]
const DEMANDE =
  "/kaizen dans mes convs d'aujourd'hui j'ai eu un bug récurrent c'est que /draft ne me render pas " +
  "le bbloc qui me permet de choisir dans la conv et me demande un ask"

describe('/kaizen sans conversation nommée : la commande citée désigne le dossier', () => {
  it('vise la DERNIÈRE conversation où « /draft » a été tapé, et nomme les autres', () => {
    const cible = kaizenConversationParCommande(DEMANDE, 'conv-314', [
      ...DU_JOUR,
      { id: 'conv-314', messages: [{ role: 'user', content: DEMANDE, ts: ts('2026-10-17T14:36:40Z') }] }
    ])

    expect(cible?.conversationId).toBe('conv-312')
    expect(cible?.avis).toMatch(/conv-311/)
    expect(cible?.avis).toMatch(/conv-310/)
    expect(cible?.avis).not.toMatch(/conv-313/)
  })

  it('garde la conversation courante quand la commande y a été tapée', () => {
    expect(kaizenConversationParCommande('/kaizen tu viens de rater le /draft', 'conv-311', DU_JOUR)).toBeUndefined()
  })

  it('ne fait rien sans commande citée, ni hors /kaizen, ni pour une commande jamais tapée', () => {
    expect(kaizenConversationParCommande('/kaizen le chat est lent', 'conv-314', DU_JOUR)).toBeUndefined()
    expect(kaizenConversationParCommande('regarde /draft', 'conv-314', DU_JOUR)).toBeUndefined()
    expect(kaizenConversationParCommande('/kaizen le /remake plante', 'conv-314', DU_JOUR)).toBeUndefined()
  })

  it('est BRANCHÉE sur le choix du dossier (commands.ts), après la conversation nommée', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toMatch(/kaizenConversationParCommande\(/)
    expect(source).toMatch(/kaizenParCommande\?\.avis/)
  })
})
