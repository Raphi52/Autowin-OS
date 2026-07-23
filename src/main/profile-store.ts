import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Role, RoleBinding } from './roles'
import type { AgentTopology } from './topology'

export interface AutowinProfile {
  schema: 'autowin.profile/v1'
  id: string
  name: string
  description?: string
  updatedAt: string
  topology: AgentTopology
  roles: Record<Role, RoleBinding>
}

export class ProfileStore {
  constructor(private readonly path: string) {}
  list(): AutowinProfile[] {
    if (!existsSync(this.path)) return []
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }
  save(profile: AutowinProfile): AutowinProfile[] {
    const next = [profile, ...this.list().filter((item) => item.id !== profile.id)]
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.path)
    return next
  }
}
