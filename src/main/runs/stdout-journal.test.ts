import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, closeSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openStdoutJournal,
  readChunkFrom,
  splitCompleteLines,
  stdoutJournalPath,
  tailJsonLines
} from './stdout-journal'

let root = mkdtempSync(join(tmpdir(), 'stdoutjournal-'))
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  root = mkdtempSync(join(tmpdir(), 'stdoutjournal-'))
})

describe('stdout-journal — écriture', () => {
  it('ouvre un journal append et rend un fd utilisable', () => {
    const handle = openStdoutJournal(root, 'run-1')
    appendFileSync(handle.path, '{"a":1}\n', 'utf8')
    closeSync(handle.fd)
    expect(readChunkFrom(handle.path, 0).text).toBe('{"a":1}\n')
  })

  it('refuse un identifiant qui s’échapperait du dossier', () => {
    expect(() => stdoutJournalPath(root, '..')).toThrow(/invalide/)
  })
})

describe('splitCompleteLines — ne parse JAMAIS une ligne partielle', () => {
  it('sépare les lignes terminées et garde le reste', () => {
    expect(splitCompleteLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c":'
    })
  })
  it('aucune ligne terminée → tout en reste', () => {
    expect(splitCompleteLines('{"partiel"')).toEqual({ lines: [], rest: '{"partiel"' })
  })
})

describe('readChunkFrom — lecture incrémentale', () => {
  it('ne relit pas ce qui a déjà été consommé', () => {
    const path = join(root, 'a.jsonl')
    writeFileSync(path, 'un\n', 'utf8')
    const first = readChunkFrom(path, 0)
    expect(first.text).toBe('un\n')
    appendFileSync(path, 'deux\n', 'utf8')
    const second = readChunkFrom(path, first.next)
    expect(second.text).toBe('deux\n')
  })
  it('fichier absent → vide (pas d’exception)', () => {
    expect(readChunkFrom(join(root, 'nope'), 0)).toEqual({ text: '', next: 0 })
  })
})

describe('tailJsonLines — suit un fichier qui grossit', () => {
  it('livre les lignes écrites APRÈS le début du tail, puis s’arrête quand le producteur a fini', async () => {
    const path = join(root, 'live.jsonl')
    writeFileSync(path, '', 'utf8')
    const seen: string[] = []
    let producerDone = false

    const tail = tailJsonLines(path, (line) => seen.push(line), {
      pollMs: 20,
      isComplete: () => producerDone
    })
    // Producteur : écrit par morceaux, dont une ligne coupée en deux (cas réel d'un CLI).
    appendFileSync(path, '{"kind":"delta","t":"a"}\n', 'utf8')
    appendFileSync(path, '{"kind":"delta","t":', 'utf8')
    await new Promise((r) => setTimeout(r, 60))
    appendFileSync(path, '"b"}\n{"kind":"done"}\n', 'utf8')
    producerDone = true

    const result = await tail
    expect(seen).toEqual([
      '{"kind":"delta","t":"a"}',
      '{"kind":"delta","t":"b"}',
      '{"kind":"done"}'
    ])
    expect(result.stopped).toBe(false)
    expect(result.offset).toBeGreaterThan(0)
  })

  it('REPREND depuis un offset (relance après fermeture de l’app)', async () => {
    const path = join(root, 'resume.jsonl')
    writeFileSync(path, '{"n":1}\n{"n":2}\n', 'utf8')
    const first = readChunkFrom(path, 0)
    appendFileSync(path, '{"n":3}\n', 'utf8')

    const seen: string[] = []
    await tailJsonLines(path, (line) => seen.push(line), {
      from: first.next,
      pollMs: 20,
      isComplete: () => true
    })
    expect(seen).toEqual(['{"n":3}']) // les 2 premières lignes ne sont pas rejouées
  })

  it('livre une dernière ligne SANS \\n (process tué net)', async () => {
    const path = join(root, 'killed.jsonl')
    writeFileSync(path, '{"kind":"delta"}\n{"kind":"partiel"}', 'utf8')
    const seen: string[] = []
    await tailJsonLines(path, (line) => seen.push(line), { pollMs: 20, isComplete: () => true })
    expect(seen).toEqual(['{"kind":"delta"}', '{"kind":"partiel"}'])
  })

  it('MÉCANIQUE RÉELLE : process DÉTACHÉ écrivant dans le journal, suivi par le tail', async () => {
    const { spawn } = await import('node:child_process')
    const handle = openStdoutJournal(root, 'real-run')
    // Vrai process détaché dont stdout/stderr vont dans le FICHIER (pas un pipe) : c'est exactement
    // le montage utilisé par le provider en mode survie niveau 2.
    const child = spawn(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify({kind:"delta",t:"a"})+"\\n");' +
          'process.stdout.write(JSON.stringify({kind:"done"})+"\\n")'
      ],
      { detached: true, stdio: ['ignore', handle.fd, handle.fd] }
    )
    child.unref()
    closeSync(handle.fd) // le parent lâche son fd ; l'enfant garde le sien et écrit quand même
    let exited = false
    child.on('close', () => {
      exited = true
    })

    const seen: string[] = []
    await tailJsonLines(handle.path, (line) => seen.push(line), {
      pollMs: 40,
      isComplete: () => exited
    })
    expect(seen.map((l) => JSON.parse(l).kind)).toEqual(['delta', 'done'])
  }, 20_000)

  it('abort → arrêt immédiat, offset rendu', async () => {
    const path = join(root, 'abort.jsonl')
    writeFileSync(path, '{"n":1}\n', 'utf8')
    const controller = new AbortController()
    controller.abort()
    const result = await tailJsonLines(path, () => {}, { signal: controller.signal, pollMs: 20 })
    expect(result.stopped).toBe(true)
  })
})
