import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildGeminiPrompt,
  buildGeminiArgs,
  GeminiCliAdapter,
  isAntigravityAuthProbe,
  resolveGeminiCommand
} from './gemini'

/** Blocages d'environnement (hors code) qui rendent la sonde live non concluante. */
const ENVIRONMENT_BLOCKER =
  /quota|rate limit|please (log|sign) in|veuillez vous (connecter|authentifier)|not authenticated|unauthorized|login required|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i

type Reachability = { reachable: boolean; reason: string }

/** Sonde de joignabilité du CLI officiel : n'affirme rien sur l'auth, mesure juste l'environnement. */
async function probeGeminiCli(): Promise<Reachability> {
  const command = resolveGeminiCommand()
  if (command.executable !== 'agy' && !existsSync(command.executable))
    return { reachable: false, reason: `skip: CLI absent (${command.executable})` }
  return await new Promise<Reachability>((resolve) => {
    let settled = false
    const done = (value: Reachability): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    const probeArgs = buildGeminiArgs(
      [{ role: 'user', content: 'Réponds exactement AUTOWIN_AUTH_OK' }],
      {
        model: 'Gemini 3.5 Flash (Low)',
        system: 'Réponds sans outil.'
      }
    )
    const child = spawn(command.executable, [...command.prefix, ...probeArgs], {
      shell: false,
      windowsHide: true
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    const timer = setTimeout(() => {
      child.kill()
      done({ reachable: false, reason: 'skip: CLI injoignable (timeout sonde)' })
    }, 20_000)
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      done({ reachable: false, reason: `skip: CLI injoignable (${error.message})` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const blocker = output.match(ENVIRONMENT_BLOCKER)?.[0]
      if (blocker) done({ reachable: false, reason: `skip: blocage environnement « ${blocker} »` })
      // Sonde concluante OU échec inexpliqué : on laisse l'assertion réelle trancher.
      else done({ reachable: true, reason: code === 0 ? 'CLI joignable' : `sonde code ${code}` })
    })
  })
}

const geminiCliReachability = await probeGeminiCli()

describe('GeminiCliAdapter — contrat compte Google via CLI officiel', () => {
  it('matérialise le système et le fil sans dupliquer les messages system', () => {
    const prompt = buildGeminiPrompt(
      [
        { role: 'system', content: 'ancien système' },
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: 'Salut' }
      ],
      'Réponds en français.'
    )
    expect(prompt).toContain('INSTRUCTIONS SYSTEME AUTOWIN OS')
    expect(prompt).toContain('Réponds en français.')
    expect(prompt).toContain('UTILISATEUR:\nBonjour')
    expect(prompt).toContain('ASSISTANT:\nSalut')
    expect(prompt).not.toContain('ancien système')
  })

  it('force le mode plan sandboxé et ne transmet aucun mode mutateur', () => {
    const args = buildGeminiArgs([{ role: 'user', content: 'Bonjour' }], {
      model: 'Gemini 3.5 Flash (Low)'
    })
    expect(args).toEqual(
      expect.arrayContaining(['--print', expect.any(String), '--mode', 'plan', '--sandbox'])
    )
    expect(args).not.toContain('yolo')
    expect(args).not.toContain('auto_edit')
  })

  it('ne déclare le compte connecté que sur la réponse exacte de la micro-sonde', () => {
    expect(isAntigravityAuthProbe(0, 'AUTOWIN_AUTH_OK\n')).toBe(true)
    expect(isAntigravityAuthProbe(0, 'Veuillez vous connecter')).toBe(false)
    expect(isAntigravityAuthProbe(1, 'AUTOWIN_AUTH_OK')).toBe(false)
  })

  it('résout le binaire Antigravity officiel sous Windows sans shell', () => {
    expect(resolveGeminiCommand(undefined, { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })).toEqual({
      executable: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
      prefix: []
    })
  })

  // Couverture live conservée : l'assertion réelle tourne dès que le CLI est joignable ; on ne
  // saute que sur un blocage d'ENVIRONNEMENT identifié (binaire absent, quota, compte déconnecté,
  // réseau) — un échec de sonde non expliqué reste un échec, jamais un skip silencieux.
  it.skipIf(!geminiCliReachability.reachable)(
    `détecte que le CLI officiel installé est joignable (${geminiCliReachability.reason})`,
    async () => {
      await expect(new GeminiCliAdapter().auth()).resolves.toBe(true)
    },
    20_000
  )

  it('refuse un signal déjà annulé avant de lancer le processus', async () => {
    const controller = new AbortController()
    controller.abort()
    const generator = new GeminiCliAdapter().send([{ role: 'user', content: 'test' }], {
      signal: controller.signal
    })
    await expect(generator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('transforme une annulation en vol en AbortError, jamais en réponse vide réussie', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/slow-provider.mjs', import.meta.url))
    const controller = new AbortController()
    const generator = new GeminiCliAdapter({
      command: { executable: process.execPath, prefix: [fixture] },
      timeoutMs: 15_000
    }).send([{ role: 'user', content: 'test' }], { signal: controller.signal })
    const pending = generator.next()
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
