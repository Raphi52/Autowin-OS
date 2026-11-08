import { describe, expect, it } from 'vitest'
import type { AppSnapshot } from '../commands/commands'
import { etatPourOutil, LIMITE_MAX } from './etat-outil'

function etatRealiste(n = 1190): AppSnapshot {
  return {
    tab: 'chat',
    activeConversationId: 'conv-5',
    providers: ['claude'],
    roles: { build: { provider: 'claude', model: 'sonnet' } },
    conversations: Array.from({ length: n }, (_, i) => ({
      id: `conv-${i + 1}`,
      title: `Conversation numéro ${i + 1} — Événement très long pour peser ${'x'.repeat(60)}`,
      category: 'claude',
      updatedAt: 1_000 + i,
      ...(i % 3 === 0 ? {} : { lastUserMessageAt: 5_000 + i })
    })),
    runs: Array.from({ length: 20 }, (_, i) => ({
      subject: `run-${i}`,
      status: i < 3 ? 'red' : 'green',
      blocked: i < 3
    })),
    runsNonExamines: 1150,
    worktrees: [{ workspacePath: 'D:/w', state: 'open' }],
    travauxNonPublies: [{ agentId: 'agent-a', date: '2026-10-30', fichiers: ['a.ts', 'b.ts'] }],
    budgetUsd: 12.5,
    budgetUnpricedTurns: 3,
    budgetIsPartial: true
  }
}

describe('etatPourOutil', () => {
  it('vue par défaut : moins de 8 000 caractères sur 1 190 conversations', () => {
    const sortie = etatPourOutil(etatRealiste(), {})
    expect(JSON.stringify(sortie).length).toBeLessThan(8000)
    expect((sortie.conversations as unknown[]).length).toBe(20)
    expect(sortie.travauxNonPublies).toHaveLength(1)
    expect((sortie.runsBloques as unknown[]).length).toBe(3)
    expect((sortie.compteurs as { conversations: number }).conversations).toBe(1190)
    expect(String(sortie.note)).toContain('1170 conversation(s) omise(s)')
  })

  it('un compte de RUN.md à regarder calculé à zéro reste lisible : 0, pas un champ absent', () => {
    const etat = { ...etatRealiste(3), runsNonExamines: 0 }
    const compteurs = etatPourOutil(etat, {}).compteurs as Record<string, unknown>
    expect(compteurs.runsNonExamines).toBe(0)
  })

  it('le compteur de RUN.md à regarder arrive avec sa légende, pour que 0 se lise « rien à regarder »', () => {
    const compteurs = etatPourOutil(etatRealiste(3), {}).compteurs as Record<string, unknown>
    expect(String(compteurs.runsNonExaminesLegende)).toContain('rien à regarder')
  })

  it('trie par lastUserMessageAt décroissant et réduit les champs', () => {
    const sortie = etatPourOutil(etatRealiste(30), { limite: '3' })
    const convs = sortie.conversations as Array<Record<string, unknown>>
    expect(convs.map((c) => c.id)).toEqual(['conv-30', 'conv-29', 'conv-27'])
    expect(Object.keys(convs[0]).sort()).toEqual(['id', 'lastUserMessageAt', 'title', 'updatedAt'])
  })

  it('limite : texte ou nombre, bornée à 200, invalide = erreur', () => {
    expect((etatPourOutil(etatRealiste(), { limite: 5 }).conversations as unknown[]).length).toBe(5)
    expect((etatPourOutil(etatRealiste(), { limite: '9999' }).conversations as unknown[]).length).toBe(
      LIMITE_MAX
    )
    expect(() => etatPourOutil(etatRealiste(), { limite: 'beaucoup' })).toThrow(/limite invalide/)
    expect(() => etatPourOutil(etatRealiste(), { limite: 0 })).toThrow(/limite invalide/)
  })

  it('conversation : filtre insensible à la casse et aux accents, sur titre et id', () => {
    const etat = etatRealiste(30)
    etat.conversations[3].title = 'Évènement Spécial'
    const parTitre = etatPourOutil(etat, { conversation: 'EVENEMENT special' })
    expect((parTitre.conversations as Array<{ id: string }>).map((c) => c.id)).toEqual(['conv-4'])
    const parId = etatPourOutil(etat, { conversation: 'CONV-12' })
    expect((parId.conversations as Array<{ id: string }>).map((c) => c.id)).toContain('conv-12')
  })

  it('sections : liste texte ou tableau ; seules les clés demandées', () => {
    const a = etatPourOutil(etatRealiste(), { sections: 'runs, worktrees' })
    expect(Object.keys(a)).toEqual(['runs', 'worktrees'])
    const b = etatPourOutil(etatRealiste(), { sections: ['providers'] })
    expect(b).toEqual({ providers: ['claude'] })
  })

  it('sections inconnues : erreur qui liste les valeurs valides', () => {
    expect(() => etatPourOutil(etatRealiste(), { sections: 'runs,zorglub' })).toThrow(
      /« zorglub ».*tout.*conversations.*travauxNonPublies/
    )
  })

  it('sections: tout rend l’état entier, conversations comprises', () => {
    const sortie = etatPourOutil(etatRealiste(), { sections: 'tout' })
    expect((sortie.conversations as unknown[]).length).toBe(1190)
    expect(sortie.roles).toBeDefined()
    expect(sortie.note).toBeUndefined()
  })
})
