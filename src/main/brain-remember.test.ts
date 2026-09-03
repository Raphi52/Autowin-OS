import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHmac } from 'node:crypto'
import {
  REMEMBER_BODY_MAX,
  REMEMBER_SCOPE_MAX,
  REMEMBER_SOURCE_SCHEMES,
  REMEMBER_TAG_MAX,
  decideRemember,
  configureRememberDepositStore,
  forgetSessionDeposits,
  likelySecretShape,
  rememberFact,
  sourceLocatorProblem,
  truncateFact
} from './brain-remember'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * SE SOUVENIR — la seule régression mécanique face à claude.exe.
 *
 * claude.exe a une mémoire que le modèle ÉCRIT. Autowin avait coupé la LECTURE automatique des fiches
 * (552 Ko, ~9 200 tokens par appel) et la lecture à la demande existait déjà (`brain_query`) : restait
 * un trou d'ÉCRITURE, mesuré le 2026-07-29 — aucun chemin d'écriture dans tout `src/`, et zéro
 * occurrence de « mémoire » dans le prompt de pilotage.
 */
const FAIT_VALIDE = {
  title: 'Le CLI claude se résout via le préfixe npm',
  fact: "Sur Windows le PATH n'expose que des shims .cmd ; il faut résoudre le vrai claude.exe.",
  type: 'lesson',
  scope: 'autowin-os',
  // Forme VERIFIABLE, imposee par le serveur vivant : un chemin de depot relatif est refuse.
  source: 'git:src/main/providers/npm-global-resolve.ts@9218eaf'
}

const signedContextPayload = (context: string, token = 'jeton'): Record<string, unknown> => {
  const authenticated = JSON.stringify({ context, navigation: null })
  return {
    service: 'amitel-brain',
    protocol: 2,
    authenticated,
    signature: createHmac('sha256', token)
      .update(`amitel-brain\n2\n${authenticated}`, 'utf8')
      .digest('hex')
  }
}

/**
 * UNE ROUTE ABSENTE N'EST PAS UN REFUS.
 *
 * Mesure conv-9 (2026-08-31), lue dans la trace causale : `remember` a rendu
 * `{ allowed: true, stored: false, detail: 'refusé par le Brain : not found' }`. Le mot « refusé »
 * envoie chercher le defaut dans le FAIT (type ? source ? longueur ?), alors qu'un 404 dit que la
 * route de depot n'existe pas sur ce serveur : rien n'a ete lu, rien n'a ete juge. Le meme tour
 * portait par ailleurs un `status: 'unavailable'` cote lecture — meme serveur muet, deux messages
 * qui ne se recoupaient pas.
 */
describe('remember — separer la panne de transport du refus de contenu', () => {
  const faitPourCeTest = {
    ...FAIT_VALIDE,
    title: 'Route de depot absente — cas 404',
    fact: 'Un 404 sur la route de depot ne dit rien du contenu du fait envoye.'
  }

  it('nomme la route de dépôt manquante au lieu d’accuser le fait', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-404-'))
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    ) as unknown as typeof fetch
    try {
      configureRememberDepositStore(join(root, 'remember-deposits.json'))
      const res = await rememberFact(faitPourCeTest, { token: 'jeton', fetchFn })
      expect(res.stored).toBe(false)
      expect(res.detail).toMatch(/route de dépôt/u)
      expect(res.detail).toContain('404')
      expect(res.detail).not.toMatch(/refusé par le Brain/u)
    } finally {
      forgetSessionDeposits()
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('garde VERBATIM le motif d’un vrai refus du serveur', async () => {
    // L'autre bord : separer ne doit pas avaler le motif que le serveur prend la peine de donner.
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-422-'))
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 'type invalide' }), { status: 422 })
    ) as unknown as typeof fetch
    try {
      configureRememberDepositStore(join(root, 'remember-deposits.json'))
      const res = await rememberFact(
        { ...faitPourCeTest, title: 'Vrai refus — cas 422' },
        { token: 'jeton', fetchFn }
      )
      expect(res.stored).toBe(false)
      expect(res.detail).toBe('refusé par le Brain : type invalide')
    } finally {
      forgetSessionDeposits()
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('depot — l origine est CONFIGUREE, jamais ecrite en dur', () => {
  /*
   * Meme defaut que la lecture, mesure le 2026-09-02 : le depot visait `127.0.0.1:8765` en dur alors
   * que le service tournait sur l origine declaree par `AMITEL_BRAIN_ORIGIN`. Ecrire ailleurs que la
   * ou l on lit est pire qu une panne : le candidat part sur un service que personne ne consulte.
   */
  it('envoie le candidat sur l origine declaree par AMITEL_BRAIN_ORIGIN', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-origine-'))
    vi.stubEnv('AMITEL_BRAIN_ORIGIN', 'http://127.0.0.1:8766')
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    ) as unknown as typeof fetch
    try {
      configureRememberDepositStore(join(root, 'remember-deposits.json'))
      await rememberFact(
        { ...FAIT_VALIDE, title: 'Origine configuree — depot' },
        { token: 'jeton', fetchFn }
      )
      expect(String(vi.mocked(fetchFn).mock.calls[0][0])).toBe('http://127.0.0.1:8766/ingest')
    } finally {
      vi.unstubAllEnvs()
      forgetSessionDeposits()
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ne throw pas quand l origine configuree n est pas loopback : depot IMPOSSIBLE', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-origine-ko-'))
    vi.stubEnv('AMITEL_BRAIN_ORIGIN', 'https://brain.example.invalid')
    const fetchFn = vi.fn(
      async () => new Response('{}', { status: 200 })
    ) as unknown as typeof fetch
    try {
      configureRememberDepositStore(join(root, 'remember-deposits.json'))
      const res = await rememberFact(
        { ...FAIT_VALIDE, title: 'Origine invalide — depot' },
        { token: 'jeton', fetchFn }
      )
      expect(res.stored).toBe(false)
      expect(res.detail).toMatch(/AMITEL_BRAIN_ORIGIN/u)
      expect(vi.mocked(fetchFn)).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      forgetSessionDeposits()
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('idempotence atomique de remember', () => {
  it('bloque un retry aveugle quand le premier depot a un etat inconnu', async () => {
    const deposited = new Map<string, string>()
    const slow = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    ) as unknown as typeof fetch
    const uncertain = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: slow,
      timeoutMs: 1,
      deposited
    })
    const retry = vi.fn(
      async () =>
        new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/retry.md')), {
          status: 200
        })
    ) as unknown as typeof fetch
    const second = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn: retry, deposited })

    expect(uncertain.unknown).toBe(true)
    expect(second.unknown).toBe(true)
    expect(retry).not.toHaveBeenCalled()
  })

  it('conserve le ledger anti-doublon apres redemarrage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-ledger-'))
    const store = join(root, 'remember-deposits.json')
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/durable.md')), {
          status: 200
        })
    ) as unknown as typeof fetch
    try {
      configureRememberDepositStore(store)
      expect((await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })).stored).toBe(true)

      configureRememberDepositStore()
      configureRememberDepositStore(store)
      expect((await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })).stored).toBe(false)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    } finally {
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('deux depots concurrents identiques ne produisent qu un appel reseau', async () => {
    const deposited = new Map<string, string>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchFn = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/concurrent.md')), {
        status: 200
      })
    }) as unknown as typeof fetch

    const first = rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn, deposited })
    const second = rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn, deposited })
    release()
    const outcomes = await Promise.all([first, second])

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(outcomes.filter((outcome) => outcome.stored)).toHaveLength(1)
  })

  it('ne dedoublonne jamais un meme texte entre scopes ou workspaces distincts', async () => {
    const deposited = new Map<string, string>()
    let callIndex = 0
    const fetchFn = vi.fn(async () => {
      callIndex += 1
      return new Response(
        JSON.stringify(signedContextPayload(`C:/brain/inbox/scope-${callIndex}.md`)),
        {
          status: 200
        }
      )
    }) as unknown as typeof fetch

    const first = await rememberFact(
      { ...FAIT_VALIDE, scope: 'scope-a' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-a' }
    )
    const otherScope = await rememberFact(
      { ...FAIT_VALIDE, scope: 'scope-b' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-a' }
    )
    const otherWorkspace = await rememberFact(
      { ...FAIT_VALIDE, scope: 'scope-a' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-b' }
    )
    const exactRetry = await rememberFact(
      { ...FAIT_VALIDE, scope: 'scope-a' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-a' }
    )

    expect([first.stored, otherScope.stored, otherWorkspace.stored, exactRetry.stored]).toEqual([
      true,
      true,
      true,
      false
    ])
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('migre un ledger v1 sans laisser son empreinte non scopee bloquer un depot v2', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-v1-'))
    const store = join(root, 'remember-deposits.json')
    const legacyKey = 'a'.repeat(64)
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/v2.md')), { status: 200 })
    ) as unknown as typeof fetch
    try {
      writeFileSync(store, JSON.stringify({ version: 1, deposits: [[legacyKey, 'legacy.md']] }))
      configureRememberDepositStore(store)

      const outcome = await rememberFact(FAIT_VALIDE, {
        token: 'jeton',
        fetchFn,
        workspace: 'C:\\Amitel\\Autowin OS'
      })

      expect(outcome.stored).toBe(true)
      expect(fetchFn).toHaveBeenCalledOnce()
      expect(JSON.parse(readFileSync(store, 'utf8')).version).toBe(2)
    } finally {
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('conserve apres redemarrage la frontiere workspace du ledger v2', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-remember-workspaces-'))
    const store = join(root, 'remember-deposits.json')
    let callIndex = 0
    const fetchFn = vi.fn(async () => {
      callIndex += 1
      return new Response(
        JSON.stringify(signedContextPayload(`C:/brain/inbox/ws-${callIndex}.md`)),
        { status: 200 }
      )
    }) as unknown as typeof fetch
    try {
      configureRememberDepositStore(store)
      expect(
        (
          await rememberFact(FAIT_VALIDE, {
            token: 'jeton',
            fetchFn,
            workspace: 'C:\\repo-a'
          })
        ).stored
      ).toBe(true)

      configureRememberDepositStore()
      configureRememberDepositStore(store)
      expect(
        (
          await rememberFact(FAIT_VALIDE, {
            token: 'jeton',
            fetchFn,
            workspace: 'C:\\repo-b'
          })
        ).stored
      ).toBe(true)

      configureRememberDepositStore()
      configureRememberDepositStore(store)
      expect(
        (
          await rememberFact(FAIT_VALIDE, {
            token: 'jeton',
            fetchFn,
            workspace: 'C:\\repo-b'
          })
        ).stored
      ).toBe(false)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally {
      configureRememberDepositStore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('un fait global identique reste dedoublonne entre workspaces', async () => {
    const deposited = new Map<string, string>()
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/global.md')), {
          status: 200
        })
    ) as unknown as typeof fetch

    const first = await rememberFact(
      { ...FAIT_VALIDE, scope: 'global' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-a' }
    )
    const second = await rememberFact(
      { ...FAIT_VALIDE, scope: 'global' },
      { token: 'jeton', fetchFn, deposited, workspace: 'C:\\repo-b' }
    )

    expect(first.stored).toBe(true)
    expect(second.stored).toBe(false)
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})

// L'anti-doublon de session vit dans le module : sans ce reset, un dépôt réussi dans un test rendrait
// « déjà déposé » dans le suivant. Constaté pour de vrai en ajoutant la garde (6 tests cassés d'un coup) —
// c'est la preuve qu'elle mord, et la raison pour laquelle la production peut compter dessus.
beforeEach(() => {
  configureRememberDepositStore()
  forgetSessionDeposits()
})

describe('decideRemember — refuser TÔT, et en disant pourquoi', () => {
  it('un fait complet est accepté et normalisé', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, tags: ['cli', ' windows '] })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.type).toBe('lesson')
    expect(decision.tags).toEqual(['cli', 'windows'])
    expect(decision.confidence).toBe('medium')
  })

  it('un titre manquant est refusé — un fait sans titre est introuvable', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, title: '   ' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toContain('titre')
  })

  it('un fait vide est refusé', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, fact: '' })
    expect(decision.allowed).toBe(false)
  })

  it('un TYPE hors liste est refusé, et la liste est DITE', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, type: 'règle-de-comportement' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    // Le refus doit ENSEIGNER : l'agent ne peut pas deviner la liste fermée du serveur.
    expect(decision.reason).toContain('lesson')
    expect(decision.reason).toContain('decision')
  })

  it('une source NON traçable est refusée, avec les préfixes attendus', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, source: 'je me souviens' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toContain('file:')
    expect(decision.reason).toContain('ticket:')
  })

  it('une portée manquante est refusée', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, scope: '' })
    expect(decision.allowed).toBe(false)
  })

  it('les quatre types du garde du Brain sont acceptés', () => {
    for (const type of ['lesson', 'decision', 'preference', 'domain']) {
      expect(decideRemember({ ...FAIT_VALIDE, type }).allowed).toBe(true)
    }
  })

  it('une confiance farfelue retombe sur « medium » au lieu d’échouer', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, confidence: 'certain' })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.confidence).toBe('medium')
  })

  it('les tags sont plafonnés (une note n’est pas un nuage de mots)', () => {
    const decision = decideRemember({
      ...FAIT_VALIDE,
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`)
    })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.tags).toHaveLength(8)
  })
})

describe('rememberFact — ce qui est DÉPOSÉ, jamais « mémorisé »', () => {
  it('envoie le candidat sur /ingest avec le jeton', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/2026-07-29-cli.md')), {
          status: 200
        })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(true)
    expect(outcome.note).toBe('2026-07-29-cli.md')
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(call[0])).toContain('/ingest')
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jeton' })
  })

  it('le compte-rendu dit CANDIDAT, la promotion humaine et la réindexation', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(signedContextPayload('inbox/x.md')), { status: 200 })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.detail).toMatch(/candidat/i)
    expect(outcome.detail).toMatch(/humain/i)
    expect(outcome.detail).toMatch(/réindexation/i)
    // JAMAIS un « c'est memorise » qui ferait croire a une relecture immediate.
    expect(outcome.detail).not.toMatch(/mémorisé|je m'en souviendrai/i)
  })

  it('un REFUS du serveur est rendu tel quel, pas maquillé en succès', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'likely secret detected; candidate rejected' }), {
          status: 400
        })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('likely secret detected')
  })

  it('sans jeton, rien n’est écrit et c’est DIT', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: '', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('jeton')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('un Brain injoignable ne casse PAS le tour', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('ECONNREFUSED')
  })

  it('un candidat invalide n’atteint JAMAIS le réseau', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const outcome = await rememberFact(
      { ...FAIT_VALIDE, source: 'de mémoire' },
      {
        token: 'jeton',
        fetchFn
      }
    )
    expect(outcome.allowed).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

/**
 * CÂBLAGE — une capacité que le modèle ne sait pas employer est une façade. C'est le défaut rencontré
 * trois fois le 2026-07-29 (le canal de coût sans appelant, la portée non appliquée à la voie à la
 * demande, l'argument `phase` sans mode d'emploi).
 */
describe('câblage — la commande existe et le prompt enseigne quand l’employer', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('la commande `remember` est au catalogue et dispatchée', () => {
    const source = read('commands.ts')
    expect(source).toContain("name: 'remember'")
    expect(source).toContain("case 'remember':")
    expect(source).toContain('rememberFact(a, {')
  })

  it('le prompt dit QUAND retenir et QUAND ne pas', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('`remember`')
    expect(prompt).toMatch(/durable/i)
    expect(prompt).toMatch(/Ne retiens PAS/)
    expect(prompt).toMatch(/r.gle de comportement/i)
  })

  it('le prompt annonce la MÉCANIQUE réelle, pas une mémoire immédiate', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/candidat/i)
    expect(prompt).toMatch(/r.indexation/i)
    // fix-ok: cette assertion exigeait « pas au tour suivant ». C'ETAIT vrai, et ce ne l'est plus : l'echo
    // de session (fonctionnalite livree apres l'audit du 2026-07-30, defaut D9) rend le fait relisible
    // DANS CE FIL. L'exigence ne baisse pas — le prompt doit toujours dire la mecanique reelle — mais
    // celle-ci a desormais DEUX portees, et c'est la confusion entre les deux qui serait le mensonge.
    expect(prompt).toMatch(/DANS CETTE CONVERSATION/)
    expect(prompt).toMatch(/POUR LES AUTRES/)
  })

  it('la LECTURE reste couverte par `brain_query` — pas de régression', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('brain_query')
    expect(read('commands.ts')).toContain("name: 'brain_query'")
  })
})

/**
 * ═══ CONTRAT RÉEL DU BRAIN, découvert par un essai LIVE ═══
 *
 * Ma première version avait été écrite en lisant la copie de la GED. Or le service qui TOURNE est une
 * copie locale (`%LOCALAPPDATA%\AmitelBrain\tooling`), plus avancée. Deux écarts, tous deux invisibles
 * à la lecture et fatals à l'usage :
 *  1. le succès répond un CONTEXTE SIGNÉ (`{context: <chemin>}`), pas `{ok: true}` — ma condition aurait
 *     annoncé « refusé » sur CHAQUE succès ;
 *  2. un 409 « near-duplicate » existe : le Brain sait déjà, ce n'est pas une panne.
 * Plus une validation de source bien plus stricte qu'un préfixe.
 */
describe('contrat réel — la réponse de succès est un contexte signé', () => {
  const reponse = (body: unknown, status = 200): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('rejette un chemin de candidat dont la signature est forgee', async () => {
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: reponse({
        service: 'amitel-brain',
        protocol: 1,
        context: 'C:/brain/inbox/forge.md',
        signature: '0'.repeat(64)
      })
    })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('integrite')
  })

  it('un 200 avec `context` est un SUCCÈS, et le nom de la note en est extrait', async () => {
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: reponse({
        service: 'amitel-brain',
        protocol: 1,
        context: 'C:/brain/inbox/20260730-le-fait.md',
        signature: createHmac('sha256', 'jeton')
          .update('amitel-brain\n1\nC:/brain/inbox/20260730-le-fait.md', 'utf8')
          .digest('hex')
      })
    })
    expect(outcome.stored).toBe(true)
    expect(outcome.note).toBe('20260730-le-fait.md')
  })

  it('un 409 quasi-doublon n’est PAS une erreur — le Brain sait déjà', async () => {
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: reponse({ status: 'near-duplicate' }, 409)
    })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toMatch(/d[ée]j[àa] connu/i)
    // Surtout : ne pas ressembler a une panne, sinon un agent reessaie en boucle.
    expect(outcome.detail).not.toMatch(/erreur|échec|injoignable/i)
  })

  it('un 200 SANS contexte n’est ni un succès ni un refus — état INCONNU', async () => {
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn: reponse({}) })
    expect(outcome.stored).toBe(false)
    // Le defaut corrige : c'etait annonce « refuse par le Brain : HTTP 200 ». Un 200 peut avoir ECRIT ;
    // dire « refuse » pousse a retenter, et le serveur ne dedoublonne pas inbox/.
    expect(outcome.unknown).toBe(true)
    expect(outcome.detail).not.toMatch(/refus/i)
    expect(outcome.detail).toMatch(/inconnu/i)
  })
})

describe('sourceLocatorProblem — le refus ENSEIGNE la forme attendue', () => {
  it('un chemin de dépôt RELATIF est refusé avant le réseau, et git: est suggéré', () => {
    // LE CAS REEL : `file:src/main/...` a ete refuse par le serveur vivant (il cherche le fichier
    // depuis SA racine). Autant le dire tout de suite, avec la bonne forme.
    const probleme = sourceLocatorProblem('file:src/main/providers/npm-global-resolve.ts')
    expect(probleme).toBeDefined()
    expect(probleme).toContain('git:')
  })

  it('la forme git: chemin@sha est acceptée', () => {
    expect(sourceLocatorProblem('git:src/main/x.ts@9218eaf')).toBeUndefined()
  })

  it('un sha trop court est refusé', () => {
    expect(sourceLocatorProblem('git:src/main/x.ts@abc')).toBeDefined()
  })

  it('les autres schémas sont vérifiés sur leur FORME, pas leur préfixe', () => {
    expect(sourceLocatorProblem('ticket:ABC-123')).toBeUndefined()
    expect(sourceLocatorProblem('ticket:abc-123')).toBeDefined() // minuscules refusées côté Brain
    expect(sourceLocatorProblem('url:https://exemple.fr/a')).toBeUndefined()
    expect(sourceLocatorProblem('url:exemple.fr')).toBeDefined()
    expect(sourceLocatorProblem('meeting:2026-07-30')).toBeUndefined()
    expect(sourceLocatorProblem('email:qui@exemple.fr')).toBeUndefined()
  })

  it('un schéma inconnu est nommé, avec la liste des schémas valides', () => {
    const probleme = sourceLocatorProblem('memoire:je me souviens')
    expect(probleme).toContain('memoire')
    expect(probleme).toContain('git')
  })

  it('une source sans deux-points est refusée', () => {
    expect(sourceLocatorProblem('je me souviens')).toBeDefined()
  })
})

describe('câblage — la description dit les FORMES au modèle', () => {
  it('le catalogue montre git:<chemin>@<sha>, pas un simple préfixe', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toContain('git:<chemin>@<sha>')
    expect(source).toContain('ticket:ABC-123')
  })
})

/**
 * DÉFAUTS DE L'AUDIT DU 2026-07-30 — chacun avait un scénario d'échec SILENCIEUX.
 *
 * Deux ont été établis en confrontant le serveur VIVANT, pas en relisant le code :
 *  - `inbox/` n'est PAS indexé, donc le garde anti-doublon du serveur (`NEAR_DUP_DENSE = 0.82`, comparé
 *    au savoir CANONIQUE) ne voit pas les candidats en attente → deux dépôts identiques passent tous les
 *    deux. Corroboré par deux fiches jumelles réelles déposées à 09:47 et 09:48 le 2026-07-30.
 *  - le garde secrets du serveur borne ses mots-clés par `\b`, et `_` est un caractère de mot :
 *    `aws_secret_access_key=…` lui échappe.
 */
describe('audit 2026-07-30 — les échecs silencieux', () => {
  const contexteSigne = (chemin: string): typeof fetch =>
    vi.fn(
      async () => new Response(JSON.stringify(signedContextPayload(chemin)), { status: 200 })
    ) as unknown as typeof fetch

  it('un fait TRONQUÉ le dit — sinon le candidat peut affirmer l’inverse du fait voulu', async () => {
    // La negation tombe APRES la borne : une coupe muette publierait le contraire.
    const fait = `${'Le verrou tient. '.repeat(260)}Mais il ne doit PAS être posé avant la migration.`
    expect(fait.length).toBeGreaterThan(REMEMBER_BODY_MAX)
    const decision = decideRemember({ ...FAIT_VALIDE, fact: fait })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.truncated).toBe(true)
    const outcome = await rememberFact(
      { ...FAIT_VALIDE, fact: fait },
      { token: 'jeton', fetchFn: contexteSigne('C:/brain/inbox/x.md'), deposited: new Map() }
    )
    expect(outcome.stored).toBe(true)
    expect(outcome.detail).toMatch(/tronqu/i)
  })

  it('un fait COURT ne prétend pas être tronqué', () => {
    const decision = decideRemember(FAIT_VALIDE)
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.truncated).toBe(false)
  })

  it('la troncature coupe à une frontière, pas au milieu d’un mot', () => {
    const { body, truncated } = truncateFact(`${'phrase entière ici. '.repeat(300)}fin`, 200)
    expect(truncated).toBe(true)
    expect(body).toMatch(/\[…tronqué\]$/)
    expect(body).not.toMatch(/enti [[]/)
  })

  it('un `fact` vide bascule sur `body` au lieu de refuser un contenu qui existe', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, fact: '', body: 'le vrai contenu du fait' })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.body).toBe('le vrai contenu du fait')
  })

  it('un délai dépassé n’est PAS « injoignable » — le serveur a peut-être écrit', async () => {
    // Un VRAI abort : on attend que la borne déclenche le signal, comme en production. Ma première version
    // jetait une AbortError sans jamais abandonner le signal — elle validait donc une fiction, et c'est
    // elle qui est tombée quand la détection est passée du texte du message à l'état réel du signal.
    const abort: typeof fetch = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const erreur = new Error('The operation was aborted')
            erreur.name = 'AbortError'
            reject(erreur)
          })
        })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: abort,
      timeoutMs: 5,
      deposited: new Map()
    })
    expect(outcome.unknown).toBe(true)
    expect(outcome.detail).not.toMatch(/injoignable/i)
    expect(outcome.detail).toMatch(/inconnu/i)
  })

  it('une vraie panne réseau reste « injoignable » — la distinction doit DISCRIMINER', async () => {
    const mort: typeof fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8765')
    }) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: mort,
      deposited: new Map()
    })
    expect(outcome.unknown).toBeFalsy()
    expect(outcome.detail).toMatch(/injoignable/i)
  })

  it('le MÊME fait déposé deux fois ne part qu’une fois — le serveur ne dédoublonne pas inbox/', async () => {
    const memoire = new Map<string, string>()
    const fetchFn = contexteSigne('C:/brain/inbox/20260730-fait.md')
    const premier = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn, deposited: memoire })
    const second = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn, deposited: memoire })
    expect(premier.stored).toBe(true)
    expect(second.stored).toBe(false)
    expect(second.detail).toMatch(/d[ée]j[àa] d[ée]pos/i)
    // Discriminant : le reseau n'a ete appele QU'UNE fois.
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('un fait DIFFÉRENT part bien, même après un dépôt — l’anti-doublon ne bloque pas tout', async () => {
    const memoire = new Map<string, string>()
    const fetchFn = contexteSigne('C:/brain/inbox/a.md')
    await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn, deposited: memoire })
    const autre = await rememberFact(
      { ...FAIT_VALIDE, title: 'Un tout autre fait', fact: 'un contenu sans rapport' },
      { token: 'jeton', fetchFn, deposited: memoire }
    )
    expect(autre.stored).toBe(true)
  })

  it('un secret que le garde DISTANT laisse passer est refusé ICI', () => {
    // Verifie sur le serveur vivant : `\bsecret\b` ne matche pas au travers d'un underscore, et une cle
    // d'acces nue ne matche aucun motif. Un essai live avait fait ACCEPTER un tel corps.
    for (const fuite of [
      'la config contient aws_secret_access_key=wJalrXUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEY',
      'clé trouvée : AKIAIOSFODNN7EXAMPLE',
      // Signature réaliste : le motif partagé exige ≥8 caractères par segment. Ma fixture d'origine
      // s'arrêtait à « abc » — elle n'aurait jamais ressemblé à un vrai jeton.
      'jeton eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u'
    ]) {
      expect(likelySecretShape(fuite)).toBeDefined()
      expect(decideRemember({ ...FAIT_VALIDE, fact: fuite }).allowed).toBe(false)
    }
  })

  it('un fait ORDINAIRE n’est pas pris pour un secret — le garde doit DISCRIMINER', () => {
    expect(likelySecretShape(FAIT_VALIDE.fact)).toBeUndefined()
    expect(likelySecretShape('le token de session expire au bout de 30 minutes')).toBeUndefined()
    expect(decideRemember(FAIT_VALIDE).allowed).toBe(true)
  })

  it('`scope` et chaque tag sont bornés comme le titre l’est déjà', () => {
    const decision = decideRemember({
      ...FAIT_VALIDE,
      scope: 'x'.repeat(500),
      tags: ['y'.repeat(500), 'court']
    })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.scope.length).toBe(REMEMBER_SCOPE_MAX)
    expect(decision.tags[0]?.length).toBe(REMEMBER_TAG_MAX)
  })

  it('la forme meeting est STRICTE — du texte en trop ne passe plus', () => {
    expect(sourceLocatorProblem('meeting:2026-07-30')).toBeUndefined()
    expect(sourceLocatorProblem('meeting:2026-07-30 et n’importe quoi ensuite')).toBeDefined()
  })

  it('un chemin Windows SANS préfixe dit qu’il manque le préfixe, pas « schéma c inconnu »', () => {
    const probleme = sourceLocatorProblem('C:\\Users\\moi\\fichier.ts')
    expect(probleme).toBeDefined()
    expect(probleme).not.toMatch(/sch[ée]ma/i)
    expect(probleme).toMatch(/pr[ée]fixe/i)
    expect(sourceLocatorProblem('\\\\ged2\\rig\\note.md')).toMatch(/pr[ée]fixe/i)
  })
})

/**
 * CYCLE 2 DE L'AUDIT — les régressions que MES correctifs avaient introduites.
 *
 * Deux d'entre elles étaient des FAUX REFUS : le pire des deux sens ici, puisqu'un second garde tourne
 * derrière et qu'un refus injustifié empêche de retenir un fait valide.
 */
describe('audit 2026-07-30 cycle 2 — les faux refus que j’avais créés', () => {
  it('un chemin de dépôt AVEC UN ESPACE est accepté par git: — ce dépôt s’appelle « Autowin OS »', () => {
    // Mon premier ancrage (`^[^\s]+@`) interdisait l'espace : le cas le plus courant de cette machine
    // devenait un refus, et aucun test ne l'attrapait puisqu'ils utilisaient tous un chemin sans espace.
    expect(
      sourceLocatorProblem('git:C:/Amitel/Autowin OS/src/main/brain-remember.ts@ce4a595')
    ).toBeUndefined()
    // L'ancrage doit tout de même mordre : un sha trop court reste refusé.
    expect(sourceLocatorProblem('git:src/main/x.ts@abc')).toBeDefined()
    // Et un locator multiligne ne doit pas passer par sa seule dernière ligne.
    expect(sourceLocatorProblem('git:bidon\nsrc/x.ts@9218eaf')).toBeDefined()
  })

  it('un fait technique légitime nommant une clé n’est PAS pris pour un secret', () => {
    // Les 3 entrées nommées par l'audit : un en-tête, un nom de variable d'environnement, un TTL.
    for (const legitime of [
      'csrf_token_header: X-CSRF-Token',
      'db_password_env: RIG_DB_PASSWORD',
      'refresh_token_ttl = 3600000000'
    ]) {
      expect(likelySecretShape(legitime)).toBeUndefined()
      expect(decideRemember({ ...FAIT_VALIDE, fact: legitime }).allowed).toBe(true)
    }
  })

  it('un fait qui NOMME une clé sans en donner la valeur est ACCEPTÉ', () => {
    // La classe de faux refus qui a récidivé DEUX fois : c'est le cœur de ce que la fonctionnalité doit
    // pouvoir retenir (documenter un en-tête, un nom de variable, un comportement). Ces 8 entrées viennent
    // du cycle 3 de l'audit, où elles étaient toutes refusées.
    for (const legitime of [
      "le champ token: obligatoire dans l'entête de /ingest",
      "api_key: a demander a l'administrateur du Brain",
      'password: stocke dans Keepass, jamais dans le depot',
      'secret: nom du champ, pas sa valeur',
      'token = null quand la session expire',
      'config: token=<TON_JETON>',
      'AMITEL_BRAIN_TOKEN=... (valeur a definir)',
      'Bearer suivi du jeton, dans l’en-tête Authorization'
    ]) {
      expect(likelySecretShape(legitime)).toBeUndefined()
      expect(decideRemember({ ...FAIT_VALIDE, fact: legitime }).allowed).toBe(true)
    }
  })

  it('mais un mot-clé suivi d’une VRAIE valeur est refusé — le garde doit DISCRIMINER', () => {
    expect(likelySecretShape('token=aB3xKq9ZmR7tPw2LnV5c')).toBeDefined()
    expect(likelySecretShape('password: Hunter2Hunter2Hunter2x9')).toBeDefined()
  })

  it('la forme CANONIQUE d’un secret — la variable d’environnement en MAJUSCULES — est vue', () => {
    // Trou mesuré le 2026-07-30 : le garde était sensible à la casse sur le NOM de la clé, or c'est
    // justement en majuscules qu'un secret s'écrit. Il partait donc dans un corpus partagé.
    expect(
      likelySecretShape('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEY')
    ).toBeDefined()
    expect(likelySecretShape('TOKEN=aB3dEfGhIjKlMnOpQ12')).toBeDefined()
    expect(likelySecretShape('Password: aB3dEfGhIjKlMnOpQ12')).toBeDefined()
    // Mot-cle en DEBUT de chaine, sans prefixe : la regle exigeait un caractere avant.
    expect(likelySecretShape('secret_key=aB3dEfGhIjKlMnOpQ12')).toBeDefined()
  })

  it('un CHEMIN ou une RÉFÉRENCE ne sont pas des secrets — les faux refus du cycle 4', () => {
    // Les 4 entrées nommées par les juges. Un faux refus bloque une mémoire valide, et c'est le sens
    // coûteux ici puisqu'un second garde tourne derrière.
    for (const legitime of [
      'auth_token_endpoint: /api/v2/oauth/token/refresh',
      'refresh_token_path: /var/lib/rig/session2/token.json',
      'reference du lot SK-10023847 chez le fournisseur',
      'token_url: https://exemple.fr/oauth/token2'
    ]) {
      expect(likelySecretShape(legitime)).toBeUndefined()
      expect(decideRemember({ ...FAIT_VALIDE, fact: legitime }).allowed).toBe(true)
    }
  })

  it('le fait RÉELLEMENT déposé remonte à l’appelant, pas les arguments bruts', async () => {
    // Sans ça, l'écho s'alimentait de `a.fact ?? a.body` : `{fact:'', body:'…'}` déposait au Brain et
    // échoait une chaîne vide, silencieusement rejetée — « retenu » promis, rien au tour suivant.
    const outcome = await rememberFact(
      { ...FAIT_VALIDE, fact: '', body: 'le vrai contenu du fait' },
      {
        token: 'jeton',
        fetchFn: vi.fn(
          async () =>
            new Response(JSON.stringify(signedContextPayload('C:/brain/inbox/x.md')), {
              status: 200
            })
        ) as unknown as typeof fetch,
        deposited: new Map()
      }
    )
    expect(outcome.stored).toBe(true)
    expect(outcome.fact?.body).toBe('le vrai contenu du fait')
    expect(outcome.fact?.title).toBe(FAIT_VALIDE.title)
    expect(outcome.fact?.scope).toBe(FAIT_VALIDE.scope)
  })

  it('le fait remonte MÊME quand le Brain est injoignable — sinon rien n’est retenu du tout', async () => {
    const mort: typeof fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8765')
    }) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: mort,
      deposited: new Map()
    })
    expect(outcome.stored).toBe(false)
    expect(outcome.fact?.body).toContain('shims')
  })

  it('un fait IRRECEVABLE ne remonte AUCUN contenu — le signal doit DISCRIMINER', async () => {
    const outcome = await rememberFact({ ...FAIT_VALIDE, type: 'inconnu' }, { token: 'jeton' })
    expect(outcome.allowed).toBe(false)
    expect(outcome.fact).toBeUndefined()
  })

  it('les formes de jetons connues sont couvertes — sans les recopier ici', () => {
    // Réutilise `SECRET_VALUE` de trace-redact.ts au lieu de dupliquer ses motifs (défaut « dup »).
    //
    // Les fixtures sont des PLACEHOLDERS explicites, jamais des jetons d'apparence réelle : ma première
    // version en portait qui en avaient l'air, et l'analyse de secrets de GitHub a REFUSÉ la poussée
    // (GH013, « Slack API Token », le 2026-07-30). Un détecteur de secrets attrapé par un détecteur de
    // secrets. La bonne réponse n'était pas d'autoriser l'exception mais de rendre la fixture
    // manifestement factice : elle doit exercer NOTRE motif, pas ressembler à un identifiant.
    for (const fuite of [
      'ghp_EXEMPLE_NON_VALIDE_A_NE_PAS_UTILISER_0000',
      'xoxb-EXEMPLE-NON-VALIDE-0000',
      'sk-proj-EXEMPLE-NON-VALIDE-0000',
      // Celle-ci est l'exemple officiel de la documentation AWS, donc sans ambiguïté.
      'clé AKIAIOSFODNN7EXAMPLE trouvée dans le fichier',
      // Casse MIXTE : le garde exige désormais minuscule + MAJUSCULE + chiffre dans la valeur, pour ne
      // plus refuser `RIG_DB_PASSWORD` ni `/api/v2/oauth/token`. Le placeholder doit donc en porter.
      'aws_secret_access_key=Exemple0NonValide0ANePasUtiliser'
    ]) {
      expect(likelySecretShape(fuite)).toBeDefined()
    }
  })

  it('le garde de secret ne garde pas d’état entre deux appels', () => {
    // `SECRET_VALUE` porte le drapeau `g` : sans remise à zéro de `lastIndex`, un appel sur deux échouait.
    const fuite = 'clé AKIAIOSFODNN7EXAMPLE trouvée'
    expect(likelySecretShape(fuite)).toBeDefined()
    expect(likelySecretShape(fuite)).toBeDefined()
    expect(likelySecretShape(fuite)).toBeDefined()
  })

  it('une panne réseau qui contient « abort » reste une panne, pas un délai dépassé', async () => {
    // `read ECONNABORTED` contient « abort » : décider sur le TEXTE le classait « délai dépassé » et
    // dissuadait un retry légitime. La décision porte désormais sur l'état réel du signal.
    const abortee: typeof fetch = vi.fn(async () => {
      throw new Error('read ECONNABORTED 127.0.0.1:8765')
    }) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, {
      token: 'jeton',
      fetchFn: abortee,
      deposited: new Map()
    })
    expect(outcome.unknown).toBeFalsy()
    expect(outcome.detail).toMatch(/injoignable/i)
  })

  it('la troncature RESPECTE la borne, marque comprise', () => {
    for (const cas of [
      'A'.repeat(5_000),
      `${'mot '.repeat(1_500)}fin`,
      `Court. ${'x'.repeat(5_000)}`
    ]) {
      const { body, truncated } = truncateFact(cas)
      expect(truncated).toBe(true)
      expect(body.length).toBeLessThanOrEqual(REMEMBER_BODY_MAX)
    }
    // Les bornes exactes : 4 000 passe intact, 4 001 est tronqué.
    expect(truncateFact('x'.repeat(REMEMBER_BODY_MAX)).truncated).toBe(false)
    expect(truncateFact('x'.repeat(REMEMBER_BODY_MAX + 1)).truncated).toBe(true)
    // Et sous la longueur de la marque, la marque ne doit pas faire dépasser la borne.
    for (const petit of [0, 5, 11, 12]) {
      expect(truncateFact('x'.repeat(100), petit).body.length).toBeLessThanOrEqual(petit)
    }
  })

  it('au-delà de 8 étiquettes, l’amputation est signalée', () => {
    const decision = decideRemember({
      ...FAIT_VALIDE,
      tags: Array.from({ length: 12 }, (_v, i) => `tag${i}`)
    })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.tags).toHaveLength(8)
    expect(decision.truncated).toBe(true)
  })

  it('une UNC sans préfixe enseigne le préfixe dans LES DEUX écritures', () => {
    // Une UNC ne contient aucun deux-points : le garde devait passer AVANT ce test, sinon il ne servait à rien.
    expect(sourceLocatorProblem('//ged2/rig/Projets IA/note.md')).toMatch(/pr[ée]fixe manquant/i)
    expect(sourceLocatorProblem('\\\\ged2\\rig\\note.md')).toMatch(/pr[ée]fixe manquant/i)
    // Contre-controle : une url legitime n'est pas affectee.
    expect(sourceLocatorProblem('url:https://exemple.fr/x')).toBeUndefined()
  })

  it('une fin de phrase TRÈS tôt ne fait pas jeter l’essentiel du fait', () => {
    // Justifie le seuil de moitié, que l'audit soupçonnait d'être un réglage arbitraire : sans lui, on
    // couperait à « Bref. » et on perdrait tout le reste.
    const { body } = truncateFact(`Bref. ${'du contenu qui compte '.repeat(50)}`, 200)
    expect(body.length).toBeGreaterThan(100)
  })

  it('un TITRE ou une étiquette amputés sont signalés, pas coupés en silence', () => {
    const titreLong = decideRemember({ ...FAIT_VALIDE, title: 'T'.repeat(300) })
    expect(titreLong.allowed).toBe(true)
    if (titreLong.allowed) expect(titreLong.truncated).toBe(true)
    const tagLong = decideRemember({ ...FAIT_VALIDE, tags: ['y'.repeat(300)] })
    expect(tagLong.allowed).toBe(true)
    if (tagLong.allowed) expect(tagLong.truncated).toBe(true)
    // Contre-controle : rien de trop long, rien de signale.
    const normal = decideRemember({ ...FAIT_VALIDE, tags: ['cli'] })
    if (normal.allowed) expect(normal.truncated).toBe(false)
  })

  it('une UNC en slashes sans préfixe enseigne le préfixe — c’est la forme de la GED ici', () => {
    expect(sourceLocatorProblem('//ged2/rig/Projets IA/note.md')).toMatch(/pr[ée]fixe/i)
  })
})

describe('câblage — le prompt enseigne toutes les formes, dont le repli session:', () => {
  const prompt = (): string => buildChatPilotagePrompt([])

  it('le repli `session:` est ENSEIGNÉ — c’est le cas de « retiens ça » sans artefact', () => {
    // Defaut trouve INDEPENDAMMENT par les deux lentilles de fidelite : le prompt n'offrait aucune forme
    // valide pour un fait dit a l'oral, donc le seul cas litteral de la demande echouait avant le reseau.
    expect(prompt()).toContain('session:')
  })

  it('les 7 formes acceptées par le code sont toutes dans le prompt', () => {
    const texte = prompt()
    for (const schema of REMEMBER_SOURCE_SCHEMES) expect(texte).toContain(`${schema}:`)
  })

  it('`file:` porte sa contrainte (absolu) et renvoie vers git: — la forme refusée en live', () => {
    const texte = prompt()
    expect(texte).toMatch(/file:<chemin ABSOLU/)
    expect(texte).toMatch(/relatif est\s+REFUS/i)
  })

  it('le prompt dit QUAND relire avec brain_query, pas seulement qu’il existe', () => {
    expect(prompt()).toMatch(/POUR RELIRE/)
  })
})
