/**
 * Un agent du CHAT qui lance un script de capture (roblox-capture-moteur.ps1 d'un autre dépôt, par exemple) n'a
 * pas AUTOWIN_CONVERSATION_ID : le tour de chat pose AUTOWIN_FIL_DU_CHAT à la place (src/main/providers/claude.ts,
 * le hook des agents lit l'autre comme « étape de run »). Le lanceur refusait alors tout bureau (« Fil absent »),
 * et la capture rendait un code d'échec sans image. Il doit prendre le fil du chat quand celui du run manque.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function lancer(env: NodeJS.ProcessEnv, registre: string, id: string) {
  const ps = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-File',
      join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
      '-Id',
      id,
      '-Executable',
      ps,
      '-Travail',
      'test',
      '-Registre',
      registre
    ],
    { encoding: 'utf8', timeout: 60_000, env }
  )
}

// Identifiant déjà pris par un occupant VIVANT (le test lui-même) : le lanceur s'arrête au refus « occupé » (exit 5)
// sans rien ouvrir. Y arriver prouve que le contrôle du fil, fait juste avant, est passé.
function registreOccupe(id: string): string {
  const registre = mkdtempSync(join(tmpdir(), 'hdesk-registre-'))
  writeFileSync(
    join(registre, `${id}.json`),
    JSON.stringify({ id, pid: process.pid, travail: 'autre travail', conversationId: 'conv-000' }),
    'utf8'
  )
  return registre
}

function sansFil(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.AUTOWIN_CONVERSATION_ID
  delete env.AUTOWIN_FIL_DU_CHAT
  return env
}

describe.skipIf(process.platform !== 'win32')('hdesk-lancer : fil du chat', () => {
  it('prend AUTOWIN_FIL_DU_CHAT quand ni -Conversation ni AUTOWIN_CONVERSATION_ID ne sont posés', () => {
    const id = `kzchat${process.pid}`
    const registre = registreOccupe(id)
    try {
      const r = lancer({ ...sansFil(), AUTOWIN_FIL_DU_CHAT: 'conv-617' }, registre, id)
      expect(r.stderr).not.toContain('Fil absent')
      expect(r.status).toBe(5)
    } finally {
      rmSync(registre, { recursive: true, force: true })
    }
  })

  it('refuse toujours un lancement sans aucun fil', () => {
    const id = `kzsansfil${process.pid}`
    const registre = registreOccupe(id)
    try {
      const r = lancer(sansFil(), registre, id)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('Fil absent')
    } finally {
      rmSync(registre, { recursive: true, force: true })
    }
  })
})
