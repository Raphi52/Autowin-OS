// fix-ok: node:v8 Deserializer refuse les valeurs IndexedDB de Teams (en-tete 0xFF 0x10, V8 v16) — mesure sur une copie du stockage le 2026-09-25, d ou ce decodeur maison.
/**
 * Decodeur minimal du format de serialisation V8 (celui d'IndexedDB dans Chromium/WebView2).
 *
 * `v8.Deserializer` de Node refuse les versions de format plus recentes que son moteur (Teams
 * ecrit la version 16, constate le 2026-09-25) : ce decodeur couvre les types utiles a des
 * donnees JSON-like (objets, tableaux, chaines, nombres, booleens, dates, Map/Set) et LEVE une
 * erreur sur le reste (objets hote, buffers) plutot que d'inventer une valeur.
 */

class Reader {
  pos: number
  readonly refs: unknown[] = []
  constructor(
    readonly buf: Buffer,
    start: number
  ) {
    this.pos = start
  }

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('v8 : fin de donnees')
    return this.buf[this.pos++]
  }

  varint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const b = this.byte()
      result += (b & 0x7f) * 2 ** shift
      if ((b & 0x80) === 0) return result
      shift += 7
      if (shift > 63) throw new Error('v8 : varint trop long')
    }
  }

  zigzag(): number {
    const n = this.varint()
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2
  }

  double(): number {
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }

  bytes(n: number): Buffer {
    if (this.pos + n > this.buf.length) throw new Error('v8 : chaine tronquee')
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  /** Lit le prochain tag significatif (saute le remplissage et les marqueurs de verification). */
  tag(): number {
    for (;;) {
      const t = this.byte()
      if (t === 0x00) continue // padding
      if (t === 0x3f) {
        this.varint() // verify object count
        continue
      }
      return t
    }
  }

  value(): unknown {
    const t = this.tag()
    switch (t) {
      case 0x5f: // '_'
        return undefined
      case 0x30: // '0'
        return null
      case 0x54: // 'T'
        return true
      case 0x46: // 'F'
        return false
      case 0x49: // 'I'
        return this.zigzag()
      case 0x55: // 'U'
        return this.varint()
      case 0x4e: // 'N'
        return this.double()
      case 0x44: {
        // 'D' date
        const d = new Date(this.double())
        this.refs.push(d)
        return d
      }
      case 0x22: // '"' one-byte
        return this.bytes(this.varint()).toString('latin1')
      case 0x63: // 'c' two-byte
        return this.bytes(this.varint()).toString('utf16le')
      case 0x53: // 'S' utf8
        return this.bytes(this.varint()).toString('utf8')
      case 0x5e: // '^' reference
        return this.refs[this.varint()]
      case 0x6f: {
        // 'o' object
        const obj: Record<string, unknown> = {}
        this.refs.push(obj)
        this.properties(obj, 0x7b)
        return obj
      }
      case 0x41: {
        // 'A' dense array
        const len = this.varint()
        const arr: unknown[] = []
        this.refs.push(arr)
        for (let i = 0; i < len; i++) {
          if (this.buf[this.pos] === 0x2d) {
            this.pos++ // hole
            arr.push(undefined)
          } else arr.push(this.value())
        }
        this.properties(arr as unknown as Record<string, unknown>, 0x24)
        this.varint()
        return arr
      }
      case 0x61: {
        // 'a' sparse array
        this.varint()
        const arr: unknown[] = []
        this.refs.push(arr)
        this.properties(arr as unknown as Record<string, unknown>, 0x40)
        this.varint()
        return arr
      }
      case 0x3b: {
        // ';' Map
        const map = new Map<unknown, unknown>()
        this.refs.push(map)
        while (this.buf[this.pos] !== 0x3a) map.set(this.value(), this.value())
        this.pos++
        this.varint()
        return map
      }
      case 0x27: {
        // '\'' Set
        const set = new Set<unknown>()
        this.refs.push(set)
        while (this.buf[this.pos] !== 0x2c) set.add(this.value())
        this.pos++
        this.varint()
        return set
      }
      case 0x79: // 'y' true object
      case 0x78: {
        // 'x' false object
        const v = t === 0x79
        this.refs.push(v)
        return v
      }
      case 0x6e: {
        // 'n' number object
        const v = this.double()
        this.refs.push(v)
        return v
      }
      case 0x73: {
        // 's' string object
        const v = this.value()
        this.refs.push(v)
        return v
      }
      default:
        throw new Error(`v8 : type non pris en charge 0x${t.toString(16)}`)
    }
  }

  properties(target: Record<string, unknown>, end: number): void {
    for (;;) {
      while (this.buf[this.pos] === 0x00) this.pos++
      if (this.buf[this.pos] === end) {
        this.pos++
        this.varint()
        return
      }
      const key = this.value()
      target[String(key)] = this.value()
    }
  }
}

/**
 * Decode une valeur IndexedDB de Chromium : `varint version` + enveloppe Blink (`FF <ver>`, trailer
 * optionnel `FE` + 12 octets) + donnees V8 (`FF <ver>`). Rend `undefined` si le format est inconnu.
 */
export function decodeIndexedDbValue(buf: Buffer): unknown {
  for (let s = 0; s < Math.min(32, buf.length - 2); s++) {
    if (buf[s] !== 0xff || buf[s + 1] < 0x0d || buf[s + 1] > 0x20) continue
    // Il faut le DERNIER en-tete `FF ver` de l'enveloppe : l'objet commence apres.
    const next = s + 2
    if (buf[next] === 0xff || buf[next] === 0xfe) continue
    try {
      return new Reader(buf, next).value()
    } catch {
      // essaie l'en-tete suivant
    }
  }
  return undefined
}
