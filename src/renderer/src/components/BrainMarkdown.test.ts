import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from './brain-markdown-model'

describe('BrainMarkdown', () => {
  it('sépare le frontmatter du contenu Markdown', () => {
    const result = splitFrontmatter(
      '---\ntype: decision\nproject: RigApplication\ntitle: "Source canonique"\n---\n# Décision\n\nTexte.'
    )

    expect(result.entries).toEqual([
      { key: 'type', value: 'decision' },
      { key: 'project', value: 'RigApplication' },
      { key: 'title', value: 'Source canonique' }
    ])
    expect(result.body).toBe('# Décision\n\nTexte.')
  })

  it('conserve intégralement une note sans frontmatter', () => {
    expect(splitFrontmatter('# Titre\n\n- élément')).toEqual({
      body: '# Titre\n\n- élément',
      entries: []
    })
  })
  it('ignore les collections vides du frontmatter', () => {
    const result = splitFrontmatter(
      '---\nsources: ["file:a.md", "file:b.md"]\nsupersedes: []\nreviewed_by: ["codex"]\n---\n# Note'
    )

    expect(result.entries).toEqual([
      { key: 'sources', value: '["file:a.md", "file:b.md"]' },
      { key: 'reviewed_by', value: '["codex"]' }
    ])
  })

  it('empêche les libellés de métadonnées de se replier lettre par lettre', () => {
    const styles = readFileSync(new URL('./BrainMarkdown.css', import.meta.url), 'utf8')

    expect(styles).toMatch(/\.brain-markdown__meta dt\s*{[^}]*flex:\s*0 0 auto;/s)
    expect(styles).toMatch(/\.brain-markdown__meta dt\s*{[^}]*white-space:\s*nowrap;/s)
    expect(styles).toMatch(/\.brain-markdown__meta dd\s*{[^}]*min-width:\s*0;/s)
  })
})
