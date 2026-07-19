import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { listHermesControls } from './hermes-controls'

export interface LoopSkillItem {
  id: string
  label: string
  description: string
  source: 'autowin' | 'global'
  role: 'phase' | 'capability' | 'gate' | 'meta'
}

interface ResolvedLoopSkill extends LoopSkillItem {
  path: string
}

function discoverSkillFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'SKILL.md') files.push(path)
    }
  }
  visit(root)
  return files
}

function metadata(path: string, source: LoopSkillItem['source']): ResolvedLoopSkill {
  const header = readFileSync(path, 'utf8').slice(0, 4096)
  const fallback = basename(dirname(path))
  const label = /^name:\s*["']?([^\r\n"']+)/m.exec(header)?.[1].trim() || fallback
  const description =
    /^description:\s*["']?([^\r\n"']+)/m.exec(header)?.[1].trim() || 'Sans description'
  const declaredRole = /^loop-role:\s*(phase|capability|gate|meta)\s*$/mi.exec(header)?.[1]
  const normalized = label.toLowerCase()
  const role = (declaredRole ??
    (['clean', 'judge'].includes(normalized) ? 'gate' :
      normalized === 'kaizen' ? 'meta' :
        source === 'global' || ['see', 'graphify', 'front-converge'].includes(normalized)
          ? 'capability'
          : 'phase')) as LoopSkillItem['role']
  return { id: `${source}:${label}`, label, description, source, role, path }
}

async function manifest(): Promise<ResolvedLoopSkill[]> {
  const user = homedir()
  const localAppData = process.env.LOCALAPPDATA ?? join(user, 'AppData', 'Local')
  const autowin = discoverSkillFiles(join(user, '.claude', 'skills')).map((path) =>
    metadata(path, 'autowin')
  )
  const enabled = new Set(
    (await listHermesControls('skills')).filter((skill) => skill.enabled).map((skill) => skill.id)
  )
  const globalCandidates = [
    ...discoverSkillFiles(join(localAppData, 'hermes', 'skills')),
    ...discoverSkillFiles(join(localAppData, 'hermes', 'hermes-agent', 'skills'))
  ].map((path) => metadata(path, 'global'))
  const globalByName = new Map<string, ResolvedLoopSkill>()
  for (const skill of globalCandidates) {
    if (enabled.has(skill.label) && !globalByName.has(skill.label))
      globalByName.set(skill.label, skill)
  }
  return [...autowin, ...globalByName.values()].sort((a, b) =>
    a.source === b.source ? a.label.localeCompare(b.label) : a.source === 'autowin' ? -1 : 1
  )
}

export async function listLoopSkills(): Promise<LoopSkillItem[]> {
  return (await manifest()).map(({ id, label, description, source, role }) => ({
    id,
    label,
    description,
    source,
    role
  }))
}

export async function readLoopSkills(ids: Iterable<string>): Promise<Map<string, string>> {
  const skills = await manifest()
  const byId = new Map(skills.map((skill) => [skill.id, skill.path]))
  return new Map(
    [...new Set(ids)].map((id) => {
      const path = byId.get(id)
      if (!path) throw new Error(`Skill de loop inconnue : ${id}`)
      return [id, readFileSync(path, 'utf8')]
    })
  )
}
