import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertBrainVaultRoot,
  INBOX_NEAR_DUP_SIMILARITY,
  MAX_INBOX_FILE_BYTES,
  MAX_NEAR_DUPLICATES_PER_CANDIDATE,
  listInboxCandidates,
  promoteInboxCandidate,
  promoteOutcomeLearningCandidate,
  readInboxCandidateBody,
  rejectInboxCandidate,
  restoreTrashedKnowledge,
  retractKnowledgeCandidate,
  supersedeKnowledgeCandidate
} from './brain-inbox'
import { resolveHeadShas } from './brain-source-sha'

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

  it.each(['inbox', 'knowledge'])(
    'refuse une racine de lecture %s qui est une junction externe',
    (zone) => {
      const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-read-outside-'))
      try {
        writeFileSync(join(outside, 'secret.md'), '# SECRET EXTERNE\nDONNEE-HORS-VAULT\n', 'utf8')
        rmSync(join(root, zone), { recursive: true, force: true })
        symlinkSync(outside, join(root, zone), 'junction')

        expect(() => listInboxCandidates(root)).toThrow(/hors périmètre/)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    }
  )

  it('refuse une junction externe imbriquée sous inbox/', () => {
    const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-read-nested-'))
    try {
      writeFileSync(join(outside, 'secret.md'), '# SECRET EXTERNE\nDONNEE-HORS-VAULT\n', 'utf8')
      symlinkSync(outside, join(root, 'inbox', 'nested'), 'junction')

      expect(() => listInboxCandidates(root)).toThrow(/hors périmètre/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
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
      headShasFor: (paths) =>
        new Map(
          paths.map((path) => [path, path === 'src/main/index.ts' ? 'deadbeefffff' : undefined])
        )
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

  it('resout tous les locators git en un seul lot dedoublonne', () => {
    note('inbox/a.md', `---\nsource: git:src/main/index.ts@deadbeef\n---\n\n# A\n`)
    note('inbox/b.md', `---\nsource: git:src/main/index.ts@cafe999\n---\n\n# B\n`)
    note('inbox/c.md', `---\nsource: git:src/main/os.ts@abc1234\n---\n\n# C\n`)
    const calls: string[][] = []
    const candidates = listInboxCandidates(root, {
      headShasFor: (paths) => {
        calls.push([...paths])
        return new Map([
          ['src/main/index.ts', 'deadbeefffff'],
          ['src/main/os.ts', 'fffffff']
        ])
      }
    })
    expect(calls).toEqual([['src/main/index.ts', 'src/main/os.ts']])
    expect(candidates.map((candidate) => candidate.source?.shaState)).toEqual([
      'current',
      'stale',
      'stale'
    ])
  })

  it('relit un locator Git absolu accepté à l’écriture dans un workspace avec espaces', () => {
    const workspace = join(root, 'Workspace With Space')
    const sourceFile = join(workspace, 'src', 'main', 'absolute.ts')
    mkdirSync(join(sourceFile, '..'), { recursive: true })
    writeFileSync(sourceFile, 'export {}\n', 'utf8')
    const locatorPath = sourceFile.replace(/\\/g, '/')
    note('inbox/absolu.md', `---\nsource: git:${locatorPath}@deadbeef\n---\n\n# Absolu\n`)

    const [candidate] = listInboxCandidates(root, {
      headShasFor: (paths) =>
        resolveHeadShas(
          [workspace],
          paths,
          (_workspace, batch) => new Map(batch.map((path) => [path, 'deadbeefffff'])),
          () => 0
        )
    })

    expect(candidate.source).toMatchObject({ path: locatorPath, shaState: 'current' })
  })

  it('refuse une fiche trop volumineuse avant de charger son contenu', () => {
    note('inbox/enorme.md', `# Enorme\n\n${'x'.repeat(MAX_INBOX_FILE_BYTES + 1)}`)
    expect(() => listInboxCandidates(root)).toThrow(/trop volumineuse/)
  })

  it('renvoie un extrait léger puis relit le corps complet à la demande', () => {
    const body = 'corps-lazy '.repeat(100)
    note('inbox/lazy.md', `# Lazy\n\n${body}\n`)

    const [candidate] = listInboxCandidates(root)

    expect(candidate.body.length).toBeLessThanOrEqual(400)
    expect(candidate.bodyTruncated).toBe(true)
    expect(readInboxCandidateBody(root, candidate.id).body).toBe(body.trim())
  })

  it('ne coupe jamais un emoji à la frontière de l’aperçu', () => {
    const body = `${'a'.repeat(399)}😀suite`
    note('inbox/unicode.md', `# Unicode\n\n${body}\n`)

    const [candidate] = listInboxCandidates(root)

    expect(candidate.body).toBe('a'.repeat(399))
    expect(candidate.bodyTruncated).toBe(true)
    expect(candidate.body.charCodeAt(candidate.body.length - 1)).not.toBe(0xd83d)
    expect(readInboxCandidateBody(root, candidate.id).body).toBe(body)
  })

  it('ignore une fiche canonique trop volumineuse sans bloquer les decisions inbox', () => {
    note('inbox/valide.md', '# Valide\n\nDecision encore actionnable.\n')
    note('knowledge/enorme.md', `# Enorme\n\n${'x'.repeat(MAX_INBOX_FILE_BYTES + 1)}`)

    const [candidate] = listInboxCandidates(root)

    expect(candidate.id).toBe('inbox/valide')
    expect(candidate.nearDuplicates).toEqual([])
    expect(candidate.warnings).toEqual([
      expect.stringMatching(/comparaison incomplète.*knowledge\/enorme/i)
    ])
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
  it('traite 300 + 300 fiches presque pleines a vocabulaire distinct sous la frontiere worker', () => {
    const nearLimitBody = (prefix: string): string => {
      const target = MAX_INBOX_FILE_BYTES - 64
      const tokens: string[] = []
      let length = 0
      for (let index = 0; ; index += 1) {
        const token = `${prefix}x${index.toString(36)}`
        if (length + token.length + 1 > target) break
        tokens.push(token)
        length += token.length + 1
      }
      return tokens.join(' ')
    }
    for (let index = 0; index < 300; index += 1) {
      const suffix = index.toString(36)
      note(`inbox/large-${index}.md`, `# i${suffix}\n\n${nearLimitBody(`i${suffix}z`)}\n`)
      note(`knowledge/large-${index}.md`, `# k${suffix}\n\n${nearLimitBody(`k${suffix}z`)}\n`)
    }

    const startedAt = performance.now()
    const candidates = listInboxCandidates(root)
    const elapsedMs = performance.now() - startedAt

    expect(candidates).toHaveLength(300)
    expect(candidates.every((candidate) => candidate.nearDuplicates.length === 0)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(candidates), 'utf8')).toBeLessThan(2 * 1024 * 1024)
    expect(elapsedMs).toBeLessThan(5_000)
  }, 30_000)

  it('traite la capacité maximale 300 inbox + 300 knowledge sans explosion quadratique de tokenisation', () => {
    const uniqueBody = (zone: string, index: number): string =>
      Array.from(
        { length: 20 },
        (_, token) => `${zone}${index.toString(36)}x${token.toString(36)}`
      ).join(' ')
    for (let index = 0; index < 300; index += 1) {
      note(`inbox/${index}.md`, `# inbox${index}\n\n${uniqueBody('i', index)}\n`)
      note(`knowledge/${index}.md`, `# knowledge${index}\n\n${uniqueBody('k', index)}\n`)
    }

    const startedAt = performance.now()
    const candidates = listInboxCandidates(root)
    const elapsedMs = performance.now() - startedAt

    expect(candidates).toHaveLength(300)
    expect(candidates.every((candidate) => candidate.nearDuplicates.length === 0)).toBe(true)
    expect(elapsedMs).toBeLessThan(4_000)
  })

  it('borne le payload quand les 300 + 300 fiches sont toutes quasi-identiques', () => {
    const body = 'Même fait canonique suffisamment long pour dépasser le seuil lexical de doublon.'
    for (let index = 0; index < 300; index += 1) {
      note(`inbox/${index.toString().padStart(3, '0')}.md`, `# Même fait\n\n${body}\n`)
      note(`knowledge/${index.toString().padStart(3, '0')}.md`, `# Même fait\n\n${body}\n`)
    }

    const candidates = listInboxCandidates(root)

    expect(candidates).toHaveLength(300)
    expect(
      candidates.every(
        (candidate) => candidate.nearDuplicates.length === MAX_NEAR_DUPLICATES_PER_CANDIDATE
      )
    ).toBe(true)
    expect(candidates[0].nearDuplicates.some(({ zone }) => zone === 'knowledge')).toBe(true)
    expect(candidates[0].nearDuplicates.some(({ zone }) => zone === 'inbox')).toBe(true)
    expect(
      (candidates[0].nearDuplicatesOmitted?.inbox ?? 0) +
        (candidates[0].nearDuplicatesOmitted?.knowledge ?? 0)
    ).toBe(589)
    expect(Buffer.byteLength(JSON.stringify(candidates), 'utf8')).toBeLessThan(2 * 1024 * 1024)
  })

  it('garde un doublon canonique visible même si dix candidats identiques le précèdent', () => {
    const body = 'Même fait répété dans la file et déjà présent dans le savoir canonique.'
    for (let index = 0; index < 12; index += 1) {
      note(`inbox/${index.toString().padStart(2, '0')}.md`, `# Même fait\n\n${body}\n`)
    }
    note('knowledge/zz-canonique.md', `# Même fait\n\n${body}\n`)

    const [candidate] = listInboxCandidates(root)

    expect(candidate.nearDuplicates).toHaveLength(MAX_NEAR_DUPLICATES_PER_CANDIDATE)
    expect(candidate.nearDuplicates.some(({ zone }) => zone === 'knowledge')).toBe(true)
    expect(candidate.nearDuplicatesOmitted).toEqual({ inbox: 2, knowledge: 0 })
  })

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

  it('signale explicitement une comparaison knowledge tronquée au-delà de 300 fiches', () => {
    note('inbox/candidat.md', '# Candidat\n\nFait à décider.\n')
    for (let index = 0; index < 301; index += 1) {
      note(
        `knowledge/${index.toString().padStart(3, '0')}.md`,
        `# K${index}\n\nDistinct ${index}\n`
      )
    }
    const [candidate] = listInboxCandidates(root)
    expect(candidate.warnings).toEqual([
      expect.stringMatching(/comparaison incomplète.*plus de 300 fiches knowledge/i)
    ])
  })

  it('deux faits DIFFÉRENTS ne sont pas appariés', () => {
    note('inbox/a.md', '# A\n\nLe serveur Brain ecoute sur le port loopback huit sept six cinq.\n')
    note('inbox/b.md', '# B\n\nLes largeurs de colonne sont persistees dans le stockage local.\n')
    expect(listInboxCandidates(root)[0].nearDuplicates).toEqual([])
  })
})

describe('promouvoir / rejeter — primitives no-clobber et réversibles', () => {
  it('place une leçon automatique dans le corpus domain du workspace', () => {
    note('inbox/lesson.md', '# Leçon\n')
    expect(promoteOutcomeLearningCandidate(root, 'inbox/lesson', 'Autowin OS').to).toBe(
      'knowledge/domain/autowin-os-lesson'
    )
  })

  it('rétracte puis restaure une connaissance sans perdre son historique', () => {
    note('knowledge/fausse.md', '# Fausse leçon\n\nContenu à retirer du RAG.\n')
    const retracted = retractKnowledgeCandidate(root, 'knowledge/fausse')
    expect(retracted.to).toBe('.trash/fausse')
    expect(readFileSync(join(root, 'knowledge/fausse.md'), 'utf8')).not.toContain(
      'Contenu à retirer'
    )
    expect(readFileSync(join(root, '.trash/fausse.md'), 'utf8')).toContain('Contenu à retirer')

    const replay = retractKnowledgeCandidate(root, 'knowledge/fausse')
    expect(replay).toMatchObject({ to: '.trash/fausse', replayed: true })

    const restored = restoreTrashedKnowledge(root, '.trash/fausse')
    expect(restored.to).toMatch(/^knowledge\/fausse(?:-2)?$/)
    expect(readFileSync(join(root, `${restored.to}.md`), 'utf8')).toContain('Contenu à retirer')
  })

  it('supersède une fiche seulement par un remplacement canonique existant', () => {
    note('knowledge/ancienne.md', '# Ancienne\n')
    note('knowledge/nouvelle.md', '# Nouvelle\n')
    const result = supersedeKnowledgeCandidate(root, 'knowledge/ancienne', 'knowledge/nouvelle')
    expect(result).toMatchObject({
      moved: { from: 'knowledge/ancienne', to: '.trash/ancienne' },
      replacementId: 'knowledge/nouvelle'
    })
    expect(() =>
      supersedeKnowledgeCandidate(root, 'knowledge/nouvelle', 'knowledge/introuvable')
    ).toThrow(/remplacement introuvable/iu)
  })

  it('accepte les noms légaux commençant par deux points sans autoriser ../', () => {
    note('inbox/..note.md', '# Note\n\ncorps\n')
    note('inbox/..rejet.md', '# Rejet\n\ncorps\n')

    expect(readInboxCandidateBody(root, 'inbox/..note').body).toBe('corps')
    expect(promoteInboxCandidate(root, 'inbox/..note').to).toBe('knowledge/..note')
    expect(rejectInboxCandidate(root, 'inbox/..rejet').to).toBe('.trash/..rejet')
  })
  it('promouvoir déplace le candidat de inbox/ vers knowledge/', () => {
    note('inbox/a.md', '# A\n\ncorps\n')
    const moved = promoteInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('knowledge/a')
    expect(listInboxCandidates(root)).toEqual([])
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toContain('autowin-inbox-moved')
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
    expect(listInboxCandidates(root)).toEqual([])
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toContain('autowin-inbox-moved')
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

  it.each([
    ['promouvoir', promoteInboxCandidate],
    ['rejeter', rejectInboxCandidate]
  ])('refuse de %s depuis une inbox junction externe', (_label, moveCandidate) => {
    const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-outside-'))
    try {
      rmSync(join(root, 'inbox'), { recursive: true, force: true })
      writeFileSync(join(outside, 'secret.md'), '# EXTERNE\n', 'utf8')
      symlinkSync(outside, join(root, 'inbox'), 'junction')

      expect(() => moveCandidate(root, 'inbox/secret')).toThrow(/hors périmètre/)
      expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('# EXTERNE\n')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.each([
    ['knowledge', promoteInboxCandidate],
    ['.trash', rejectInboxCandidate]
  ])('refuse une destination %s qui est une junction externe', (destination, moveCandidate) => {
    const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-destination-'))
    try {
      note('inbox/a.md', '# A\n')
      rmSync(join(root, destination), { recursive: true, force: true })
      symlinkSync(outside, join(root, destination), 'junction')

      expect(() => moveCandidate(root, 'inbox/a')).toThrow(/hors périmètre/)
      expect(existsSync(join(root, 'inbox', 'a.md'))).toBe(true)
      expect(readdirSync(outside)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('assertBrainVaultRoot — un canal IPC accepte n’importe quelle chaîne', () => {
  it('accepte la racine autorisée, quelle que soit l’écriture des séparateurs', () => {
    const canonical = realpathSync.native(root)
    expect(assertBrainVaultRoot(root, root)).toBe(canonical)
    expect(assertBrainVaultRoot(`${root}\\`, root)).toBe(canonical)
  })

  it('garde la racine canonique si un alias est repointé après autorisation', () => {
    const vault = join(root, 'vault')
    const outside = join(root, 'outside')
    const alias = join(root, 'alias')
    note('vault/inbox/interne.md', '# Interne\n\nMARQUEUR-INTERNE\n')
    note('outside/inbox/secret.md', '# Secret\n\nMARQUEUR-EXTERNE\n')
    mkdirSync(join(vault, 'knowledge'), { recursive: true })
    mkdirSync(join(outside, 'knowledge'), { recursive: true })
    symlinkSync(vault, alias, process.platform === 'win32' ? 'junction' : 'dir')

    const authorized = assertBrainVaultRoot(alias, vault)
    rmSync(alias, { force: true })
    symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')

    expect(authorized).toBe(realpathSync.native(vault))
    expect(listInboxCandidates(authorized).map(({ id }) => id)).toEqual(['inbox/interne'])
    expect(readInboxCandidateBody(authorized, 'inbox/interne').body).toContain('MARQUEUR-INTERNE')
    expect(() => readInboxCandidateBody(authorized, 'inbox/secret')).toThrow(/introuvable/)
  })

  it('refuse toute autre racine', () => {
    expect(() => assertBrainVaultRoot(join(root, 'inbox'), root)).toThrow(/hors périmètre/)
    expect(() => assertBrainVaultRoot('C:/Windows', root)).toThrow(/hors périmètre/)
  })

  it('ne confond pas K et le signe Kelvin dans deux racines disque distinctes', () => {
    const parent = mkdtempSync(join(tmpdir(), 'brain-inbox-unicode-root-'))
    const ascii = join(parent, 'Knowledge-K')
    const kelvin = join(parent, 'Knowledge-K')
    try {
      mkdirSync(ascii)
      mkdirSync(kelvin)
      expect(() => assertBrainVaultRoot(kelvin, ascii)).toThrow(/hors périmètre/)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
