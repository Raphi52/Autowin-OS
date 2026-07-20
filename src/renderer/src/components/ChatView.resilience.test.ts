import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')

describe('ChatView composer resilience', () => {
  it('acquires a synchronous send lock before the first bootstrap await', () => {
    const send = source.match(
      /async function send\(text\?: string\): Promise<void> \{[\s\S]*?\n {2}\}/
    )?.[0]
    expect(send).toBeDefined()
    expect(send).toContain('sendLocksRef.current.add(sendLockKey)')
    expect(send!.indexOf('sendLocksRef.current.add(sendLockKey)')).toBeLessThan(
      send!.indexOf('await refreshRuntimeIdentity()')
    )
  })

  it('keeps bootstrap failures inside the send try and preserves the draft', () => {
    const send = source.match(
      /async function send\(text\?: string\): Promise<void> \{[\s\S]*?\n {2}\}/
    )?.[0]
    expect(send).toBeDefined()
    expect(send).toContain('let messageCommitted = false')
    expect(send).toContain('if (!messageCommitted)')
    expect(send).toMatch(/setDraftError\(\s*sendDraftKey,/)
  })

  it('stores composers per conversation and binds async attachments to their origin', () => {
    expect(source).toContain("const NEW_DRAFT_KEY = '__new__'")
    expect(source).toContain('composerDraftsRef')
    expect(source).toContain('switchComposerDraft(c.id)')
    expect(source).toContain('switchComposerDraft(NEW_DRAFT_KEY)')
    expect(source).toContain('const originDraftKey = composerDraftKeyRef.current')
    expect(source).toContain('setDraftAttachments(originDraftKey')
  })

  it('memoizes stable message rows for long histories', () => {
    expect(source).toContain('const ChatMessageRow = memo(')
    expect(source).toContain('<ChatMessageRow')
    expect(source).toContain('messageKey(')
  })
})
