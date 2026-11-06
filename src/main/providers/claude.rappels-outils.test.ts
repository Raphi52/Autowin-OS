import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { definirDossierModsAutowin, scriptDesGardesCourant } from './claude'

/*
 * Le script de garde ÉCRIT POUR CHAQUE AGENT (`scriptDesGardesCourant`, le même que
 * `rafraichirGardesDesAgents` réécrit au démarrage) lit les rappels du mod Autowin chargé. Sans ce
 * branchement, la fonction marche dans ses tests mais aucun agent ne reçoit jamais un rappel.
 */
const MOD_DU_DEPOT = join(__dirname, '..', '..', '..', 'mods', 'autowin')
let dir: string | undefined

afterEach(() => {
  definirDossierModsAutowin(undefined)
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const lancer = (): string => {
  dir = mkdtempSync(join(tmpdir(), 'rappels-agent-'))
  const script = join(dir, 'garde-git-destructeur.mjs')
  writeFileSync(script, scriptDesGardesCourant(), 'utf8')
  const env = { ...process.env }
  delete env.AUTOWIN_CONVERSATION_ID
  delete env.AUTOWIN_HDESK_ID
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'cat .autowin-data/autowin-os/conversations.json' }
    }),
    encoding: 'utf8',
    env
  }).stdout
}

describe('script de garde des agents : rappels au bon moment', () => {
  it('le mod Autowin connu → le rappel de mods/autowin/rappels-outils.json part', () => {
    definirDossierModsAutowin(MOD_DU_DEPOT)
    const sortie = lancer()
    expect(JSON.parse(sortie).hookSpecificOutput.additionalContext).toContain('conversation_read')
  })

  it('mod Autowin inconnu → aucun rappel, aucune sortie', () => {
    definirDossierModsAutowin(undefined)
    expect(lancer()).toBe('')
  })
})
