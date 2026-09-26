// fix-ok: aucune lib leveldb/snappy dans package.json et les blocs .ldb de Teams sont compresses Snappy — editions successives = ajout du decodeur puis reparation de la ligne 33 abimee par un sed au nettoyage (mesure : typecheck rouge puis vert).
/**
 * Lecteur LevelDB minimal, en LECTURE SEULE et sans dependance (demande conv-854, 2026-09-25).
 *
 * Sert a lire le stockage IndexedDB du client Teams (WebView2/Chromium) : tables `.ldb`
 * (compression Snappy ou aucune) et journal `.log` (lots d'ecriture). Pour chaque cle, seule la
 * version au plus grand numero de sequence est gardee ; une suppression la masque.
 * Aucun controle CRC : un bloc illisible est ignore, jamais une exception qui arrete la lecture.
 */

export interface LevelEntry {
  key: Buffer
  value: Buffer
  seq: bigint
  deleted: boolean
}

function varint(buf: Buffer, pos: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    if (pos >= buf.length) throw new Error('varint tronque')
    const byte = buf[pos++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [result, pos]
    shift += 7
    if (shift > 49) throw new Error('varint trop long')
  }
}

/** Decompression Snappy (format brut, tel qu'employe par LevelDB). */
export function snappyUncompress(input: Buffer): Buffer {
  const [length, start] = varint(input, 0)
  let pos = start
  const out = Buffer.alloc(length)
  let o = 0
  while (pos < input.length) {
    const tag = input[pos++]
    const kind = tag & 3
    if (kind === 0) {
      let len = tag >> 2
      if (len >= 60) {
        const extra = len - 59
        len = input.readUIntLE(pos, extra)
        pos += extra
      }
      len += 1
      input.copy(out, o, pos, pos + len)
      pos += len
      o += len
      continue
    }
    let len: number
    let offset: number
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | input[pos++]
    } else if (kind === 2) {
      len = (tag >> 2) + 1
      offset = input.readUInt16LE(pos)
      pos += 2
    } else {
      len = (tag >> 2) + 1
      offset = input.readUInt32LE(pos)
      pos += 4
    }
    if (offset === 0 || offset > o) throw new Error('snappy : copie hors limites')
    for (let i = 0; i < len; i++, o++) out[o] = out[o - offset]
  }
  if (o !== length) throw new Error('snappy : longueur incoherente')
  return out
}

function readBlock(file: Buffer, offset: number, size: number): Buffer {
  const raw = file.subarray(offset, offset + size)
  const type = file[offset + size]
  if (type === 0) return raw
  if (type === 1) return snappyUncompress(raw)
  throw new Error(`compression inconnue ${type}`)
}

function* blockEntries(block: Buffer): Generator<[Buffer, Buffer]> {
  const restarts = block.readUInt32LE(block.length - 4)
  const end = block.length - 4 - restarts * 4
  let pos = 0
  let last = Buffer.alloc(0)
  while (pos < end) {
    let shared: number, nonShared: number, valueLen: number
    ;[shared, pos] = varint(block, pos)
    ;[nonShared, pos] = varint(block, pos)
    ;[valueLen, pos] = varint(block, pos)
    const key = Buffer.concat([last.subarray(0, shared), block.subarray(pos, pos + nonShared)])
    pos += nonShared
    const value = block.subarray(pos, pos + valueLen)
    pos += valueLen
    last = key
    yield [key, value]
  }
}

function splitInternalKey(ikey: Buffer): { key: Buffer; seq: bigint; deleted: boolean } {
  const trailer = ikey.readBigUInt64LE(ikey.length - 8)
  return {
    key: ikey.subarray(0, ikey.length - 8),
    seq: trailer >> 8n,
    deleted: (trailer & 0xffn) === 0n
  }
}

/** Toutes les entrees d'une table `.ldb`. */
export function readTable(file: Buffer): LevelEntry[] {
  const footer = file.subarray(file.length - 48)
  const [, p1] = varint(footer, 0) // metaindex offset
  const [, p2] = varint(footer, p1) // metaindex size
  const [indexOffset, p3] = varint(footer, p2)
  const [indexSize] = varint(footer, p3)
  const entries: LevelEntry[] = []
  for (const [, handle] of blockEntries(readBlock(file, indexOffset, indexSize))) {
    try {
      const [offset, p] = varint(handle, 0)
      const [size] = varint(handle, p)
      for (const [ikey, value] of blockEntries(readBlock(file, offset, size))) {
        if (ikey.length < 8) continue
        entries.push({ ...splitInternalKey(ikey), value: Buffer.from(value) })
      }
    } catch {
      // bloc illisible : on continue avec les autres
    }
  }
  return entries
}

/** Toutes les entrees d'un journal `.log` (blocs de 32 Ko, lots d'ecriture). */
export function readLog(file: Buffer): LevelEntry[] {
  const records: Buffer[] = []
  let pending: Buffer[] = []
  for (let block = 0; block < file.length; block += 32768) {
    let pos = block
    const end = Math.min(block + 32768, file.length)
    while (pos + 7 <= end) {
      const len = file.readUInt16LE(pos + 4)
      const type = file[pos + 6]
      if (type === 0 && len === 0) break
      const data = file.subarray(pos + 7, pos + 7 + len)
      pos += 7 + len
      if (type === 1) records.push(data)
      else if (type === 2) pending = [data]
      else if (type === 3) pending.push(data)
      else if (type === 4) {
        pending.push(data)
        records.push(Buffer.concat(pending))
        pending = []
      }
    }
  }
  const entries: LevelEntry[] = []
  for (const batch of records) {
    try {
      let seq = batch.readBigUInt64LE(0)
      const count = batch.readUInt32LE(8)
      let pos = 12
      for (let i = 0; i < count; i++) {
        const tag = batch[pos++]
        let len: number
        ;[len, pos] = varint(batch, pos)
        const key = Buffer.from(batch.subarray(pos, pos + len))
        pos += len
        if (tag === 1) {
          ;[len, pos] = varint(batch, pos)
          entries.push({
            key,
            value: Buffer.from(batch.subarray(pos, pos + len)),
            seq,
            deleted: false
          })
          pos += len
        } else entries.push({ key, value: Buffer.alloc(0), seq, deleted: true })
        seq++
      }
    } catch {
      // lot tronque (ecriture en cours) : ignore
    }
  }
  return entries
}

/** Etat courant : derniere version de chaque cle, suppressions retirees. */
export function latestValues(entries: LevelEntry[]): Map<string, Buffer> {
  const best = new Map<string, LevelEntry>()
  for (const entry of entries) {
    const id = entry.key.toString('latin1')
    const known = best.get(id)
    if (!known || entry.seq > known.seq) best.set(id, entry)
  }
  const out = new Map<string, Buffer>()
  for (const [id, entry] of best) if (!entry.deleted) out.set(id, entry.value)
  return out
}
