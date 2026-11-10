import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  imageEnCours,
  maybeUpdateClaudeCli,
  versionInstallee,
  versionPubliee
} from './claude-cli-update'

/**
 * Banc de la mise a jour du CLI Claude — la SOURCE de la liste de modeles. Cas reel du 2026-09-09 :
 * `claude-fable-5-1` n'apparaissait nulle part parce que le binaire installe (2.1.251) ne le
 * contenait pas ; `claude update` (2.1.266) l'a fait apparaitre.
 */
describe('mise a jour automatique du CLI Claude', () => {
  const dirs: string[] = []
  const stamp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-cli-update-'))
    dirs.push(dir)
    return join(dir, 'claude-cli-update.json')
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('lance la mise a jour la premiere fois et rend son dernier message', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      output: 'Checking for updates...\nSuccessfully updated from 2.1.251 to version 2.1.266\n'
    }))
    const path = stamp()

    const result = await maybeUpdateClaudeCli(path, { run, bin: 'claude', now: 1_000 })

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      outcome: 'updated',
      detail: 'Successfully updated from 2.1.251 to version 2.1.266'
    })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ attemptedAt: 1_000 })
  })

  it('ne relance rien tant que la fenetre n’est pas ecoulee', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const path = stamp()

    await maybeUpdateClaudeCli(path, { run, now: 1_000, windowMs: 10_000 })
    const second = await maybeUpdateClaudeCli(path, { run, now: 5_000, windowMs: 10_000 })
    const third = await maybeUpdateClaudeCli(path, { run, now: 20_000, windowMs: 10_000 })

    expect(second).toEqual({ outcome: 'skipped' })
    expect(third.outcome).toBe('updated')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('une mise a jour impossible est un ECHEC NOMME, jamais une exception qui casse le demarrage', async () => {
    const run = vi.fn(async () => {
      throw new Error('CLI introuvable')
    })

    const result = await maybeUpdateClaudeCli(stamp(), { run, now: 1 })

    expect(result).toEqual({ outcome: 'failed', detail: 'CLI introuvable' })
  })

  /*
   * Vécu le 2026-10-01 au redémarrage de 11:40 : « Update failed because claude.exe is in use » —
   * des agents survivants tournaient. Le marqueur, écrit AVANT la tentative, bloquait ensuite toute
   * nouvelle tentative pendant 12 h.
   */
  it('REPORTE sans rien lancer ni marquer tant que le binaire est en cours d’utilisation', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const path = stamp()

    const result = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 5,
      binaireEnUsage: async () => true
    })

    expect(run).not.toHaveBeenCalled()
    expect(result.outcome).toBe('postponed')
    // Aucun marqueur : la tentative suivante n'attend pas 12 h.
    expect(() => readFileSync(path, 'utf8')).toThrow()
    const ensuite = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 6,
      binaireEnUsage: async () => false
    })
    expect(ensuite.outcome).toBe('updated')
  })

  it('lit la sortie de tasklist : une ligne CSV de l’image = en cours ; le message « aucune tâche » = libre', () => {
    expect(
      imageEnCours(
        '"claude.exe","23836","","2","77 520 Ko"\r\n"claude.exe","14896","","2","1 Ko"',
        'claude.exe'
      )
    ).toBe(true)
    expect(
      imageEnCours(
        'Information : aucune tâche en service ne correspond aux critères spécifiés.',
        'claude.exe'
      )
    ).toBe(false)
    expect(imageEnCours('"autre.exe","1","","2","1 Ko"', 'claude.exe')).toBe(false)
  })

  it('le démarrage branche la détection et réessaie plus tard sur un report', () => {
    const source = readFileSync(join(__dirname, '../index.ts'), 'utf8')
    expect(source).toMatch(/binaireEnUsage: claudeExeEnCours/)
    expect(source).toMatch(/resultat\.outcome === 'postponed'/)
  })

  /*
   * Vécu le 2026-11-09 : Fable 5.2 arrive avec le CLI 2.1.321, publié à 20:02. L'app redémarre à
   * 20:47, moins de 12 h après sa dernière tentative (2.1.319, vers 11:47) : rien n'est lancé, et
   * plus rien n'était reprogrammé. Le CLI n'est passé en 2.1.321 qu'au redémarrage de 01:15.
   */
  it('une version publiée jamais tentée passe la fenêtre de 12 h : la mise à jour part tout de suite', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'Successfully updated' }))
    const path = stamp()
    await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 1_000,
      windowMs: 10_000,
      versions: async () => ({ installee: '2.1.318', publiee: '2.1.319' })
    })

    const nouvelle = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 5_000,
      windowMs: 10_000,
      versions: async () => ({ installee: '2.1.319', publiee: '2.1.321' })
    })

    expect(nouvelle.outcome).toBe('updated')
    expect(run).toHaveBeenCalledTimes(2)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      attemptedAt: 5_000,
      publiee: '2.1.321'
    })
  })

  it('la même publication déjà tentée retombe sous la fenêtre : pas de relance en boucle', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'Claude Code is up to date (2.1.319)' }))
    const path = stamp()
    // Canal « stable » ou installation qui n'avance pas : le CLI reste en 2.1.319.
    const versions = async (): Promise<{ installee: string; publiee: string }> => ({
      installee: '2.1.319',
      publiee: '2.1.321'
    })

    await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 1_000,
      windowMs: 10_000,
      versions
    })
    const encore = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 5_000,
      windowMs: 10_000,
      versions
    })

    expect(encore).toEqual({ outcome: 'skipped' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('CLI déjà à la version publiée : rien n’est lancé ni marqué, même fenêtre écoulée', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const path = stamp()

    const result = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 1_000,
      versions: async () => ({ installee: '2.1.321', publiee: '2.1.321' })
    })

    expect(result).toEqual({ outcome: 'skipped' })
    expect(run).not.toHaveBeenCalled()
    expect(() => readFileSync(path, 'utf8')).toThrow()
  })

  it('versions illisibles (hors ligne, autre installation) : la fenêtre de 12 h décide, comme avant', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const path = stamp()
    const versions = async (): Promise<{ installee?: string; publiee?: string }> => ({
      installee: '2.1.319'
    })

    await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 1_000,
      windowMs: 10_000,
      versions
    })
    const second = await maybeUpdateClaudeCli(path, {
      run,
      bin: 'C:/x/claude.exe',
      now: 5_000,
      windowMs: 10_000,
      versions: async () => {
        throw new Error('hors ligne')
      }
    })

    expect(second).toEqual({ outcome: 'skipped' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('lit la version installée dans le paquet npm qui porte le binaire, et rien d’autre', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-cli-paquet-'))
    dirs.push(dir)
    const paquet = join(dir, 'claude-code')
    mkdirSync(join(paquet, 'bin'), { recursive: true })
    writeFileSync(
      join(paquet, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.321' })
    )
    const autre = join(dir, 'autre')
    mkdirSync(join(autre, 'bin'), { recursive: true })
    writeFileSync(
      join(autre, 'package.json'),
      JSON.stringify({ name: 'autowin-os', version: '1.0.0' })
    )

    expect(versionInstallee(join(paquet, 'bin', 'claude.exe'))).toBe('2.1.321')
    expect(versionInstallee(join(autre, 'bin', 'claude.exe'))).toBeUndefined()
    expect(versionInstallee(join(dir, 'absent', 'bin', 'claude.exe'))).toBeUndefined()
  })

  it('lit la version publiée sur le registre npm ; une erreur réseau rend « inconnue »', async () => {
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ version: '2.1.322' })))
    expect(await versionPubliee(fetchOk as unknown as typeof fetch)).toBe('2.1.322')
    expect(String((fetchOk.mock.calls[0] as unknown[])[0])).toBe(
      'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
    )

    const fetchKo = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    })
    expect(await versionPubliee(fetchKo as unknown as typeof fetch)).toBeUndefined()
    const fetch404 = vi.fn(async () => new Response('', { status: 404 }))
    expect(await versionPubliee(fetch404 as unknown as typeof fetch)).toBeUndefined()
  })

  it('l’app revérifie tant qu’elle tourne, pas seulement au démarrage, avec les versions branchées', () => {
    const source = readFileSync(join(__dirname, '../index.ts'), 'utf8')
    expect(source).toMatch(/versions: \(bin\) => versionsDuCliClaude\(bin\)/)
    // Après un résultat qui n'est pas un report, la tentative suivante est quand même programmée.
    expect(source).toMatch(/\? REESSAI_MISE_A_JOUR_CLI_MS\s*:\s*VERIFICATION_CLI_MS/)
  })
})
