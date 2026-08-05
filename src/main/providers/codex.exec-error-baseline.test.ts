import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: (input: { stdin?: string }) => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const child = {
      pid: undefined,
      on(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return child
      },
      once(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return child
      }
    }
    return {
      child,
      spawnToken: 'codex-exit-1-fixture',
      survivable: false,
      release: () => undefined,
      tail: async (onLine: (line: string) => void) => {
        const prompt = input.stdin ?? ''
        const fixture = prompt.includes('sans-diagnostic')
          ? ''
          : prompt.includes('stderr-brut')
            ? 'fatal: ligne non JSON\n'
            : readFileSync(
                new URL('./fixtures/codex-exit-1-command-error.jsonl', import.meta.url),
                'utf8'
              )
        for (const line of fixture.split(/\r?\n/)) if (line.trim()) onLine(line)
        queueMicrotask(() => {
          for (const listener of listeners.get('close') ?? []) listener(1)
        })
        return { offset: Buffer.byteLength(fixture), stopped: false }
      }
    }
  }
}))

import { CodexAdapter } from './codex'

describe('CodexAdapter — baseline exit 1 avec diagnostic JSONL structuré', () => {
  it('remonte le diagnostic de command_execution dans l’exception finale', async () => {
    const previousCodexBin = process.env.CODEX_BIN
    process.env.CODEX_BIN = 'codex-fixture'
    try {
      const stream = new CodexAdapter().send([{ role: 'user', content: 'repro' }], {
        execution: { cwd: process.cwd(), sandbox: 'read-only' }
      })

      await expect(stream.next()).rejects.toThrow('Tests 1 failed | 10 passed')
    } finally {
      if (previousCodexBin === undefined) delete process.env.CODEX_BIN
      else process.env.CODEX_BIN = previousCodexBin
    }
  })

  it('conserve une ligne non JSON dans le stderr borné', async () => {
    const previousCodexBin = process.env.CODEX_BIN
    process.env.CODEX_BIN = 'codex-fixture'
    try {
      const stream = new CodexAdapter().send([{ role: 'user', content: 'stderr-brut' }], {
        execution: { cwd: process.cwd(), sandbox: 'read-only' }
      })
      await expect(stream.next()).rejects.toThrow('stderr=fatal: ligne non JSON')
    } finally {
      if (previousCodexBin === undefined) delete process.env.CODEX_BIN
      else process.env.CODEX_BIN = previousCodexBin
    }
  })

  it('explicite diagnostic-absent quand la terminaison ne fournit aucune cause', async () => {
    const previousCodexBin = process.env.CODEX_BIN
    process.env.CODEX_BIN = 'codex-fixture'
    try {
      const stream = new CodexAdapter().send([{ role: 'user', content: 'sans-diagnostic' }], {
        execution: { cwd: process.cwd(), sandbox: 'read-only' }
      })
      await expect(stream.next()).rejects.toThrow('diagnostic=diagnostic-absent')
    } finally {
      if (previousCodexBin === undefined) delete process.env.CODEX_BIN
      else process.env.CODEX_BIN = previousCodexBin
    }
  })
})
