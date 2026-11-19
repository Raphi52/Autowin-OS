import { describe, expect, it } from 'vitest'
import { analyserFil, famillesDuRefus, rapport } from './cout-du-fil.mjs'

const couts = [
  { conversationId: 'conv-1', role: 'supervisor', turnId: 't1', costUsd: 0.5 },
  { conversationId: 'conv-1', role: 'supervisor', turnId: 't1', costUsd: 0.25 },
  { conversationId: 'conv-1', role: 'subagent', turnId: 't1', costUsd: 30 },
  { conversationId: 'conv-1', role: 'judge', turnId: 't1', costUsd: 4 },
  { conversationId: 'conv-1', role: 'petitesTaches', costUsd: 0.01 },
  // Un autre fil ne compte jamais.
  { conversationId: 'conv-2', role: 'subagent', turnId: 'x', costUsd: 999 }
]

const activite = [
  { ts: '2026-10-25T09:00:00Z', kind: 'chat-usage', label: 'passe en anglais', costUsd: 0.75 },
  {
    ts: '2026-10-25T09:10:00Z',
    kind: 'exec',
    phase: 'build',
    runId: 'run-a',
    costUsd: 20,
    durationMs: 600_000
  },
  {
    ts: '2026-10-25T09:20:00Z',
    kind: 'judge',
    phase: 'judge',
    runId: 'run-a',
    costUsd: 2,
    durationMs: 120_000
  },
  {
    ts: '2026-10-25T09:21:00Z',
    kind: 'gate',
    phase: 'BLOQUÉ: Promis mais pas fait : la page Réglages',
    runId: 'run-a'
  },
  {
    ts: '2026-10-25T09:21:01Z',
    kind: 'gate',
    phase: 'Réparation 1 — nouveau passage de build',
    runId: 'run-a'
  },
  {
    ts: '2026-10-25T09:40:00Z',
    kind: 'exec',
    phase: 'build',
    runId: 'run-a',
    costUsd: 10,
    durationMs: 900_000
  },
  {
    ts: '2026-10-25T10:00:00Z',
    kind: 'judge',
    phase: 'judge',
    runId: 'run-a',
    costUsd: 2,
    durationMs: 120_000
  },
  {
    ts: '2026-10-25T10:01:00Z',
    kind: 'gate',
    phase: 'BLOQUÉ: Promis mais pas fait : la page Réglages',
    runId: 'run-a'
  },
  // Ligne d'étape sans coût (annonce d'outils) : ni passe ni dépense.
  {
    ts: '2026-10-25T09:05:00Z',
    kind: 'exec',
    phase: 'outils natifs servis a think',
    runId: 'run-a'
  }
]

describe('cout-du-fil', () => {
  const a = analyserFil({ conversationId: 'conv-1', couts, activite })

  it('prend le total au registre, réparti par rôle, sans les autres fils', () => {
    expect(a.registreUsd).toBeCloseTo(34.76)
    expect(a.parRole.executions).toBeCloseTo(34)
    expect(a.parRole.chat).toBeCloseTo(0.75)
    // Deux lignes du même tour de chat = un seul tour.
    expect(a.toursDeChat).toBe(1)
  })

  it('compte les constructions, les contrôles et les refus de chaque exécution', () => {
    expect(a.executions).toHaveLength(1)
    const [r] = a.executions
    expect(r.coutUsd).toBe(34)
    expect(r.passesDeBuild).toBe(2)
    expect(r.controles).toBe(2)
    expect(r.refus).toHaveLength(2)
    // Du premier au dernier événement de l'exécution : 09:05 → 10:01.
    expect(r.dureeMin).toBe(56)
    expect(r.parPhase.build).toEqual({ usd: 30, n: 2, minutes: 25 })
  })

  it('le rapport dit qu’un refus revient à l’identique', () => {
    const texte = rapport(a)
    expect(texte).toContain('conv-1 — 35 $ au registre')
    expect(texte).toContain('2 construction(s), 2 contrôle(s), 2 refus')
    expect(texte).toContain('refus ×2 : BLOQUÉ: Promis mais pas fait : la page Réglages')
    expect(texte).toContain('refus par origine : autre 2')
  })

  it('range un refus sous chacune de ses origines', () => {
    expect(
      famillesDuRefus(
        'Arrêté au contrôle final : Promis mais pas fait : « 1 défaut restant dans la grille qualité de clean ».; hook fix-gate: 3 édits de x.ts'
      )
    ).toEqual(['fix-gate', 'nettoyage'])
    expect(famillesDuRefus('BLOQUÉ: Promis mais pas fait : « Objection du juge : ÉTENDUE')).toEqual(
      ['juge']
    )
  })
})
