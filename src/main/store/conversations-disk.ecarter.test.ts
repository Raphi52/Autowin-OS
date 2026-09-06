import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ecarterStoreIllisible, conversationJournalPath } from './conversations-disk'

/*
 * POURQUOI : un `conversations.json` illisible empechait l'application de S'OUVRIR. On le met de
 * cote pour pouvoir demarrer — mais « mettre de cote » doit rester REVERSIBLE et COMPLET, sinon on
 * echange un blocage contre une perte de donnees.
 */
function dossierJetable(): string {
  return mkdtempSync(join(tmpdir(), 'autowin-ecart-'))
}

describe('mise de cote d un store illisible', () => {
  it('conserve le fichier au lieu de le supprimer, et rend son nouveau chemin', () => {
    const dossier = dossierJetable()
    const store = join(dossier, 'conversations.json')
    writeFileSync(store, '[{"casse":true}]', 'utf8')

    const ecartes = ecarterStoreIllisible(store, new Date('2026-09-06T18:30:00.000Z'))

    expect(existsSync(store)).toBe(false)
    expect(ecartes).toHaveLength(1)
    // Le CONTENU doit survivre intact : c'est tout ce qui reste des conversations de l'utilisateur.
    expect(readFileSync(ecartes[0]!, 'utf8')).toBe('[{"casse":true}]')
    expect(ecartes[0]).toContain('illisible-2026-09-06')
  })

  it('emporte le journal d ecritures avec le snapshot', () => {
    const dossier = dossierJetable()
    const store = join(dossier, 'conversations.json')
    writeFileSync(store, '[]', 'utf8')
    writeFileSync(conversationJournalPath(store), '{"op":"upsert"}\n', 'utf8')

    const ecartes = ecarterStoreIllisible(store)

    // Laisser le journal serait PIRE que tout : il serait rejoue sur un store vide et
    // ressusciterait une moitie des donnees dans un etat incoherent.
    expect(existsSync(conversationJournalPath(store))).toBe(false)
    expect(ecartes).toHaveLength(2)
    expect(readdirSync(dossier).every((nom) => nom.includes('illisible-'))).toBe(true)
  })

  it('ne rend rien et ne leve pas quand il n y a rien a ecarter', () => {
    const dossier = dossierJetable()

    expect(ecarterStoreIllisible(join(dossier, 'conversations.json'))).toEqual([])
  })
})
