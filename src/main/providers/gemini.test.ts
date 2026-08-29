import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  buildGeminiPrompt,
  buildGeminiArgs,
  GeminiCliAdapter,
  isAntigravityAuthProbe,
  resolveGeminiCommand
} from './gemini'

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

  it('aligne aussi le timeout natif Antigravity sur le devis orchestré', () => {
    const args = buildGeminiArgs([{ role: 'user', content: 'Travail long' }], {
      execution: {
        cwd: process.cwd(),
        sandbox: 'read-only',
        providerTimeoutMs: 7_200_000
      }
    })
    expect(args.slice(args.indexOf('--print-timeout'))).toEqual(['--print-timeout', '120m'])
  })

  it('ne déclare le compte connecté que sur la réponse exacte de la micro-sonde', () => {
    expect(isAntigravityAuthProbe(0, 'AUTOWIN_AUTH_OK\n')).toBe(true)
    expect(isAntigravityAuthProbe(0, 'Veuillez vous connecter')).toBe(false)
    expect(isAntigravityAuthProbe(1, 'AUTOWIN_AUTH_OK')).toBe(false)
  })

  it('résout le binaire Antigravity officiel sous Windows sans shell', () => {
    expect(
      resolveGeminiCommand(undefined, { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })
    ).toEqual({
      executable: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
      prefix: []
    })
  })

  it('détecte une authentification valide via le vrai cycle de vie du transport', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/gemini-auth-provider.mjs', import.meta.url))
    await expect(
      new GeminiCliAdapter({
        command: { executable: process.execPath, prefix: [fixture] }
      }).auth()
    ).resolves.toBe(true)
  })

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

describe('GeminiCliAdapter — exécution outillée gratuite (Antigravity accept-edits)', () => {
  const execution = {
    cwd: process.cwd(),
    sandbox: 'workspace-write' as const,
    providerTimeoutMs: 600_000
  }

  it('déclare supporter l’exécution pour ne plus retomber sur le quota payant', () => {
    expect(new GeminiCliAdapter().supportsExecution).toBe(true)
  })

  it('passe en mode mutateur outillé quand le run demande une écriture workspace', () => {
    const args = buildGeminiArgs([{ role: 'user', content: 'Corrige le bug' }], {
      execution
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '--mode',
        'accept-edits',
        '--dangerously-skip-permissions',
        '--add-dir',
        execution.cwd
      ])
    )
    expect(args).not.toContain('--sandbox')
  })

  it('retire l’interdiction d’outils du prompt uniquement en exécution', () => {
    const executing = buildGeminiArgs([{ role: 'user', content: 'Corrige' }], { execution })
    expect(executing[1]).not.toContain('N’utilise aucun outil')
    expect(executing[1]).toContain('modifie les fichiers')
  })

  // Entrée témoin : si la correction était fausse (mode mutateur appliqué partout),
  // CE cas — chat sans execution — passerait en accept-edits et le test virerait au rouge.
  it('laisse le chat sans exécution strictement en plan sandboxé', () => {
    const args = buildGeminiArgs([{ role: 'user', content: 'Bonjour' }], {})
    expect(args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(args).not.toContain('accept-edits')
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args[1]).toContain('N’utilise aucun outil')
  })

  // Entrée témoin n°2 : une exécution read-only ne doit JAMAIS ouvrir l'écriture.
  it('garde le mode plan pour une exécution read-only', () => {
    const args = buildGeminiArgs([{ role: 'user', content: 'Analyse' }], {
      execution: { ...execution, sandbox: 'read-only' as const }
    })
    expect(args).toEqual(expect.arrayContaining(['--mode', 'plan']))
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('exécute dans le cwd du run, pas dans un sandbox temporaire jetable', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/gemini-cwd-provider.mjs', import.meta.url))
    const generator = new GeminiCliAdapter({
      command: { executable: process.execPath, prefix: [fixture] }
    }).send([{ role: 'user', content: 'où suis-je' }], { execution })
    let text = ''
    for await (const chunk of generator) text += chunk.delta ?? ''
    expect(text).toContain(execution.cwd)
  })
})
