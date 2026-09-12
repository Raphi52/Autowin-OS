import { describe, expect, it } from 'vitest'
import { attachConversationIds, type RunEntry } from './runs-scan'

const entry = (path: string): RunEntry => ({
  subject: 'sujet',
  session: 'session-x',
  path,
  mtime: 1,
  summary: { status: 'green', dodTotal: 1, dodChecked: 1, journalEvents: 0, defauts: 0 }
})

describe('attachConversationIds', () => {
  it('rattache un run à la conversation dont les runPaths le citent', () => {
    const [rattache, orphelin] = attachConversationIds(
      [entry('C:/runs/a/RUN.md'), entry('C:/runs/b/RUN.md')],
      [{ id: 'conv-491', runPaths: ['C:/runs/a/RUN.md'] }, { id: 'conv-1' }]
    )
    expect(rattache.conversationId).toBe('conv-491')
    expect(orphelin.conversationId).toBeUndefined()
  })

  it('ignore la casse et la forme du chemin', () => {
    const [rattache] = attachConversationIds(
      [entry('C:/runs/a/RUN.md')],
      [{ id: 'conv-7', runPaths: ['c:\\runs\\a\\RUN.md'] }]
    )
    expect(rattache.conversationId).toBe(process.platform === 'win32' ? 'conv-7' : undefined)
  })

  it('laisse les entrées intactes sans aucun runPath connu', () => {
    const entries = [entry('C:/runs/a/RUN.md')]
    expect(attachConversationIds(entries, [{ id: 'conv-1' }])).toBe(entries)
  })
})
