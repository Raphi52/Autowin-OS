import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * LE REGISTRE DE COÛT EST RÉPARÉ COMME LES JOURNAUX D'AFFICHAGE.
 *
 * Constat du /residus du 2026-10-22 (conv-1062) : le cumul isolé de conv-879 (tour f6b7d7ad,
 * 9,04 $ pour 1,91 $ réels — session reprise après 11 jours, cumul purgé par la rétention de
 * 7 jours) figurait AUSSI dans `cost.jsonl`, qui alimente le plafond de dépense. Le script ne
 * réparait que `prompt-observability/` et `activity/`.
 */
const SCRIPT = join(import.meta.dirname, 'decumuler-couts-session.mjs')
const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

const jsonl = (lignes) => lignes.map((l) => JSON.stringify(l)).join('\n') + '\n'
// 100 000 tokens d'entrée + 20 000 de sortie au tarif Opus (5 $ / 25 $) = 1,00 $ mesuré.
const appel = (costUsd, ts) => ({
  sessionId: 's1',
  model: 'claude-opus-4',
  ts,
  usage: { costUsd, inputTokens: 100000, outputTokens: 20000 }
})

function racine() {
  const dir = mkdtempSync(join(tmpdir(), 'decumul-'))
  aNettoyer.push(dir)
  mkdirSync(join(dir, 'prompt-observability'))
  mkdirSync(join(dir, 'activity'))
  // 3,00 $ = 1 + 1 (tours précédents) + 1 (son propre coût) : la signature du cumul isolé.
  writeFileSync(
    join(dir, 'prompt-observability', 'conv-x.jsonl'),
    jsonl([appel(1, 't1'), appel(1, 't2'), appel(3, 't3'), appel(1, 't4')])
  )
  writeFileSync(
    join(dir, 'activity', 'conv-x.jsonl'),
    jsonl([{ kind: 'chat-usage', costUsd: 3, turnId: 't3' }])
  )
  writeFileSync(
    join(dir, 'cost.jsonl'),
    jsonl([
      { role: 'supervisor', conversationId: 'conv-x', turnId: 't3', costUsd: 3 },
      // même montant, AUTRE conversation : la table de correction ne s'y applique pas
      { role: 'supervisor', conversationId: 'conv-y', turnId: 'u1', costUsd: 3 },
      { role: 'supervisor', conversationId: 'conv-x', turnId: 't4', costUsd: 1 }
    ])
  )
  return dir
}

const lancer = (dir, ...extra) =>
  execFileSync(process.execPath, [SCRIPT, `--racine=${dir}`, ...extra], { encoding: 'utf8' })
const couts = (dir) =>
  readFileSync(join(dir, 'cost.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).costUsd)

describe('decumuler-couts-session — registre de coût', () => {
  it('en simulation, compte la ligne du registre sans rien écrire', () => {
    const dir = racine()
    expect(lancer(dir)).toMatch(/registre de coût : 1 lignes/)
    expect(couts(dir)).toEqual([3, 3, 1])
  })

  it('avec --ecrire, corrige la ligne de la conversation et elle seule, sauvegarde comprise', () => {
    const dir = racine()
    lancer(dir, '--ecrire')
    expect(couts(dir)).toEqual([1, 3, 1])
    expect(existsSync(join(dir, 'cost.jsonl.avant-decumul.bak'))).toBe(true)
    const activite = JSON.parse(readFileSync(join(dir, 'activity', 'conv-x.jsonl'), 'utf8'))
    expect(activite.costUsd).toBe(1)
  })

  it('une relance après réparation ne trouve plus rien', () => {
    const dir = racine()
    lancer(dir, '--ecrire')
    expect(lancer(dir)).toMatch(/registre de coût : 0 lignes/)
    expect(couts(dir)).toEqual([1, 3, 1])
  })
})
