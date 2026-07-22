import { randomUUID } from 'node:crypto'

/** Jetons de capacité éphémères (60 s) liés à un sender IPC — garde les diagnostics lecture seule. */
export class DiagnosticCapabilities {
  private readonly values = new Map<string, { senderId: number; expiresAt: number }>()

  issue(senderId: number, now = Date.now()): string {
    const token = randomUUID()
    this.values.set(token, { senderId, expiresAt: now + 60_000 })
    return token
  }

  consume(token: string, senderId: number, now = Date.now()): boolean {
    const capability = this.values.get(token)
    this.values.delete(token)
    return Boolean(capability && capability.senderId === senderId && capability.expiresAt >= now)
  }
}
