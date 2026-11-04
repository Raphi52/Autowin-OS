// Tests du vérificateur Blender MCP (conv-1560, lot 3 du plan conv-1558).
// Pourquoi : le contrôle final ne compte pas `node scripts/x.mjs` comme un test ; et surtout un
// vérificateur qui rendrait 0 sans joindre Blender serait une fausse preuve. Ces cas le falsifient :
// port déjà tenu → 3 (jamais vérifier le Blender d'un autre), port que l'add-on n'ouvre pas → 4,
// chaîne réelle → 0.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'blender-mcp-verifier.mjs')
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const BUREAU = process.env.AUTOWIN_HDESK_ID || 'blender-mcp-verif'
const avecBlender = process.platform === 'win32' && existsSync(BLENDER)

const lancer = (args) =>
  spawnSync(process.execPath, [SCRIPT, '--bureau', BUREAU, ...args], {
    encoding: 'utf8',
    timeout: 240_000
  })

describe('blender-mcp-verifier', () => {
  it('refuse (code 3) quand le port est déjà tenu, sans lancer Blender', async () => {
    const serveur = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => serveur.once('listening', r))
    const port = serveur.address().port
    try {
      const r = await new Promise((resolve) => {
        // asynchrone : le serveur du test doit pouvoir accepter la sonde pendant ce temps
        import('node:child_process').then(({ execFile }) =>
          execFile(process.execPath, [SCRIPT, '--port', String(port)], (e) =>
            resolve(e ? e.code : 0)
          )
        )
      })
      expect(r).toBe(3)
    } finally {
      serveur.close()
    }
  })

  it.skipIf(!avecBlender)(
    'échoue (code 4) sur un port que l’add-on n’ouvre pas',
    () => {
      expect(lancer(['--port', '9877']).status).toBe(4)
    },
    240_000
  )

  it.skipIf(!avecBlender)(
    'prouve la chaîne réelle (code 0) : Blender répond via uvx blender-mcp',
    () => {
      const r = lancer([])
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(r.stdout).toContain('get_scene_info')
    },
    240_000
  )
})
