import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { guardBrokenProcessPipes } from './process-stream-guards'

describe('guardBrokenProcessPipes', () => {
  it('absorbe EPIPE sur stdout/stderr quand le parent Electron a fermé ses pipes', () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    guardBrokenProcessPipes(stdout, stderr)
    expect(() => stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow()
    expect(() => stderr.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow()
  })

  it('remonte les autres erreurs au callback de diagnostic', () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const report = vi.fn()
    guardBrokenProcessPipes(stdout, stderr, report)
    const error = Object.assign(new Error('I/O réel'), { code: 'EIO' })
    stdout.emit('error', error)
    expect(report).toHaveBeenCalledWith(error)
  })
})
