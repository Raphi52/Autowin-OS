import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertBrainVaultRoot,
  INBOX_NEAR_DUP_SIMILARITY,
  listInboxCandidates,
  promoteInboxCandidate,
  rejectInboxCandidate,
  textSimilarity
} from './brain-inbox'

let root = ''

function note(relative: string, content: string): void {
  const file = join(root, relative)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brain-inbox-'))
  mkdirSync(join(root, 'inbox'), { recursive: true })
  mkdirSync(join(root, 'knowledge'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listInboxCandidates — les candidats de inbox/ deviennent enfin actionnables', () => {
  it('liste les candidats avec titre, type, portée et corps', () => {
    note(
      'inbox/2026-08-01-promotion.md',
      `---\ntype: lesson\nscope: autowin-os\nsource: git:src/main/index.ts@abc1234\ndate: 2026-08-01\n---\n\n# Promouvoir depuis la vue\n\nLa promotion reste humaine.\n`
    )
    const [candidate] = listInboxCandidates(root, { now: new Date('2026-08-11T00:00:00Z') })
    expect(candidate.id).toBe('inbox/2026-08-01-promotion')
    expect(candidate.title).toBe('Promouvoir depuis la vue')
    expect(candidate.type).toBe('lesson')
    expect(candidate.scope).toBe('autowin-os')
    expect(candidate.body).toContain('La promotion reste humaine.')
  })

  it('ignore ce qui n’est pas dans inbox/ — knowledge/ reste INTACT', () => {
    note('inbox/a.md', '# A\n')
    note('knowledge/b.md', '# B\n')
    expect(listInboxCandidates(root).map((c) => c.id)).toEqual(['inbox/a'])
  })

  it('datte le candidat et calcule son âge en jours (item 5)', () => {
    note('inbox/vieux.md', `---\ndate: 2026-08-01\n---\n\n# Vieux\n`)
    const [candidate] = listInboxCandidates(root, { now: new Date('2026-08-11T00:00:00Z') })
    expect(candidate.depositedAt).toBe('2026-08-01')
    expect(candidate.ageDays).toBe(10)
  })

  it('normalise le locator git:...@sha et signale un sha OBSOLÈTE (item 5)', () => {
    note('inbox/a.md', `---\nsource: git:src/main/index.ts@deadbeef\n---\n\n# A\n`)
    note('inbox/b.md', `---\nsource: git:src/main/index.ts@cafe999\n---\n\n# B\n`)
    const candidates = listInboxCandidates(root, {
      headShaFor: (path) => (path === 'src/main/index.ts' ? 'deadbeefffff' : undefined)
    })
    const a = candidates.find((c) => c.id === 'inbox/a')
    const b = candidates.find((c) => c.id === 'inbox/b')
    expect(a?.source?.scheme).toBe('git')
    expect(a?.source?.path).toBe('src/main/index.ts')
    expect(a?.source?.sha).toBe('deadbeef')
    expect(a?.source?.shaState).toBe('current')
    expect(b?.source?.shaState).toBe('stale')
    expect(a?.source?.problem).toBeUndefined()
  })

  it('signale un locator NON traçable sans le réécrire', () => {
    note('inbox/a.md', `---\nsource: C:\\ged2\\note.md\n---\n\n# A\n`)
    const [candidate] = listInboxCandidates(root)
    expect(candidate.source?.problem).toMatch(/préfixe manquant/)
    expect(candidate.source?.locator).toBe('C:\\ged2\\note.md')
  })

  it('un sha absent du locator n’est ni « à jour » ni « obsolète »', () => {
    note('inbox/a.md', `---\nsource: meeting:2026-08-01\n---\n\n# A\n`)
    const [candidate] = listInboxCandidates(root)
    expect(candidate.source?.shaState).toBe('absent')
  })
})

describe('doublon proche à l’écriture (item 6) — inbox/ n’est pas dédoublonnée côté serveur', () => {
  it('apparie deux quasi-jumeaux de inbox/ au-dessus du seuil', () => {
    const body = 'La promotion des candidats inbox reste une décision humaine dans Autowin OS.'
    note('inbox/09h47.md', `# Promotion humaine\n\n${body}\n`)
    note('inbox/09h48.md', `# Promotion humaine\n\n${body} Vraiment.\n`)
    const candidates = listInboxCandidates(root)
    const first = candidates.find((c) => c.id === 'inbox/09h47')
    expect(first?.nearDuplicates[0]?.id).toBe('inbox/09h48')
    expect(first?.nearDuplicates[0]?.zone).toBe('inbox')
    expect(first?.nearDuplicates[0]?.similarity).toBeGreaterThanOrEqual(INBOX_NEAR_DUP_SIMILARITY)
  })

  it('apparie aussi un candidat au savoir CANONIQUE déjà promu', () => {
    const body = 'Le budget injecte plafonne la question a cinq cents caracteres exactement ici.'
    note('inbox/nouveau.md', `# Budget\n\n${body}\n`)
    note('knowledge/budget.md', `# Budget\n\n${body}\n`)
    const [candidate] = listInboxCandidates(root)
    expect(candidate.nearDuplicates[0]).toMatchObject({ id: 'knowledge/budget', zone: 'knowledge' })
  })

  it('deux faits DIFFÉRENTS ne sont pas appariés', () => {
    note('inbox/a.md', '# A\n\nLe serveur Brain ecoute sur le port loopback huit sept six cinq.\n')
    note('inbox/b.md', '# B\n\nLes largeurs de colonne sont persistees dans le stockage local.\n')
    expect(listInboxCandidates(root)[0].nearDuplicates).toEqual([])
  })

  it('textSimilarity est bornée et symétrique', () => {
    expect(textSimilarity('abc def', 'abc def')).toBe(1)
    expect(textSimilarity('abc', 'xyz')).toBe(0)
    expect(textSimilarity('abc def', 'def abc ghi')).toBe(textSimilarity('def abc ghi', 'abc def'))
  })
})

describe('promouvoir / rejeter — le fichier BOUGE, la promotion reste humaine', () => {
  it('promouvoir déplace le candidat de inbox/ vers knowledge/', () => {
    note('inbox/a.md', '# A\n\ncorps\n')
    const moved = promoteInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('knowledge/a')
    expect(readdirSync(join(root, 'inbox'))).toEqual([])
    expect(readdirSync(join(root, 'knowledge'))).toEqual(['a.md'])
  })

  it('promouvoir ne PIÉTINE pas une fiche canonique homonyme', () => {
    note('inbox/a.md', '# candidat\n')
    note('knowledge/a.md', '# canonique\n')
    const moved = promoteInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('knowledge/a-2')
    expect(readdirSync(join(root, 'knowledge')).sort()).toEqual(['a-2.md', 'a.md'])
  })

  it('rejeter déplace vers .trash/ — jamais de suppression définitive', () => {
    note('inbox/a.md', '# A\n')
    const moved = rejectInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('.trash/a')
    expect(readdirSync(join(root, 'inbox'))).toEqual([])
    expect(readdirSync(join(root, '.trash'))).toEqual(['a.md'])
  })

  it('refuse tout id hors de inbox/ — y compris une traversée', () => {
    note('knowledge/b.md', '# B\n')
    expect(() => promoteInboxCandidate(root, 'knowledge/b')).toThrow(/inbox/)
    expect(() => promoteInboxCandidate(root, 'inbox/../knowledge/b')).toThrow(/inbox/)
    expect(() => rejectInboxCandidate(root, '../evade')).toThrow(/inbox/)
    // knowledge/ est resté intact malgré les trois refus.
    expect(readdirSync(join(root, 'knowledge'))).toEqual(['b.md'])
  })

  it('refuse un candidat inexistant sans rien créer', () => {
    expect(() => promoteInboxCandidate(root, 'inbox/fantome')).toThrow(/introuvable/)
    expect(readdirSync(join(root, 'knowledge'))).toEqual([])
  })
})

describe('assertBrainVaultRoot — un canal IPC accepte n’importe quelle chaîne', () => {
  it('accepte la racine autorisée, quelle que soit l’écriture des séparateurs', () => {
    expect(assertBrainVaultRoot(root, root)).toBe(root)
    expect(assertBrainVaultRoot(`${root}\\`, root)).toBe(`${root}\\`)
  })

  it('refuse toute autre racine', () => {
    expect(() => assertBrainVaultRoot(join(root, 'inbox'), root)).toThrow(/hors périmètre/)
    expect(() => assertBrainVaultRoot('C:/Windows', root)).toThrow(/hors périmètre/)
  })
})
