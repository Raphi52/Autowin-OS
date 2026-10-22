import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * LE RATTRAPAGE NE DOIT PAS RECOMPTER UN TOUR DEJA COMPTE EN DIRECT.
 *
 * Constat du /residus du 2026-10-22 (conv-1062) : la ligne de cout ecrite en direct par
 * `ChatTurnCostRecorder` et l'evenement `chat-usage` du MEME reglement portent deux horodatages
 * distincts (pris a quelques millisecondes d'ecart — conv-1000, tour dae33555 : `.956` contre
 * `.960`). La cle `conversation|horodatage` les croyait differents : 3 238 tours deja comptes
 * passaient pour manquants, soit ~3 000 $ en double a `--apply`.
 */
const SCRIPT = join(import.meta.dirname, 'backfill-cout-chat.mjs')
const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

function racine({ activite, couts }) {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-cout-'))
  aNettoyer.push(dir)
  mkdirSync(join(dir, 'activity'), { recursive: true })
  for (const [conv, lignes] of Object.entries(activite))
    writeFileSync(
      join(dir, 'activity', `${conv}.jsonl`),
      lignes.map((l) => JSON.stringify(l)).join('\n') + '\n'
    )
  if (couts)
    writeFileSync(join(dir, 'cost.jsonl'), couts.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return dir
}

const lancer = (dir, ...extra) =>
  execFileSync(process.execPath, [SCRIPT, '--data', dir, ...extra], { encoding: 'utf8' })
const aRejouer = (sortie) => Number(/A rejouer\s*:\s*(\d+)/.exec(sortie)?.[1])

const usage = (turnId, ts, costUsd) => ({
  kind: 'chat-usage',
  provider: 'claude',
  turnId,
  ts,
  inputTokens: 100,
  outputTokens: 10,
  costUsd
})

describe('backfill-cout-chat — dedoublonnage par tour', () => {
  it("ignore un tour deja compte en direct meme quand l'horodatage differe de quelques ms", () => {
    const dir = racine({
      activite: {
        'conv-1000': [
          usage('dae33555', '2026-10-01T14:54:31.960Z', 3.29),
          // second reglement du MEME tour : sa ligne directe existe aussi, horodatage different
          usage('dae33555', '2026-10-01T14:55:02.118Z', 0.5)
        ]
      },
      couts: [
        {
          provider: 'claude',
          role: 'supervisor',
          conversationId: 'conv-1000',
          turnId: 'dae33555',
          ts: '2026-10-01T14:54:31.956Z',
          costUsd: 3.29
        },
        {
          provider: 'claude',
          role: 'supervisor',
          conversationId: 'conv-1000',
          turnId: 'dae33555',
          ts: '2026-10-01T14:55:02.114Z',
          costUsd: 0.5
        }
      ]
    })
    expect(aRejouer(lancer(dir))).toBe(0)
  })

  it("rejoue un tour d'avant le cablage, puis ne le rejoue plus a la relance", () => {
    const dir = racine({
      activite: {
        'conv-12': [
          usage('ancien01', '2026-09-01T10:00:00.000Z', 1.25),
          // evenement tres ancien, sans turnId : seule la cle d'horodatage le protege
          { kind: 'chat-usage', ts: '2026-08-01T10:00:00.000Z', inputTokens: 5, outputTokens: 1 }
        ]
      },
      couts: [
        {
          provider: 'claude',
          role: 'orchestrator',
          conversationId: 'conv-12',
          ts: '2026-09-01T09:00:00.000Z',
          costUsd: 2
        }
      ]
    })
    expect(aRejouer(lancer(dir))).toBe(2)
    lancer(dir, '--apply')
    expect(existsSync(join(dir, 'cost.jsonl.avant-backfill'))).toBe(true)
    const ecrites = readFileSync(join(dir, 'cost.jsonl'), 'utf8').trim().split('\n')
    expect(ecrites).toHaveLength(3)
    expect(aRejouer(lancer(dir))).toBe(0)
  })

  it("ne rejoue pas un reglement vide, que l'app n'ecrit pas non plus en direct", () => {
    const dir = racine({
      activite: {
        'conv-3': [
          {
            kind: 'chat-usage',
            turnId: 'coupe',
            ts: '2026-10-16T14:51:16.420Z',
            inputTokens: 0,
            outputTokens: 0
          }
        ]
      }
    })
    expect(aRejouer(lancer(dir))).toBe(0)
  })

  it('ne confond pas deux conversations qui partagent un identifiant de tour', () => {
    const dir = racine({
      activite: { 'conv-2': [usage('t1', '2026-09-02T10:00:00.000Z', 1)] },
      couts: [
        {
          provider: 'claude',
          role: 'supervisor',
          conversationId: 'conv-1',
          turnId: 't1',
          ts: '2026-09-02T10:00:00.003Z',
          costUsd: 1
        }
      ]
    })
    expect(aRejouer(lancer(dir))).toBe(1)
  })
})
