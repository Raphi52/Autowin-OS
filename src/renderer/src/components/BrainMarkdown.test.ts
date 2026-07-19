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
})
