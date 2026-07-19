import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Role, RoleBinding } from './roles'
import { ensureAutowinAppData } from './app-data'

/**
 * Persistance disque de la config modèle-par-rôle (sinon elle se réinitialise à
 * chaque lancement). Garde RoleModelConfig PUR : le load/save vit ici, dans la
 * couche façade. Fichier : %APPDATA%\autowin-os\roles.json.
 */
function rolesPath(): string {
  return join(ensureAutowinAppData(), 'roles.json')
}

function writeBindings(path: string, bindings: Partial<Record<Role, RoleBinding>>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(bindings, null, 2), 'utf8')
}

export function loadRoleBindings(): Partial<Record<Role, RoleBinding>> | undefined {
  const p = rolesPath()
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Partial<Record<Role, RoleBinding>>
  } catch {
    return undefined
  }
}

export function saveRoleBindings(bindings: Record<Role, RoleBinding>): void {
  writeBindings(rolesPath(), bindings)
}
