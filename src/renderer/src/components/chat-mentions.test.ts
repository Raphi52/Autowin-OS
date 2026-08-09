import { describe, expect, it } from 'vitest'
import {
  buildMentionSources,
  activeMentionQuery,
  applyMention,
  collectMentionRefs,
  matchMentions,
  resolveMentionsForSend,
  type MentionSources
} from './chat-mentions'

const SOURCES: MentionSources = {
  runs: [
    {
      kind: 'run',
      id: 'workflow-bench-regression',
      label: 'workflow-bench-regression',
      hint: 'bloqué'
    },
    { kind: 'run', id: 'chatview-reprise-tours', label: 'chatview-reprise-tours', hint: 'bloqué' }
  ],
  files: [{ kind: 'file', id: 'src/renderer/src/components/ChatView.tsx', label: 'ChatView.tsx' }]
}

describe('activeMentionQuery', () => {
  it('détecte une mention en début de mot', () => {
    expect(activeMentionQuery('corrige @work')).toEqual({ start: 8, query: 'work' })
  })
  it('ignore un @ collé à un mot (email)', () => {
    expect(activeMentionQuery('raphael@amitel.fr')).toBeNull()
  })
  it('ferme la mention dès un blanc', () => {
    expect(activeMentionQuery('@run bidule')).toBeNull()
  })
})

describe('matchMentions', () => {
  it('liste les runs en mémoire pour @work', () => {
    const items = matchMentions('debug @work', SOURCES)
    expect(items.map((i) => i.id)).toEqual(['workflow-bench-regression'])
  })
  it('restreint aux fichiers avec le préfixe @fichier:', () => {
    const items = matchMentions('@fichier:Chat', SOURCES)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('file')
  })
  it('ne propose rien hors mention', () => {
    expect(matchMentions('aucune mention ici', SOURCES)).toEqual([])
  })
})

describe('applyMention', () => {
  it('remplace la frappe par la référence résolue', () => {
    const { text, caret } = applyMention('debug @work', SOURCES.runs[0])
    expect(text).toBe('debug @run:workflow-bench-regression ')
    expect(caret).toBe(text.length)
  })
  it('préserve le texte après le curseur', () => {
    const input = 'debug @work et rien d’autre'
    const { text } = applyMention(input, SOURCES.runs[0], 11)
    expect(text).toBe('debug @run:workflow-bench-regression  et rien d’autre')
  })
})

describe('resolveMentionsForSend', () => {
  it('annexe un bloc de contexte pour chaque cible désignée', () => {
    const sent = resolveMentionsForSend(
      'Débloque @run:workflow-bench-regression dans @fichier:src/renderer/src/components/ChatView.tsx',
      SOURCES
    )
    expect(sent).toContain('[contexte désigné]')
    expect(sent).toContain('- run workflow-bench-regression (bloqué)')
    expect(sent).toContain('- fichier src/renderer/src/components/ChatView.tsx')
  })
  it('laisse un prompt sans mention strictement inchangé', () => {
    expect(resolveMentionsForSend('bonjour', SOURCES)).toBe('bonjour')
  })
  it('dédoublonne les références répétées', () => {
    expect(collectMentionRefs('@run:a @run:a', SOURCES)).toHaveLength(1)
  })
})

describe('buildMentionSources', () => {
  it('dérive les runs et les chemins cités sans IPC', () => {
    const s = buildMentionSources({
      runs: [{ subject: 'workflow-bench-regression', summary: { status: 'open' } }],
      attachments: [{ name: 'capture.png' }],
      citedTexts: ['modifie src/renderer/src/components/ChatView.tsx stp']
    })
    expect(s.runs[0]).toMatchObject({ id: 'workflow-bench-regression', hint: 'open' })
    expect(s.files.map((f) => f.id)).toEqual([
      'capture.png',
      'src/renderer/src/components/ChatView.tsx'
    ])
  })
  it('rend des sources vides pour un état vide', () => {
    expect(buildMentionSources({})).toEqual({ runs: [], files: [] })
  })
})
