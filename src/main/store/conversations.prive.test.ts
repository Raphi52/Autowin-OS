/**
 * LE FIL PRIVÉ DU VILLAGE COMMUN (D6 de `grill/agent-hq-japon-town.md`, lot 3).
 *
 * Un fil marqué privé garde son tanuki chez les collègues, mais sans titre. Le drapeau suit le même
 * chemin que `inactive` : posé sur la conversation, effacé (jamais `false`) quand on le retire,
 * relu après redémarrage, et servi tel quel dans le résumé `os:conversations` que lit le registre
 * des tanukis.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'

const dir = mkdtempSync(join(tmpdir(), 'aos-convs-prive-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('ConversationStore — le fil privé (D6, conv-1429)', () => {
  it('un fil naît NON privé', () => {
    const store = new ConversationStore(() => 1000)
    const c = store.create({ title: 'T', provider: 'claude' })
    expect(store.get(c.id)?.prive).toBeUndefined()
  })

  it('marquer puis démarquer efface le champ, sans laisser `false`', () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude' }).id
    expect(store.marquerPrive(id, true)?.prive).toBe(true)
    expect(store.marquerPrive(id, false)).toBeDefined()
    expect(store.get(id)).not.toHaveProperty('prive')
  })

  it("ne fait pas remonter le fil : masquer un titre n'est pas travailler", () => {
    let t = 1000
    const store = new ConversationStore(() => t)
    const id = store.create({ title: 'T', provider: 'claude' }).id
    const avant = store.get(id)?.updatedAt
    t = 5000
    store.marquerPrive(id, true)
    expect(store.get(id)?.updatedAt).toBe(avant)
  })

  it('id inconnu : `undefined`, rien de créé', () => {
    const store = new ConversationStore(() => 1000)
    expect(store.marquerPrive('conv-inconnue', true)).toBeUndefined()
    expect(store.listSummaries()).toHaveLength(0)
  })

  it('le résumé `os:conversations` porte le drapeau, et lui seul', () => {
    const store = new ConversationStore(() => 1000)
    const prive = store.create({ title: 'Secret', provider: 'claude' }).id
    const public_ = store.create({ title: 'Ouvert', provider: 'claude' }).id
    store.marquerPrive(prive, true)
    const resumes = new Map(store.listSummaries().map((r) => [r.id, r]))
    expect(resumes.get(prive)?.prive).toBe(true)
    expect(resumes.get(public_)).not.toHaveProperty('prive')
  })

  it('survit au redémarrage, et se retire aussi sur disque', async () => {
    const fichier = join(dir, 'conversations.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, fichier)
    const id = a.create({ title: 'Privé', provider: 'claude' }).id
    a.marquerPrive(id, true)
    await attendreEcrituresConversations()

    const b = new ConversationStore(() => 2000)
    persistConversations(b, fichier)
    expect(b.get(id)?.prive).toBe(true)

    b.marquerPrive(id, false)
    await attendreEcrituresConversations()
    const c = new ConversationStore(() => 3000)
    persistConversations(c, fichier)
    expect(c.get(id)).not.toHaveProperty('prive')
    // Le journal ne garde pas un `prive: false` qui ressortirait à la compaction.
    expect(readFileSync(fichier, 'utf8')).not.toMatch(/"prive":\s*false/)
    // La compaction de démarrage du dernier store passe par la même file : on l'attend avant que
    // `afterAll` n'efface le dossier, sinon elle échoue dans le vide et le dit sur la console.
    await attendreEcrituresConversations()
  })
})
