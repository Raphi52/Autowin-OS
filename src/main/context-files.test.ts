import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectContext, projectContextBlock } from './context-files'

describe('context-files — souveraineté (chaîne de précédence)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctxfiles-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rend null quand aucun fichier de contexte (cas courant)', () => {
    expect(loadProjectContext(dir)).toBeNull()
    expect(projectContextBlock(dir)).toBe('')
  })

  it('premier-trouvé-gagne : AGENTS.md prime sur CLAUDE.md, jamais empilé', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'depuis agents')
    writeFileSync(join(dir, 'CLAUDE.md'), 'depuis claude')
    const ctx = loadProjectContext(dir)
    expect(ctx?.file).toBe('AGENTS.md')
    expect(ctx?.content).toBe('depuis agents')
    // le bloc ne contient QUE le gagnant, pas l'autre
    const block = projectContextBlock(dir)
    expect(block).toContain('AGENTS.md')
    expect(block).not.toContain('depuis claude')
  })

  it('.hermes.md prime sur AGENTS.md', () => {
    writeFileSync(join(dir, '.hermes.md'), 'hermes maison')
    writeFileSync(join(dir, 'AGENTS.md'), 'agents')
    expect(loadProjectContext(dir)?.file).toBe('.hermes.md')
  })

  it('retombe sur CLAUDE.md si AGENTS.md absent', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'claude seul')
    expect(loadProjectContext(dir)?.file).toBe('CLAUDE.md')
  })

  it('ignore un fichier vide et passe au suivant', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '   \n  ')
    writeFileSync(join(dir, 'CLAUDE.md'), 'contenu réel')
    expect(loadProjectContext(dir)?.file).toBe('CLAUDE.md')
  })

  it('tronque au plafond (ASCII)', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(100))
    const ctx = loadProjectContext(dir, undefined, 10)
    expect(ctx?.content.startsWith('xxxxxxxxxx')).toBe(true)
    expect(ctx?.content).toContain('tronqué')
  })

  it('C1 — mesure en BYTES : contenu accentué < plafond en chars mais > en bytes → tronque', () => {
    // 20 'é' = 20 chars UTF-16 mais 40 bytes UTF-8. Plafond 30 bytes : doit tronquer (l'ancien
    // code sur raw.length=20 < 30 n'aurait PAS tronqué → régression prouvée).
    writeFileSync(join(dir, 'AGENTS.md'), 'é'.repeat(20))
    const ctx = loadProjectContext(dir, undefined, 30)
    expect(ctx?.content).toContain('tronqué')
    // C2 — pas de caractère de remplacement isolé en fin (troncature propre sur frontière char)
    expect(ctx?.content).not.toContain('�')
  })

  it('le bloc étiquette le fichier gagnant pour la traçabilité', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'régles projet')
    expect(projectContextBlock(dir)).toBe('\n=== CONTEXTE PROJET (CLAUDE.md) ===\nrégles projet\n')
  })
})
