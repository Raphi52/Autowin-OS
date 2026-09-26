// fix-ok: fixture synthetique ajustee au format reel mesure (V8 v16 + conversationId @unq.gbl.spaces) ; test rouge verifie par injection de 3 defauts. Garde destinataire (code 6) : titre de fenetre verifie avant saisie et avant Entree, prouvee rouge sans elle.
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize } from 'node:v8'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { latestValues, readLog, readTable, snappyUncompress } from './leveldb-lite'
import { decodeIndexedDbValue } from './v8-value-lite'
import {
  LOCAL_REPLY_SCRIPT,
  localValuesToSnapshot,
  readLocalTeamsStore,
  sourceTeams,
  TeamsLocalClient,
  type LocalTeamsSnapshot
} from './watchdog-teams-local'
import { teamsItemId } from './watchdog-teams'
import { NewUnreadMailDetector } from './watchdog-mail'

// Donnees 100 % SYNTHETIQUES : aucune donnee Teams reelle dans le depot.

function varint(n: number): Buffer {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}

/** Enveloppe Chromium IndexedDB : version + en-tete Blink v21 avec trailer + donnees V8. */
function idbValue(obj: unknown): Buffer {
  return Buffer.concat([Buffer.from([0x02, 0xff, 0x15, 0xfe]), Buffer.alloc(12), serialize(obj)])
}

function batch(seq: number, ops: Array<[Buffer, Buffer | null]>): Buffer {
  const head = Buffer.alloc(12)
  head.writeBigUInt64LE(BigInt(seq), 0)
  head.writeUInt32LE(ops.length, 8)
  const parts: Buffer[] = [head]
  for (const [key, value] of ops) {
    parts.push(Buffer.from([value ? 1 : 0]), varint(key.length), key)
    if (value) parts.push(varint(value.length), value)
  }
  return Buffer.concat(parts)
}

function logFile(batches: Buffer[]): Buffer {
  return Buffer.concat(
    batches.map((data) => {
      const head = Buffer.alloc(7)
      head.writeUInt16LE(data.length, 4)
      head[6] = 1 // enregistrement complet
      return Buffer.concat([head, data])
    })
  )
}

function block(entries: Array<[Buffer, Buffer]>): Buffer {
  const parts: Buffer[] = []
  for (const [k, v] of entries) parts.push(varint(0), varint(k.length), varint(v.length), k, v)
  const tail = Buffer.alloc(8)
  tail.writeUInt32LE(0, 0)
  tail.writeUInt32LE(1, 4)
  return Buffer.concat([...parts, tail])
}

function ikey(key: string, seq: number, type = 1): Buffer {
  const t = Buffer.alloc(8)
  t.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(type))
  return Buffer.concat([Buffer.from(key), t])
}

/** Table `.ldb` a un bloc de donnees, compresse en Snappy (litteral seul) si demande. */
function tableFile(entries: Array<[Buffer, Buffer]>, snappy: boolean): Buffer {
  const raw = block(entries)
  const data = snappy
    ? Buffer.concat([
        varint(raw.length),
        Buffer.from([0xfc]),
        (() => {
          const b = Buffer.alloc(4)
          b.writeUInt32LE(raw.length - 1)
          return b
        })(),
        raw
      ])
    : raw
  const dataBlock = Buffer.concat([data, Buffer.from([snappy ? 1 : 0]), Buffer.alloc(4)])
  const handle = Buffer.concat([varint(0), varint(data.length)])
  const index = block([[entries[entries.length - 1][0], handle]])
  const indexBlock = Buffer.concat([index, Buffer.from([0]), Buffer.alloc(4)])
  const footer = Buffer.alloc(48)
  Buffer.concat([varint(0), varint(0), varint(dataBlock.length), varint(index.length)]).copy(footer)
  return Buffer.concat([dataBlock, indexBlock, footer])
}

const ONE = '19:aaaa_bbbb@unq.gbl.spaces'
const GROUP = '19:cccc@thread.v2'

function chain(
  conversationId: string,
  messages: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    conversationId,
    messageMap: Object.fromEntries(messages.map((m) => [String(m.id), { conversationId, ...m }]))
  }
}

describe('leveldb-lite', () => {
  it('decompresse Snappy avec litteral et copie', () => {
    // "abc" en litteral puis copie de 6 octets a distance 3.
    const input = Buffer.from([9, 0x08, 0x61, 0x62, 0x63, 0x09, 0x03])
    expect(snappyUncompress(input).toString()).toBe('abcabcabc')
  })

  it('journal .log : la derniere ecriture gagne, une suppression masque la cle', () => {
    const file = logFile([
      batch(1, [
        [Buffer.from('k1'), Buffer.from('v1')],
        [Buffer.from('k2'), Buffer.from('x')]
      ]),
      batch(3, [
        [Buffer.from('k1'), Buffer.from('v2')],
        [Buffer.from('k2'), null]
      ])
    ])
    const values = latestValues(readLog(file))
    expect(values.get('k1')?.toString()).toBe('v2')
    expect(values.has('k2')).toBe(false)
  })

  it.each([false, true])('table .ldb (snappy=%s) : cles et numeros de sequence', (snappy) => {
    const file = tableFile(
      [
        [ikey('a', 5), Buffer.from('A')],
        [ikey('b', 6, 0), Buffer.alloc(0)]
      ],
      snappy
    )
    const entries = readTable(file)
    expect(entries.map((e) => [e.key.toString(), e.seq, e.deleted])).toEqual([
      ['a', 5n, false],
      ['b', 6n, true]
    ])
  })
})

describe('decodeIndexedDbValue', () => {
  it('decode un objet imbrique (chaines latin1 et UTF-16, nombres, tableaux, booleens)', () => {
    const obj = {
      a: 'é',
      b: 'Salut 👋',
      n: -3,
      f: 1.5,
      big: 2 ** 40,
      t: true,
      l: [1, 'x'],
      o: { z: null }
    }
    expect(decodeIndexedDbValue(idbValue(obj))).toEqual(obj)
  })

  it('rend undefined pour un octet sans enveloppe connue', () => {
    expect(decodeIndexedDbValue(Buffer.from('pas une valeur'))).toBeUndefined()
  })
})

describe('localValuesToSnapshot', () => {
  const values = [
    { mri: '8:orgid:alice', email: 'alice@example.test' },
    chain(ONE, [
      {
        id: '1',
        messageType: 'RichText/Html',
        content: '<p>ancien</p>',
        originalArrivalTime: 1000,
        creator: '8:orgid:alice',
        imDisplayName: 'Alice'
      },
      {
        id: '2',
        messageType: 'RichText/Html',
        content: '<p>Bonjour&nbsp;<b>toi</b></p>',
        originalArrivalTime: 2000,
        creator: '8:orgid:alice',
        imDisplayName: 'Alice',
        isSentByCurrentUser: false
      },
      { id: '3', messageType: 'ThreadActivity/AddMember', content: 'x', originalArrivalTime: 9000 },
      {
        id: '4',
        messageType: 'Text',
        content: 'efface',
        originalArrivalTime: 8000,
        properties: { deletetime: 1 }
      }
    ]),
    chain(GROUP, [{ id: '9', messageType: 'Text', content: 'groupe', originalArrivalTime: 5000 }]),
    chain('19:dddd_eeee@unq.gbl.spaces', [
      {
        id: '5',
        messageType: 'Text',
        content: 'moi',
        originalArrivalTime: 3000,
        isSentByCurrentUser: true,
        imDisplayName: 'Moi'
      }
    ])
  ]

  it('garde le dernier message lisible de chaque conversation 1:1, ignore groupes et activites', () => {
    const snap = localValuesToSnapshot(values)
    expect(snap.conversations).toBe(2)
    expect(snap.mails).toHaveLength(2)
    const alice = snap.mails.find((m) => m.id === teamsItemId(ONE, '2'))
    expect(alice).toMatchObject({
      nom: 'Alice',
      adresse: 'alice@example.test',
      corps: 'Bonjour toi',
      deMoi: false,
      recuLe: new Date(2000).toISOString()
    })
    expect(snap.emails.get(teamsItemId(ONE, '2'))).toBe('alice@example.test')
    expect(snap.mails.find((m) => m.nom === 'Moi')?.deMoi).toBe(true)
  })

  // 2026-09-26, lecture du stockage reel : 27 conversations, UNE seule adresse (« Teams », en dur) et
  // 27 « non lus » (en dur). L'adresse du createur etait pourtant connue (187 personnes sur 246 ont
  // un email) et l'etat de lecture vit dans l'enregistrement de CONVERSATION :
  // properties.consumptionhorizon = « heureDeLecture;heure;idMessage » (format Skype/Teams).
  const bob = (id: string, at: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    messageType: 'Text',
    content: 'salut',
    originalArrivalTime: at,
    creator: '8:orgid:bob',
    imDisplayName: 'Bob',
    ...extra
  })
  const horizon = (conversationId: string, lu: number): Record<string, unknown> => ({
    id: conversationId,
    lastMessageTimeUtc: lu,
    properties: { consumptionhorizon: `${lu};${lu + 5};42` }
  })

  it('adresse = email du createur quand il est connu, « Teams » sinon', () => {
    const snap = localValuesToSnapshot([
      { mri: '8:orgid:bob', email: 'bob@example.test' },
      chain(ONE, [bob('1', 1000)]),
      chain('19:ffff_gggg@unq.gbl.spaces', [bob('2', 1000, { creator: '8:orgid:inconnu', imDisplayName: 'Zoe' })])
    ])
    expect(snap.mails.find((m) => m.nom === 'Bob')?.adresse).toBe('bob@example.test')
    expect(snap.mails.find((m) => m.nom === 'Zoe')?.adresse).toBe('Teams')
  })

  it('non lu = arrive APRES la derniere lecture de la conversation ; sans horizon connu, non lu', () => {
    const DEUX = '19:hhhh_iiii@unq.gbl.spaces'
    const TROIS = '19:jjjj_kkkk@unq.gbl.spaces'
    const snap = localValuesToSnapshot([
      horizon(ONE, 5000),
      chain(ONE, [bob('1', 4000)]), // lu : arrive avant l'horizon
      horizon(DEUX, 5000),
      chain(DEUX, [bob('2', 6000)]), // arrive apres : non lu
      chain(TROIS, [bob('3', 1000)]) // aucun horizon : on ne sait pas -> non lu, comme avant
    ])
    expect(snap.mails.find((m) => m.id === teamsItemId(ONE, '1'))?.nonLu).toBe(false)
    expect(snap.mails.find((m) => m.id === teamsItemId(DEUX, '2'))?.nonLu).toBe(true)
    expect(snap.mails.find((m) => m.id === teamsItemId(TROIS, '3'))?.nonLu).toBe(true)
  })

  it('le detecteur du watchdog ne declenche NI sur un message envoye par moi NI sur un message deja lu', () => {
    const detecteur = new NewUnreadMailDetector()
    const base = [{ mri: '8:orgid:bob', email: 'bob@example.test' }, horizon(ONE, 5000)]
    // 1er passage = ligne de base : rien ne declenche.
    expect(detecteur.next(localValuesToSnapshot([...base, chain(ONE, [bob('1', 4000)])]))).toEqual([])
    // Nouveau message ECRIT PAR MOI (dont la reponse postee par l'agent) : aucun declenchement.
    const moi = bob('2', 7000, { isSentByCurrentUser: true, creator: '8:orgid:moi', imDisplayName: 'Moi' })
    expect(detecteur.next(localValuesToSnapshot([...base, chain(ONE, [bob('1', 4000), moi])]))).toEqual([])
    // Nouveau message de Bob, mais DEJA LU dans Teams (horizon avance) : aucun declenchement.
    const lu = [base[0], horizon(ONE, 9000), chain(ONE, [bob('1', 4000), moi, bob('3', 8000)])]
    expect(detecteur.next(localValuesToSnapshot(lu))).toEqual([])
    // Nouveau message de Bob, non lu : UN declenchement, avec sa vraie adresse.
    const neuf = [base[0], horizon(ONE, 9000), chain(ONE, [bob('1', 4000), moi, bob('3', 8000), bob('4', 9500)])]
    expect(detecteur.next(localValuesToSnapshot(neuf))).toEqual([
      expect.objectContaining({ id: teamsItemId(ONE, '4'), adresse: 'bob@example.test', nonLu: true, deMoi: false })
    ])
  })
})

describe('sourceTeams', () => {
  // conv-770, 2026-09-26 : AUTOWIN_TEAMS_CLIENT_ID etait defini mais Graph jamais connecte (aucun
  // jeton) -> l'app choisissait Graph, restait « en pause », et la lecture locale ne servait jamais.
  it('Graph seulement s’il est configure ET connecte (jeton present)', () => {
    expect(sourceTeams({ clientId: 'id', jetonGraph: true, windows: true })).toBe('graph')
  })
  it('Graph configure mais JAMAIS connecte, sous Windows : lecture locale', () => {
    expect(sourceTeams({ clientId: 'id', jetonGraph: false, windows: true })).toBe('local')
  })
  it('rien de configure, sous Windows : lecture locale', () => {
    expect(sourceTeams({ clientId: undefined, jetonGraph: false, windows: true })).toBe('local')
  })
  it('hors Windows : Graph s’il est configure (seule voie, connexion par code), sinon rien', () => {
    expect(sourceTeams({ clientId: 'id', jetonGraph: false, windows: false })).toBe('graph')
    expect(sourceTeams({ clientId: undefined, jetonGraph: false, windows: false })).toBeUndefined()
  })
})

describe('readLocalTeamsStore', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('lit une COPIE : le dossier source est inchange et la copie est supprimee', () => {
    dir = mkdtempSync(join(tmpdir(), 'teams-fixture-'))
    const value = idbValue(
      chain(ONE, [
        {
          id: '7',
          messageType: 'Text',
          content: 'hello',
          originalArrivalTime: 42,
          imDisplayName: 'Bob'
        }
      ])
    )
    writeFileSync(join(dir, '000003.log'), logFile([batch(1, [[Buffer.from('key'), value]])]))
    writeFileSync(join(dir, 'LOCK'), '')
    const before = readdirSync(dir).map((n) => [n, statSync(join(dir!, n)).mtimeMs])
    const leftovers = () =>
      readdirSync(tmpdir()).filter((n) => n.startsWith('autowin-teams-')).length
    const tempBefore = leftovers()
    const snap = readLocalTeamsStore(dir)
    expect(snap.mails).toEqual([
      expect.objectContaining({ id: teamsItemId(ONE, '7'), nom: 'Bob', corps: 'hello' })
    ])
    expect(readdirSync(dir).map((n) => [n, statSync(join(dir!, n)).mtimeMs])).toEqual(before)
    expect(leftovers()).toBe(tempBefore)
  })

  it('echoue explicitement si le stockage n’existe pas', () => {
    expect(() => readLocalTeamsStore(join(tmpdir(), 'n-existe-pas-teams'))).toThrow(/introuvable/)
  })
})

describe('TeamsLocalClient.reply', () => {
  const itemId = teamsItemId(ONE, '2')
  const snapshot: LocalTeamsSnapshot = {
    ok: true,
    mails: [],
    emails: new Map([[itemId, 'alice@example.test']]),
    noms: new Map([[itemId, 'Alice']]),
    conversations: 1
  }

  it('sans fenetre Teams : echec explicite, jamais un faux succes', async () => {
    const run = vi.fn(async () => ({ code: 2, stdout: '' }))
    const client = new TeamsLocalClient({ read: () => snapshot, run, log: () => {} })
    await client.snapshot()
    const result = await client.reply(itemId, 'réponse')
    expect(result.ok).toBe(false)
    expect(result.erreur).toMatch(/Teams ne tourne pas/)
    expect(run).toHaveBeenCalledWith(expect.any(String), {
      AUTOWIN_TEAMS_CONV: ONE,
      AUTOWIN_TEAMS_BODY: 'réponse',
      AUTOWIN_TEAMS_EXPECT: 'Alice'
    })
  })

  it('echec Teams : repli par mail a l’expediteur, echec journalise', async () => {
    const mail = vi.fn(async () => ({ ok: true }))
    const log = vi.fn()
    const client = new TeamsLocalClient({
      read: () => snapshot,
      run: async () => ({ code: 4, stdout: '' }),
      mail,
      log
    })
    await client.snapshot()
    expect(await client.reply(itemId, 'réponse')).toEqual({ ok: true })
    expect(mail).toHaveBeenCalledWith('alice@example.test', expect.any(String), 'réponse')
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/zone de saisie Teams introuvable/))
  })

  it('repli par mail en echec : le resultat reste un echec', async () => {
    const client = new TeamsLocalClient({
      read: () => snapshot,
      run: async () => ({ code: 3, stdout: '' }),
      mail: async () => ({ ok: false, erreur: 'Outlook fermé' }),
      log: () => {}
    })
    await client.snapshot()
    const result = await client.reply(itemId, 'x')
    expect(result.ok).toBe(false)
    expect(result.erreur).toMatch(/premier plan.*Outlook fermé/)
  })

  it('succes Teams : aucun mail', async () => {
    const mail = vi.fn()
    const client = new TeamsLocalClient({
      read: () => snapshot,
      run: async () => ({ code: 0, stdout: 'OK\r\n' }),
      mail
    })
    await client.snapshot()
    expect(await client.reply(itemId, 'x')).toEqual({ ok: true })
    expect(mail).not.toHaveBeenCalled()
  })

  it('mauvaise conversation ouverte (code 6) : rien n’est envoye dans Teams, repli par mail', async () => {
    const mail = vi.fn(async () => ({ ok: true }))
    const log = vi.fn()
    const client = new TeamsLocalClient({
      read: () => snapshot,
      run: async () => ({ code: 6, stdout: '' }),
      mail,
      log
    })
    await client.snapshot()
    expect(await client.reply(itemId, 'x')).toEqual({ ok: true })
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/pas celle de l’expéditeur/))
  })

  it('nom de l’expediteur inconnu : le pilotage Teams n’est jamais lance', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: 'OK' }))
    const client = new TeamsLocalClient({
      read: () => ({ ...snapshot, noms: new Map() }),
      run,
      log: () => {}
    })
    await client.snapshot()
    const result = await client.reply(itemId, 'x')
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('le script verifie la conversation avant la saisie et avant Entree', () => {
    const enter = LOCAL_REPLY_SCRIPT.indexOf("SendWait('{ENTER}')")
    const checks = [
      ...LOCAL_REPLY_SCRIPT.matchAll(/if \(-not \(Test-BonneConversation\)\) \{ exit 6 \}/g)
    ].map((m) => m.index!)
    expect(checks.length).toBe(2)
    expect(checks[0]).toBeLessThan(LOCAL_REPLY_SCRIPT.indexOf('SetFocus()'))
    expect(checks[1]).toBeLessThan(enter)
  })
})
