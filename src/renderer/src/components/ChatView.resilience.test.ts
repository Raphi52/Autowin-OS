import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
// La ligne de message a été EXTRAITE dans son propre module (découpe de ChatView.tsx). L'invariant
// vérifié ici — mémoïsation data-only — n'a pas changé, seul son fichier a changé.
const rowSource = readFileSync(new URL('./ChatMessageRow.tsx', import.meta.url), 'utf8')

describe('ChatView composer resilience', () => {
  it('acquires a synchronous send lock before the first bootstrap await', () => {
    const send = source.match(
      // Signature elargie : `send` accepte desormais des options (`keepComposerDraft`), le contrat
      // verifie ici — verrou avant le premier await, brouillon preserve — est inchange.
      /async function send\(text\?: string(?:,[^)]*)?\): Promise<void> \{[\s\S]*?\n {2}\}/
    )?.[0]
    expect(send).toBeDefined()
    expect(send).toContain('sendLocksRef.current.add(sendLockKey)')
    expect(send!.indexOf('sendLocksRef.current.add(sendLockKey)')).toBeLessThan(
      send!.indexOf('await refreshRuntimeIdentity()')
    )
  })

  it('keeps bootstrap failures inside the send try and preserves the draft', () => {
    const send = source.match(
      // Signature elargie : `send` accepte desormais des options (`keepComposerDraft`), le contrat
      // verifie ici — verrou avant le premier await, brouillon preserve — est inchange.
      /async function send\(text\?: string(?:,[^)]*)?\): Promise<void> \{[\s\S]*?\n {2}\}/
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
    // L'origine reste CAPTUREE avant tout await. Depuis la mosaique, elle peut etre une fenetre
    // NON active (parametre cible) : l'invariant vise le brouillon d'origine, pas le composer courant.
    expect(source).toContain('const originDraftKey = cible ?? composerDraftKeyRef.current')
    expect(source).toContain('setDraftAttachments(originDraftKey')
  })

  it('memoizes stable message rows for long histories', () => {
    expect(rowSource).toContain('export const ChatMessageRow = memo(')
    expect(rowSource).toContain('prev.message === next.message')
    expect(source).toContain('<ChatMessageRow')
    expect(source).toContain('messageKey(')
  })
})
