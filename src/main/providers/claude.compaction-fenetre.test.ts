import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FENETRE_COMPACTION_CLI, findClaudeExecutable, reglagesCliAutowin } from './claude'

/**
 * FENÊTRE DE COMPACTION DES AGENTS (conv-335, 2026-10-19 : « réduit le coût d'un long fil »).
 *
 * MESURÉ sur le CLI 2.1.302 installé : sans réglage, `/autocompact` répond « Auto-compact window
 * for Opus 5.5: 1m tokens (default for this model) ». Le CLI ne résume donc un fil qu'à l'approche
 * du million, et chaque appel relit TOUT le contexte depuis le cache. Sur la semaine (172 sessions
 * Opus 5.5, ~/.claude/projects/D--Autowin), 1,44 milliard de jetons relus, et 78 % de ce relu
 * venait d'appels dont le contexte dépassait déjà 200 000 jetons.
 *
 * La fenêtre retenue (300k) sort d'une simulation sur ces sessions réelles, prix déduits de
 * cost.jsonl, coût des résumés compris : 150k = perte (1 134 résumés), 200k = +59 $/semaine,
 * 300k = +85 $ (39 résumés), 400k = +59 $.
 */
describe('fenêtre de compaction passée au CLI', () => {
  it('les réglages des agents bornent la compaction à 300k jetons', () => {
    expect(FENETRE_COMPACTION_CLI).toBe(300_000)
    expect(reglagesCliAutowin('garde.mjs').autoCompactWindow).toBe(FENETRE_COMPACTION_CLI)
  })

  // Le VRAI CLI lit-il la clé ? `/autocompact` est une commande LOCALE : aucun appel modèle.
  const CLI = process.env.CLAUDE_BIN ?? findClaudeExecutable()
  it.skipIf(!CLI)(
    'le CLI installé la prend « from settings »',
    () => {
      const dossier = mkdtempSync(join(tmpdir(), 'autowin-compaction-'))
      try {
        const fichier = join(dossier, 'settings.json')
        writeFileSync(
          fichier,
          JSON.stringify(reglagesCliAutowin(join(dossier, 'garde.mjs'))),
          'utf8'
        )
        const r = spawnSync(
          CLI!,
          ['-p', '/autocompact', '--model', 'claude-opus-5-5', '--settings', fichier],
          { encoding: 'utf8', timeout: 90_000, windowsHide: true }
        )
        expect(r.stdout).toMatch(/Auto-compact window for [^:]+: 300k tokens \(from settings\)/)
      } finally {
        rmSync(dossier, { recursive: true, force: true })
      }
    },
    120_000
  )
})
