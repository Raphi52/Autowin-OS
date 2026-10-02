import { describe, expect, it } from 'vitest'
import { kaizenNamedConversationId } from './autowin-kaizen-context'

describe('kaizenNamedConversationId', () => {
  it('lit la conversation nommee (conv-63, tour 93905e01-f715-4aab-aff8-40c7216dfc0c)', () => {
    expect(kaizenNamedConversationId("/kaizen conv-61 tu m'as mis un lien pas clickable")).toBe(
      'conv-61'
    )
  })
  it('rien si aucune conversation nommee', () => {
    expect(kaizenNamedConversationId('/kaizen le lien est casse')).toBeUndefined()
    expect(kaizenNamedConversationId('/frame conv-61')).toBeUndefined()
  })
})
