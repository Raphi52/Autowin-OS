import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Pourquoi ce test existe (conv-160, 2026-10-10) : `ui-capture.mjs` se relancait avec
 * `--experimental-websocket` des que `WebSocket` manquait (Node 20) — et il le faisait en TETE de
 * module, donc aussi a l'IMPORT. Chaque fichier de test qui importait une fonction pure relancait un
 * process puis appelait `process.exit` : Vitest tuait le fichier, aucun test n'etait execute
 * (4 fichiers sur 4 sous Node 20.20.2).
 *
 * Sous Node 22, `WebSocket` est global : ces fichiers passeraient MEME avec le defaut. Ce test le
 * rend visible quelle que soit la version, en retirant `WebSocket` avant d'importer, dans un process
 * neuf. Il verifie que la ligne ecrite apres l'import vient bien du MEME process, sans relance.
 */
describe('ui-capture : un import ne relance pas le process', () => {
  it('importer le module sans WebSocket ne relance rien et ne quitte pas', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'ui-capture-import-'))
    try {
      const harnais = join(dossier, 'harnais.mjs')
      const module = pathToFileURL(fileURLToPath(new URL('./ui-capture.mjs', import.meta.url))).href
      writeFileSync(
        harnais,
        [
          'delete globalThis.WebSocket',
          `await import(${JSON.stringify(module)})`,
          'console.log(JSON.stringify({ pid: process.pid, execArgv: process.execArgv }))'
        ].join('\n')
      )
      const r = spawnSync(process.execPath, [harnais], { encoding: 'utf8', timeout: 30_000 })

      expect(r.status, r.stderr).toBe(0)
      const sortie = JSON.parse(r.stdout.trim().split('\n').at(-1))
      // Relance = la ligne viendrait d'un process ENFANT, lance avec l'option.
      expect(sortie.execArgv).not.toContain('--experimental-websocket')
      expect(sortie.pid).toBe(r.pid)
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
