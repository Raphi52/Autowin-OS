import { describe, expect, it } from 'vitest'
import { kaizenNamedConversationId } from './autowin-kaizen-context'

describe('kaizenNamedConversationId', () => {
  it('lit la conversation nommee (conv-63, tour 93905e01-f715-4aab-aff8-40c7216dfc0c)', () => {
    expect(kaizenNamedConversationId("/kaizen conv-61 tu m'as mis un lien pas clickable")).toBe(
      'conv-61'
    )
  })
  it('lit « conv 150 » ecrit en clair dans la phrase (conv-152, tour 1dd28b24-4274-44a4-a9f5-2a36005f6afd)', () => {
    // Saisie ts 2026-10-10T08:26:55.163Z : le dossier recu etait celui de conv-152 elle-meme,
    // promptCalls / turnEvents / saisies vides, au lieu de celui de conv-150.
    expect(
      kaizenNamedConversationId(
        "/kaizen dans le dernier tour de la conv 150 j'ai envoyé qu'un screenshot et tu m'as répondu j'analyse les 2 screenshots"
      )
    ).toBe('conv-150')
    expect(kaizenNamedConversationId('/kaizen dans la conversation 61 le lien est casse')).toBe(
      'conv-61'
    )
    expect(kaizenNamedConversationId('/kaizen Conv-61 puis conv-60')).toBe('conv-61')
  })
  it('lit le numero seul en tete (kaizen conv-1266, tour 9e5ae43d-d2ff-4b14-b770-f8d5fde43b8f)', () => {
    // Demande reelle : le dossier recu etait celui de conv-1266 elle-meme, vide.
    expect(
      kaizenNamedConversationId(
        "/kaizen 1263 le petit modele de l'app a parlé de dialogue c nimporte quoi il doit lui manquer du contexte pour faire ses actions interne a autowin OS"
      )
    ).toBe('conv-1263')
    expect(kaizenNamedConversationId('/kaizen la 1256 parallelise pas tout')).toBe('conv-1256')
    expect(kaizenNamedConversationId('/kaizen 1263')).toBe('conv-1263')
    // Une mention `conv N` reste prioritaire.
    expect(kaizenNamedConversationId('/kaizen 12 conv 150 le lien')).toBe('conv-150')
  })
  it('un nombre qui est une QUANTITE ne designe pas une conversation', () => {
    expect(kaizenNamedConversationId('/kaizen 3 fois il a rate le build')).toBeUndefined()
    expect(kaizenNamedConversationId('/kaizen 1/10 cette reponse')).toBeUndefined()
    expect(kaizenNamedConversationId('/kaizen 2 tours de suite il boucle')).toBeUndefined()
    expect(kaizenNamedConversationId('/kaizen il a fait 1263 lignes')).toBeUndefined()
  })
  it('rien si aucune conversation nommee', () => {
    expect(kaizenNamedConversationId('/kaizen le lien est casse')).toBeUndefined()
    expect(kaizenNamedConversationId('/frame conv-61')).toBeUndefined()
  })
})
