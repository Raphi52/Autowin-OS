import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * `npm run scout:rendement` et `npm run scout:pilote` lisent le texte des messages par
 * `scripts/conversations-sur-disque.mjs`, qui importe `src/shared/chat-turn.ts`. Lancées par un `node`
 * qui ne lit pas le TypeScript (Node 20.20 sur ce poste, mesuré le 2026-10-17), elles plantaient sur
 * ERR_UNKNOWN_FILE_EXTENSION. On joue la VRAIE commande de package.json sur une conversation dont le
 * message n'existe que dans ses parties : le chemin qui importe le TypeScript est forcément traversé.
 */
const depot = fileURLToPath(new URL('..', import.meta.url))
const donnees = mkdtempSync(join(tmpdir(), 'aos-sondes-npm-'))
afterAll(() => rmSync(donnees, { recursive: true, force: true }))
const message = { role: 'user', content: '', parts: [{ kind: 'text', text: 'bonjour' }], ts: 1 }
const conversation = { id: 'conv-1', title: 'Essai', createdAt: 1, messages: [message] }
writeFileSync(join(donnees, 'conversations.json'), JSON.stringify([conversation]))

describe.each(['scout:rendement', 'scout:pilote'])('npm run %s', (script) => {
  it('lit un corpus réel sans planter, quel que soit le Node installé', () => {
    const args = ['run', script, '--', '--data', `"${donnees}"`, '--top', '1']
    const r = spawnSync('npm', args, { cwd: depot, shell: true, encoding: 'utf8', timeout: 60_000 })
    expect(r.stderr).not.toContain('ERR_UNKNOWN_FILE_EXTENSION')
    expect(r.status).toBe(0)
  }, 90_000)
})
