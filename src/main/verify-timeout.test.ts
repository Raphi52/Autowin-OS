import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { verifyTimeoutMs, VERIFY_TIMEOUT_MS } from './verify-command'

/**
 * DEFAUT VECU le 22/08 (conv-1363) : `verify` — donc chaque `edit_file`, qui le rejoue dans son
 * bureau isole — lancait la suite du projet SANS AUCUNE HORLOGE. La suite a tourne 6 min 40 ; le
 * pilote etant bloque DANS la commande, il ne drainait plus ses directives : bloc `ask` inerte,
 * prompts « orientes » sans effet, conversation apparemment morte, et rien pour y mettre fin.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : un script `test:unit` qui ne
 * rend JAMAIS la main. Sans horloge, la promesse ne se resout pas et le test expire (rouge) ; le
 * processus lance survit meme au test. Avec, la commande rend un verdict borne, `ok: false`.
 */
const temporaires: string[] = []

afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    // Windows relache le verrou du processus tue avec un temps de retard : le menage est un
    // CONFORT, jamais le verdict. Le faire echouer transformerait un vert en rouge pour une raison
    // sans rapport avec la propriete testee.
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* le dossier temporaire survivra au test, sans consequence */
    }
  }
  delete process.env.AUTOWIN_VERIFY_TIMEOUT_MS
})

function projetQuiNeRendJamaisLaMain(): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-verify-'))
  temporaires.push(racine)
  writeFileSync(
    join(racine, 'package.json'),
    JSON.stringify({
      name: 'suite-sans-fin',
      scripts: { 'test:unit': 'node -e "setInterval(()=>{},1000)"' }
    })
  )
  return racine
}

const busSur = (workspace: string): AppCommandBus =>
  new AppCommandBus({ executionWorkspace: workspace } as never, () => undefined)

describe('verify — une attente sans plafond est un blocage, pas une attente', () => {
  it('arrête la suite au plafond et rend un verdict au lieu de bloquer le tour', async () => {
    process.env.AUTOWIN_VERIFY_TIMEOUT_MS = '4000'
    const racine = projetQuiNeRendJamaisLaMain()

    const result = await busSur(racine).exec('verify')

    expect(result.ok).toBe(true)
    const data = result.data as { ok: boolean; exitCode: number | null; output: string }
    expect(data.ok).toBe(false)
    expect(data.exitCode).toBeNull()
    expect(data.output).toContain('plafond')
  }, 30_000)

  it('plafond par défaut généreux, réglable par l’environnement', () => {
    expect(verifyTimeoutMs({} as NodeJS.ProcessEnv)).toBe(VERIFY_TIMEOUT_MS)
    expect(verifyTimeoutMs({ AUTOWIN_VERIFY_TIMEOUT_MS: '4000' } as never)).toBe(4000)
    expect(verifyTimeoutMs({ AUTOWIN_VERIFY_TIMEOUT_MS: 'zero' } as never)).toBe(VERIFY_TIMEOUT_MS)
  })
})
