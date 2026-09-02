import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTurnTiming, startTurnTimer } from './turn-timing'

/**
 * UN CHRONO SANS IDENTITE NE SE RECOLLE A RIEN.
 *
 * Mesure du 2026-09-02 sur `turn-timing.jsonl` (398 lignes reelles) : AUCUNE ne porte d'identifiant de
 * tour ni de conversation. On sait donc qu'un tour a pris 42 s sans jamais pouvoir dire LEQUEL — la
 * ligne ne se joint ni au journal de tour, ni a la conversation, ni au gel survenu au meme instant.
 * L'identite est desormais donnee au DEMARRAGE du chrono, la ou elle est connue.
 */
let dir: string

async function lireLigne(): Promise<Record<string, unknown>> {
  const source = join(dir, 'turn-timing.jsonl')
  // Ecriture best-effort NON attendue (jamais bloquante pour un tour) : on attend son arrivee.
  for (let essai = 0; essai < 200; essai += 1) {
    if (existsSync(source)) {
      const lignes = readFileSync(source, 'utf8').split('\n').filter((l) => l.trim())
      if (lignes.length) return JSON.parse(lignes[lignes.length - 1] as string)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('aucune ligne de chronometrage ecrite')
}

describe('chronometrage de tour — la ligne dit DE QUEL tour elle parle', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'timing-'))
    configureTurnTiming(dir)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('ecrit turnId et conversationId a cote des jalons', async () => {
    const timer = startTurnTimer('chat', { turnId: 'turn-77', conversationId: 'conv-131' })
    timer.mark('send0:start')
    timer.end({ provider: 'anthropic' })

    const ligne = await lireLigne()
    expect(ligne.turnId).toBe('turn-77')
    expect(ligne.conversationId).toBe('conv-131')
    expect(ligne.label).toBe('chat')
    expect(ligne.provider).toBe('anthropic')
    expect((ligne.marks as Record<string, number>)['send0:start']).toBeTypeOf('number')
  })

  it('reste ecrivable sans identite — une ligne muette vaut mieux qu un tour casse', async () => {
    startTurnTimer('demarrage').end()
    const ligne = await lireLigne()
    expect(ligne.label).toBe('demarrage')
    expect('turnId' in ligne).toBe(false)
  })
})
