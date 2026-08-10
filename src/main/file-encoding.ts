/**
 * ENCODAGE DES FICHIERS ÉDITÉS — préserver ce qu'on n'a pas demandé à changer.
 *
 * POURQUOI CE MODULE EXISTE (2026-08-07). `edit_file` lisait ET écrivait en `'utf8'` codé en dur. Sur
 * un dépôt VB6 comme RigApplication, les sources sont en encodage MONO-OCTET (Windows-1252). Mesuré
 * sur `ULT_1RIL_SE.cls`, offset 1097 :
 *
 *   octets réels : … 6c 27 e9 71 75 69 70 65 …
 *   lu en 1252   : « l'équipe Moteur réalise la refonte des ult »
 *   lu en UTF-8  : « l'<EFBFBD>quipe Moteur r<EFBFBD>alise la refonte des ult »
 *
 * Deux dégâts, tous deux constatés en usage réel :
 *   1. l'extrait `oldText` du modèle contient « é » et ne correspond JAMAIS au contenu décodé de
 *      travers — l'édition échoue « texte introuvable », sans que personne comprenne pourquoi ;
 *   2. si elle correspondait (extrait purement ASCII), la RÉÉCRITURE en UTF-8 remplacerait chaque
 *      accent du fichier ENTIER par `EF BF BD`. Corruption silencieuse et irréversible.
 *
 * POURQUOI `latin1`. Raison première, prosaïque : **Node n'a pas de codec cp1252**. `Buffer` connaît
 * `latin1`, `utf8`, `utf16le` — pas les codepages Windows. Ajouter une dépendance pour ça serait
 * disproportionné, et `latin1` suffit ici :
 *   - il est BIJECTIF sur 0x00–0xFF, donc l'aller-retour est exact octet pour octet, y compris sur
 *     `0x81 0x8D 0x8F 0x90 0x9D` (présents dans les sources VB6 de ce dépôt, mesuré) ;
 *   - il coïncide avec cp1252 sur 0xA0–0xFF, donc « é » (0xE9) se décode en U+00E9 et l'extrait du
 *     modèle correspond — c'est tout ce dont la correspondance a besoin.
 *
 * À ne pas confondre avec le patch MANUEL en PowerShell, qui utilise cp1252 : là c'est correct, .NET
 * mappe ces cinq octets sur U+0081… et refait l'aller-retour sans perte (vérifié). Le choix diffère
 * parce que la plateforme diffère, pas parce que cp1252 serait fautif.
 *
 * La contrepartie est assumée : sur 0x80–0x9F, `latin1` ne rend pas les caractères typographiques de
 * cp1252 (« ’ », « € »). Un `oldText` contenant « ’ » ne correspondra donc pas. C'est un ÉCHEC DE
 * CORRESPONDANCE — visible, réessayable — jamais une écriture fausse.
 */
import { extname } from 'node:path'

export type FileEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'latin1'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Extensions VB6. Ces fichiers sont en mono-octet PAR CONVENTION, même quand ils ne contiennent
 * aujourd'hui que de l'ASCII : sans cette règle, insérer un « é » dans un `.cls` purement ASCII
 * écrirait `C3 A9` là où l'IDE VB6 attend `E9`, et afficherait « Ã© ».
 */
const SINGLE_BYTE_EXTENSIONS = new Set([
  '.cls',
  '.bas',
  '.frm',
  '.ctl',
  '.vbp',
  '.vbg',
  '.dsr',
  '.dob',
  '.pag',
  '.ctx',
  '.frx'
])

/** L'octet est-il le début d'une séquence UTF-8 de `n` octets ? */
function utf8SequenceLength(byte: number): number {
  if (byte < 0x80) return 1
  if (byte >= 0xc2 && byte <= 0xdf) return 2
  if (byte >= 0xe0 && byte <= 0xef) return 3
  if (byte >= 0xf0 && byte <= 0xf4) return 4
  return 0 // 0x80-0xC1 et 0xF5-0xFF ne peuvent pas commencer une séquence valide
}

/**
 * Validation UTF-8 STRICTE. On ne se contente pas de « ça ne plante pas » : `Buffer.toString('utf8')`
 * remplace silencieusement l'invalide par U+FFFD, donc il ne dit jamais non. C'est précisément ce
 * silence qui a permis la corruption.
 */
export function isValidUtf8(bytes: Buffer): boolean {
  let i = 0
  while (i < bytes.length) {
    const len = utf8SequenceLength(bytes[i])
    if (len === 0) return false
    if (i + len > bytes.length) return false
    for (let k = 1; k < len; k += 1) {
      if ((bytes[i + k] & 0xc0) !== 0x80) return false
    }
    i += len
  }
  return true
}

/**
 * Détermine l'encodage d'un fichier existant. L'ordre compte : une marque d'octets est une déclaration
 * explicite, elle prime sur toute heuristique.
 */
export function detectFileEncoding(bytes: Buffer, filePath = ''): FileEncoding | undefined {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(UTF8_BOM)) return 'utf8-bom'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf16le'
  // UTF-16 big-endian : on REFUSE plutôt que de deviner. Node ne l'encode pas, et écrire du
  // little-endian dans un fichier big-endian serait une corruption totale.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return undefined
  if (!isValidUtf8(bytes)) return 'latin1'
  // Valide en UTF-8 — mais un fichier purement ASCII l'est aussi. La convention du projet tranche.
  if (SINGLE_BYTE_EXTENSIONS.has(extname(filePath).toLowerCase())) return 'latin1'
  return 'utf8'
}

export function decodeFile(bytes: Buffer, encoding: FileEncoding): string {
  switch (encoding) {
    case 'utf8-bom':
      return bytes.subarray(3).toString('utf8')
    case 'utf16le':
      return bytes.subarray(2).toString('utf16le')
    case 'latin1':
      return bytes.toString('latin1')
    default:
      return bytes.toString('utf8')
  }
}

export function encodeFile(text: string, encoding: FileEncoding): Buffer {
  switch (encoding) {
    case 'utf8-bom':
      return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'latin1':
      return Buffer.from(text, 'latin1')
    default:
      return Buffer.from(text, 'utf8')
  }
}

/**
 * Le caractère survivrait-il à l'encodage cible ? `Buffer.from(s, 'latin1')` ne se plaint pas : il
 * TRONQUE au dernier octet. « ’ » (U+2019) deviendrait 0x19, un caractère de contrôle — donc une
 * écriture fausse, silencieuse. On préfère refuser l'édition et le dire.
 */
export function unrepresentableCharacters(text: string, encoding: FileEncoding): string[] {
  if (encoding !== 'latin1') return []
  const fautifs = new Set<string>()
  for (const c of text) {
    const point = c.codePointAt(0) ?? 0
    if (point > 0xff) fautifs.add(c)
  }
  return [...fautifs]
}

export interface FileTextDecision {
  ok: true
  text: string
  encoding: FileEncoding
}
export interface FileTextRefusal {
  ok: false
  reason: string
}

/**
 * Lit le texte d'un fichier en préservant son encodage, et REFUSE tout ce qu'on ne saurait pas
 * réécrire à l'identique.
 *
 * L'auto-contrôle d'aller-retour est la garantie qui compte : on n'écrit jamais dans un fichier qu'on
 * ne sait pas reproduire octet pour octet. Il rend la corruption structurellement impossible, au lieu
 * de reposer sur la justesse de la détection.
 */
export function readFileText(bytes: Buffer, filePath = ''): FileTextDecision | FileTextRefusal {
  const encoding = detectFileEncoding(bytes, filePath)
  if (!encoding) {
    return {
      ok: false,
      reason:
        'encodage non pris en charge (UTF-16 big-endian) : refus d’éditer un fichier qu’on ne saurait pas réécrire à l’identique'
    }
  }
  const text = decodeFile(bytes, encoding)
  const retour = encodeFile(text, encoding)
  if (!retour.equals(bytes)) {
    return {
      ok: false,
      reason: `encodage ${encoding} non réversible sur ce fichier : refus d’éditer plutôt que de risquer une corruption`
    }
  }
  return { ok: true, text, encoding }
}
