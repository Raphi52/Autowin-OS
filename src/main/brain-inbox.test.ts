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

/** Candidat tel que `remember` le dépose (`brain-remember.ts`, schéma candidate-v1). */
function candidat(title: string, corps = 'corps', entete: Record<string, string> = {}): string {
  const champs: Record<string, string> = {
    schema: 'amitel-brain/candidate-v1',
    type: 'lesson',
    kind: 'lesson',
    scope: '"autowin-os"',
    author_agent: '"autowin-os"',
    model: '"claude-opus-5-5"',
    created: '2026-09-29',
    status: 'candidate',
    supersedes: '[]',
    tags: '["brain"]',
    mocs: '[]',
    source: '"git:src/main/brain-inbox.ts@abc1234"',
    confidence: '"high"',
    ...entete
  }
  const lignes = Object.entries(champs)
    .filter(([, valeur]) => valeur !== '')
    .map(([cle, valeur]) => `${cle}: ${valeur}`)
  return `---\n${lignes.join('\n')}\n---\n\n# ${title}\n\n${corps}\n`
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

  it('ne compte pas le README.md de inbox/ comme un candidat', () => {
    note(
      'inbox/README.md',
      `# Boîte de réception

Déposez ici les candidats produits par remember.
`
    )
    note(
      'inbox/2026-09-16-vrai-candidat.md',
      `---
type: lesson
scope: autowin-os
source: git:src/main/index.ts@abc1234
date: 2026-09-16
---

# Un vrai candidat

Corps.
`
    )
    const ids = listInboxCandidates(root, { now: new Date('2026-09-16T00:00:00Z') }).map((c) => c.id)
    expect(ids).toEqual(['inbox/2026-09-16-vrai-candidat'])
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
    note('inbox/a.md', `---\nsource: C:\\srv1\\note.md\n---\n\n# A\n`)
    const [candidate] = listInboxCandidates(root)
    expect(candidate.source?.problem).toMatch(/préfixe manquant/)
    expect(candidate.source?.locator).toBe('C:\\srv1\\note.md')
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
    const ecrireLot = (depuis: number, jusqua: number): void => {
      for (let index = depuis; index < jusqua; index += 1) {
        const suffix = index.toString(36)
        note(`inbox/large-${index}.md`, `# i${suffix}\n\n${nearLimitBody(`i${suffix}z`)}\n`)
        note(`knowledge/large-${index}.md`, `# k${suffix}\n\n${nearLimitBody(`k${suffix}z`)}\n`)
      }
    }
    const chronometrer = (): { candidates: ReturnType<typeof listInboxCandidates>; ms: number } => {
      const depart = performance.now()
      const candidates = listInboxCandidates(root)
      return { candidates, ms: performance.now() - depart }
    }

    ecrireLot(0, 75)
    const quart = chronometrer()
    ecrireLot(75, 300)
    const complet = chronometrer()
    const candidates = complet.candidates

    expect(candidates).toHaveLength(300)
    expect(candidates.every((candidate) => candidate.nearDuplicates.length === 0)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(candidates), 'utf8')).toBeLessThan(2 * 1024 * 1024)
    /*
     * LA CROISSANCE, PAS LA DUREE.
     *
     * Cette assertion etait `elapsedMs < 5000` : un budget en millisecondes de MACHINE. Mesure du
     * 2026-09-09 — sous la charge de plusieurs runs paralleles elle a rendu 5579 ms et REFUSE une
     * edition de simple texte dans un fichier de consigne, sans aucun rapport avec ce code. Un
     * budget absolu ne mesure pas le code, il mesure la machine du moment, et se trompe dans les
     * DEUX sens : faux rouge sous charge, faux vert sur une machine plus rapide qui masquerait une
     * vraie regression.
     *
     * Ce qui est REELLEMENT protege ici — et que le test voisin nomme — c'est l'absence d'explosion
     * QUADRATIQUE de la comparaison de doublons quand les fiches frolent la taille limite. On
     * compare donc deux mesures prises sur la MEME machine a la MEME seconde, pour un corpus
     * multiplie par 4 : une croissance lineaire donne ~4x, une quadratique ~16x. Le plafond a 8x
     * laisse la place au bruit et aux couts fixes tout en attrapant le defaut. Un RAPPORT annule la
     * vitesse de la machine : c'est ce qui le rend fiable sous charge, sans rien desserrer.
     *
     * ENTREE QUI DOIT LE FAIRE ECHOUER : rendre la comparaison quadratique (comparer chaque fiche a
     * toutes les autres sans index inverse) fait bondir le rapport bien au-dela de 8.
     */
    expect(complet.ms / Math.max(quart.ms, 1)).toBeLessThan(8)
  }, 60_000)

  it('traite la capacité maximale 300 inbox + 300 knowledge sans explosion quadratique de tokenisation', () => {
    const uniqueBody = (zone: string, index: number): string =>
      Array.from(
        { length: 20 },
        (_, token) => `${zone}${index.toString(36)}x${token.toString(36)}`
      ).join(' ')
    const ecrireLot = (depuis: number, jusqua: number): void => {
      for (let index = depuis; index < jusqua; index += 1) {
        note(`inbox/${index}.md`, `# inbox${index}\n\n${uniqueBody('i', index)}\n`)
        note(`knowledge/${index}.md`, `# knowledge${index}\n\n${uniqueBody('k', index)}\n`)
      }
    }
    const chronometrer = (): { candidates: ReturnType<typeof listInboxCandidates>; ms: number } => {
      const depart = performance.now()
      const candidates = listInboxCandidates(root)
      return { candidates, ms: performance.now() - depart }
    }

    ecrireLot(0, 75)
    const quart = chronometrer()
    ecrireLot(75, 300)
    const complet = chronometrer()
    const candidates = complet.candidates

    expect(candidates).toHaveLength(300)
    expect(candidates.every((candidate) => candidate.nearDuplicates.length === 0)).toBe(true)
    /*
     * MEME REMEDE QUE LE TEST DEUX PLUS HAUT, meme raison : `elapsedMs < 4000` mesurait la machine
     * du moment, pas la tokenisation. Le raisonnement complet et l'incident du 2026-09-09 sont
     * ecrits une seule fois, sur l'assertion de `frontiere worker` — ils ne sont pas recopies ici,
     * deux copies d'une justification derivent.
     *
     * La difference avec le voisin : la, les fiches frolent la limite de 256 Ko et c'est la
     * COMPARAISON de doublons qui pourrait exploser ; ici les fiches sont minuscules (20 jetons) et
     * nombreuses, donc c'est la TOKENISATION qui est sur le banc — d'ou un test distinct.
     *
     * Rapport MESURE (plafond temporairement abaisse pour lire la valeur reelle) : voir le commit.
     * Lineaire ~4x pour un corpus multiplie par 4, quadratique ~16x, plafond a 8x.
     */
    expect(complet.ms / Math.max(quart.ms, 1)).toBeLessThan(8)
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

  it('la promotion automatique ne laisse pas le candidat entier dans inbox/', () => {
    const contenu = candidat('Leçon automatique')
    note('inbox/lesson.md', contenu)

    const moved = promoteOutcomeLearningCandidate(root, 'inbox/lesson', 'autowin-os')

    expect(readFileSync(join(root, 'knowledge/domain/autowin-os-lesson.md'), 'utf8')).toBe(contenu)
    // Plus d'en-tête `status: candidate` : `brain_curate.py` ne le reprend plus comme en attente.
    expect(readFileSync(join(root, 'inbox', 'lesson.md'), 'utf8')).toBe(
      '\n<!-- autowin-inbox-moved:knowledge/domain/autowin-os-lesson -->\n'
    )
    expect(listInboxCandidates(root)).toEqual([])
    expect(promoteOutcomeLearningCandidate(root, 'inbox/lesson', 'autowin-os')).toEqual({
      ...moved,
      replayed: true
    })
    expect(readdirSync(join(root, 'knowledge/domain'))).toEqual(['autowin-os-lesson.md'])
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
    note('inbox/..note.md', candidat('Note'))
    note('inbox/..rejet.md', '# Rejet\n\ncorps\n')

    expect(readInboxCandidateBody(root, 'inbox/..note').body).toBe('corps')
    expect(promoteInboxCandidate(root, 'inbox/..note').to).toBe('knowledge/lessons/note')
    expect(rejectInboxCandidate(root, 'inbox/..rejet').to).toBe('.trash/..rejet')
  })
  it('promouvoir range une fiche v1 dans knowledge/<type>/ et ne laisse aucun double dans inbox/', () => {
    note('inbox/a.md', candidat('Une leçon Brain', 'Le corps de la leçon.'))
    const moved = promoteInboxCandidate(root, 'inbox/a', { now: new Date(2026, 8, 30, 12) })

    expect(moved).toEqual({ ok: true, from: 'inbox/a', to: 'knowledge/lessons/une-lecon-brain' })
    // Rien à la racine de knowledge/ : `brain_validate.py` y refuse toute fiche.
    expect(readdirSync(join(root, 'knowledge'))).toEqual(['lessons'])
    expect(readFileSync(join(root, 'knowledge/lessons/une-lecon-brain.md'), 'utf8')).toBe(
      [
        '---',
        'schema: amitel-brain/v1',
        'uid: autowin-os/lesson/une-lecon-brain',
        'type: lesson',
        'kind: lesson',
        'scope: "autowin-os"',
        'author_agent: "autowin-os"',
        'model: claude-opus-5-5',
        'created: 2026-09-29',
        'updated: 2026-09-30',
        'status: active',
        'confidence: derived',
        'sources: ["git:src/main/brain-inbox.ts@abc1234"]',
        'supersedes: []',
        'reviewed_by: ["autowin-app-curation"]',
        'reviewed_at: 2026-09-30',
        'mocs: ["knowledge/_maps/autowin-os"]',
        'tags: ["brain", "theme/autowin-os"]',
        '---',
        '',
        '# Une leçon Brain',
        '',
        'Le corps de la leçon.',
        ''
      ].join('\n')
    )
    // Le candidat n'est plus qu'une ligne-marqueur : ni en-tête `status: candidate` que
    // `brain_curate.py` reprendrait comme proposition en attente, ni copie du contenu.
    const reste = readFileSync(join(root, 'inbox', 'a.md'), 'utf8')
    expect(reste).toBe('\n<!-- autowin-inbox-moved:knowledge/lessons/une-lecon-brain -->\n')
    expect(listInboxCandidates(root)).toEqual([])
  })

  it('range chaque type dans son dossier et garde les mocs et le thème déclarés', () => {
    note(
      'inbox/d.md',
      candidat('Décision tranchée', 'corps', {
        type: 'decision',
        kind: '',
        scope: '"global"',
        tags: '["theme/ia"]',
        mocs: '["knowledge/_maps/ia"]',
        confidence: '"low"'
      })
    )
    note('inbox/f.md', candidat('Un fait', 'corps', { type: 'domain', kind: '' }))
    note('inbox/p.md', candidat('Un goût', 'corps', { type: 'preference', kind: 'preference' }))

    expect(promoteInboxCandidate(root, 'inbox/d').to).toBe('knowledge/decisions/decision-tranchee')
    expect(promoteInboxCandidate(root, 'inbox/f').to).toBe('knowledge/domain/un-fait')
    expect(promoteInboxCandidate(root, 'inbox/p').to).toBe('knowledge/preferences/un-gout')
    const decision = readFileSync(join(root, 'knowledge/decisions/decision-tranchee.md'), 'utf8')
    expect(decision).toContain('uid: global/decision/decision-tranchee\n')
    expect(decision).toContain('confidence: hypothesis\n')
    expect(decision).toContain('mocs: ["knowledge/_maps/ia"]\n')
    expect(decision).toContain('tags: ["theme/ia"]\n')
    expect(readFileSync(join(root, 'knowledge/domain/un-fait.md'), 'utf8')).toContain(
      'kind: concept\n'
    )
  })

  it('promeut un candidat enregistré avec une marque d’ordre des octets (U+FEFF)', () => {
    note('inbox/a.md', `${String.fromCharCode(0xfeff)}${candidat('Avec marque')}`)
    expect(promoteInboxCandidate(root, 'inbox/a').to).toBe('knowledge/lessons/avec-marque')
  })

  it('rejoue une promotion déjà faite sans créer de seconde fiche', () => {
    note('inbox/a.md', candidat('Rejouée'))
    const first = promoteInboxCandidate(root, 'inbox/a')
    const replay = promoteInboxCandidate(root, 'inbox/a')
    expect(replay).toEqual({ ...first, replayed: true })
    expect(readdirSync(join(root, 'knowledge/lessons'))).toEqual(['rejouee.md'])
  })

  it.each([
    ['sans en-tête', '# A\n\ncorps\n', /sans en-tête/],
    ['sans type', candidat('A', 'corps', { type: '' }), /champ type manquant/],
    ['sans source', candidat('A', 'corps', { source: '' }), /champ source manquant/],
    ['au type inconnu', candidat('A', 'corps', { type: 'note' }), /type de candidat non pris/],
    ['déjà actif', candidat('A', 'corps', { status: 'active' }), /statut active/],
    [
      'relu par sa propre famille',
      candidat('A', 'corps', { author_agent: 'autowin-app-curation' }),
      /famille/
    ]
  ])('refuse un candidat %s sans rien écrire ni toucher inbox/', (_label, contenu, erreur) => {
    note('inbox/a.md', contenu)
    expect(() => promoteInboxCandidate(root, 'inbox/a')).toThrow(erreur)
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toBe(contenu)
    expect(readdirSync(join(root, 'knowledge'))).toEqual([])
  })

  it('promouvoir ne PIÉTINE pas une fiche canonique homonyme', () => {
    note('inbox/a.md', candidat('A'))
    note('knowledge/lessons/a.md', '# canonique\n')
    const moved = promoteInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('knowledge/lessons/a-2')
    expect(readdirSync(join(root, 'knowledge/lessons')).sort()).toEqual(['a-2.md', 'a.md'])
    expect(readFileSync(join(root, 'knowledge/lessons/a.md'), 'utf8')).toBe('# canonique\n')
  })

  it('rejeter déplace vers .trash/ — jamais de suppression définitive', () => {
    const contenu = candidat('A rejeter')
    note('inbox/a.md', contenu)
    const moved = rejectInboxCandidate(root, 'inbox/a')
    expect(moved.to).toBe('.trash/a')
    expect(listInboxCandidates(root)).toEqual([])
    // La copie COMPLÈTE est dans .trash/ ; inbox/ ne garde que la ligne-marqueur, sans l'en-tête
    // `status: candidate` que `brain_curate.py --apply` republiait.
    expect(readFileSync(join(root, '.trash', 'a.md'), 'utf8')).toBe(contenu)
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toBe(
      '\n<!-- autowin-inbox-moved:.trash/a -->\n'
    )
    expect(readdirSync(join(root, '.trash'))).toEqual(['a.md'])
  })

  it('rejouer un rejet ne crée pas de seconde copie dans .trash/', () => {
    note('inbox/a.md', candidat('A rejeter'))
    const moved = rejectInboxCandidate(root, 'inbox/a')
    expect(rejectInboxCandidate(root, 'inbox/a')).toEqual({ ...moved, replayed: true })
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
    // `recursive` requis depuis Node 24 : sans lui, rmSync refuse une junction Windows
    // (« Path is a directory », ERR_FS_EISDIR). Il retire le LIEN seul — la cible reste intacte
    // (sonde locale du 2026-09-10, Node v24.12.0).
    rmSync(alias, { recursive: true, force: true })
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
