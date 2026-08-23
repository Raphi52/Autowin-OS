import { describe, expect, it } from 'vitest'
import { conversationEnMarkdown, nomFichierExportMarkdown } from './conversation-markdown'
import type { Msg } from './chat-view-types'

describe('conversationEnMarkdown', () => {
  it('rend le titre, les tours et les textes de l’assistant', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'salut' },
      {
        role: 'assistant',
        parts: [
          { kind: 'text', text: 'bonjour' },
          { kind: 'action', name: 'Bash', ok: true },
          { kind: 'text', text: 'fini' }
        ],
        status: 'completed',
        done: true
      }
    ]
    const md = conversationEnMarkdown({ titre: 'Ma conv', id: 'conv-7', messages })
    expect(md).toContain('# Ma conv')
    expect(md).toContain('conv-7')
    expect(md).toContain('## Utilisateur')
    expect(md).toContain('salut')
    expect(md).toContain('## Assistant')
    expect(md).toContain('bonjour')
    expect(md).toContain('fini')
  })

  it('n’invente pas de contenu quand le tour a échoué : l’erreur est citée telle quelle', () => {
    const md = conversationEnMarkdown({
      titre: 'X',
      id: 'conv-1',
      messages: [
        {
          role: 'assistant',
          parts: [{ kind: 'error', cause: 'turn', message: 'boom' }],
          status: 'failed',
          done: true
        }
      ]
    })
    expect(md).toContain('boom')
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER une conversion fausse : si l'export sérialisait les parts
    // brutes (JSON) au lieu de leur texte, cette assertion tomberait.
    expect(md).not.toContain('"kind"')
  })

  it('liste les pièces jointes de l’utilisateur sans leur contenu', () => {
    const md = conversationEnMarkdown({
      titre: 'X',
      id: 'conv-1',
      messages: [
        {
          role: 'user',
          content: 'regarde',
          attachments: [{ name: 'plan.png', mimeType: 'image/png', size: 12 }]
        }
      ]
    })
    expect(md).toContain('plan.png')
  })

  it('reste valide sur une conversation vide', () => {
    const md = conversationEnMarkdown({ titre: 'Vide', id: 'conv-0', messages: [] })
    expect(md).toContain('# Vide')
    expect(md.trim().endsWith('_(conversation vide)_')).toBe(true)
  })

  it('produit un nom de fichier sûr', () => {
    expect(nomFichierExportMarkdown('Ma conv / test ?', 'conv-7')).toBe('ma-conv-test-conv-7.md')
    expect(nomFichierExportMarkdown('', 'conv-7')).toBe('conversation-conv-7.md')
  })
})
