import { describe, expect, it } from 'vitest'
import {
  decodeFile,
  detectFileEncoding,
  encodeFile,
  isValidUtf8,
  readFileText,
  unrepresentableCharacters
} from './file-encoding'

/**
 * ENCODAGE — le défaut le plus dangereux trouvé sur `edit_file` : il corrompait SILENCIEUSEMENT.
 *
 * Constaté le 2026-08-07 sur `D:\GIT\RigApplication`, fichier `ULT_1RIL_SE.cls` offset 1097 : les
 * octets réels `6c 27 e9 71 75 69 70 65` valent « l'équipe » en mono-octet. `edit_file` lisait et
 * écrivait en `'utf8'` codé en dur, donc :
 *   - la lecture rendait « l'<?>quipe » → l'extrait du modèle ne correspondait jamais ;
 *   - l'écriture aurait remplacé chaque accent du fichier ENTIER par `EF BF BD`.
 *
 * Les octets de ces tests ne sont pas inventés : ils viennent du fichier réel.
 */

/** Extrait VRAI de ULT_1RIL_SE.cls (mono-octet) : « l'équipe Moteur réalise ». */
const ULT_REEL = Buffer.from([
  0x6c, 0x27, 0xe9, 0x71, 0x75, 0x69, 0x70, 0x65, 0x20, 0x4d, 0x6f, 0x74, 0x65, 0x75, 0x72, 0x20,
  0x72, 0xe9, 0x61, 0x6c, 0x69, 0x73, 0x65
])

describe('isValidUtf8 — dire NON, ce que toString(“utf8”) ne fait jamais', () => {
  it('accepte de l’ASCII et de l’UTF-8 réel', () => {
    expect(isValidUtf8(Buffer.from('Private Sub Test()', 'utf8'))).toBe(true)
    expect(isValidUtf8(Buffer.from('l’équipe Moteur réalise', 'utf8'))).toBe(true)
  })

  it('REFUSE l’octet mono-octet accentué du fichier réel', () => {
    expect(isValidUtf8(ULT_REEL)).toBe(false)
  })

  it('REFUSE une séquence UTF-8 tronquée ou mal continuée', () => {
    expect(isValidUtf8(Buffer.from([0xc3]))).toBe(false) // début sans suite
    expect(isValidUtf8(Buffer.from([0xc3, 0x41]))).toBe(false) // continuation invalide
    expect(isValidUtf8(Buffer.from([0x80]))).toBe(false) // continuation orpheline
    expect(isValidUtf8(Buffer.from([0xc0, 0x80]))).toBe(false) // surlong interdit
  })

  /**
   * Ces cinq octets sont ceux que cp1252 ne définit pas, et ils existent dans les sources VB6 du dépôt
   * (mesuré). Ce qui compte ici : ils ne sont pas de l'UTF-8 valide, donc ils font bien basculer la
   * détection en mono-octet — et `latin1`, bijectif, les rendra tels quels.
   */
  it('REFUSE les octets non définis en cp1252, qui existent dans le dépôt', () => {
    for (const octet of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      expect(isValidUtf8(Buffer.from([0x41, octet, 0x42])), `octet 0x${octet.toString(16)}`).toBe(
        false
      )
    }
  })
})

describe('detectFileEncoding', () => {
  it('reconnaît une marque d’octets, qui prime sur toute heuristique', () => {
    expect(detectFileEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x41]), 'a.ts')).toBe('utf8-bom')
    expect(detectFileEncoding(Buffer.from([0xff, 0xfe, 0x41, 0x00]), 'a.ts')).toBe('utf16le')
  })

  it('REFUSE l’UTF-16 big-endian plutôt que de deviner', () => {
    expect(detectFileEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x41]), 'a.ts')).toBeUndefined()
  })

  it('classe le fichier ULT réel en mono-octet', () => {
    expect(detectFileEncoding(ULT_REEL, 'ULT_1RIL_SE.cls')).toBe('latin1')
  })

  it('classe un fichier TypeScript accentué en UTF-8', () => {
    expect(detectFileEncoding(Buffer.from('const résultat = 1', 'utf8'), 'a.ts')).toBe('utf8')
  })

  /**
   * Un `.cls` purement ASCII est AUSSI de l'UTF-8 valide. Sans la convention par extension, insérer
   * un « é » y écrirait `C3 A9` là où l'IDE VB6 attend `E9`, et afficherait « Ã© ».
   */
  it('un VB6 purement ASCII reste mono-octet, par convention du projet', () => {
    const ascii = Buffer.from('Private Sub Init()\r\nEnd Sub\r\n', 'utf8')
    expect(detectFileEncoding(ascii, 'ULT_X.cls')).toBe('latin1')
    expect(detectFileEncoding(ascii, 'mod.bas')).toBe('latin1')
    expect(detectFileEncoding(ascii, 'Form1.frm')).toBe('latin1')
    expect(detectFileEncoding(ascii, 'index.ts')).toBe('utf8')
  })
})

describe('decodeFile / encodeFile — l’aller-retour doit être EXACT', () => {
  it('rend le vrai texte du fichier ULT', () => {
    const texte = decodeFile(ULT_REEL, 'latin1')
    expect(texte).toBe("l'équipe Moteur réalise")
  })

  it('réécrit les octets À L’IDENTIQUE, y compris ceux non définis en cp1252', () => {
    const octets = Buffer.from([0x41, 0x81, 0x8d, 0x8f, 0x90, 0x9d, 0xe9, 0xff, 0x00, 0x42])
    expect(encodeFile(decodeFile(octets, 'latin1'), 'latin1').equals(octets)).toBe(true)
  })

  it('préserve la marque d’octets UTF-8', () => {
    const avec = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo', 'utf8')])
    const texte = decodeFile(avec, 'utf8-bom')
    expect(texte).toBe('héllo') // le BOM n'appartient pas au texte
    expect(encodeFile(texte, 'utf8-bom').equals(avec)).toBe(true)
  })

  it('préserve l’UTF-16LE et sa marque', () => {
    const avec = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')])
    expect(encodeFile(decodeFile(avec, 'utf16le'), 'utf16le').equals(avec)).toBe(true)
  })
})

/**
 * `Buffer.from(s, 'latin1')` ne se plaint pas : il TRONQUE au dernier octet. « ’ » (U+2019) deviendrait
 * 0x19, un caractère de contrôle — une écriture fausse et silencieuse. On refuse et on le dit.
 */
describe('unrepresentableCharacters — refuser plutôt que tronquer', () => {
  it('repère ce qui ne tient pas dans un octet', () => {
    expect(unrepresentableCharacters('l’équipe', 'latin1')).toEqual(['’'])
    expect(unrepresentableCharacters('coût : 5 €', 'latin1')).toEqual(['€'])
    expect(unrepresentableCharacters('emoji 😀', 'latin1')).toEqual(['😀'])
  })

  it('laisse passer les accents, qui tiennent sur un octet', () => {
    expect(unrepresentableCharacters("l'équipe Moteur réalise à côté", 'latin1')).toEqual([])
  })

  it('ne contraint rien en UTF-8', () => {
    expect(unrepresentableCharacters('l’équipe 😀 €', 'utf8')).toEqual([])
  })
})

describe('readFileText — on n’édite jamais un fichier qu’on ne sait pas reproduire', () => {
  it('rend le texte et l’encodage du fichier ULT réel', () => {
    const d = readFileText(ULT_REEL, 'ULT_1RIL_SE.cls')
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.encoding).toBe('latin1')
      expect(d.text).toContain('équipe')
      expect(d.text).toContain('réalise')
    }
  })

  it('REFUSE l’UTF-16 big-endian, avec un motif explicite', () => {
    const d = readFileText(Buffer.from([0xfe, 0xff, 0x00, 0x41]), 'a.txt')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/big-endian|non pris en charge/i)
  })

  /**
   * Le filet de sécurité qui rend la corruption STRUCTURELLEMENT impossible : si l'aller-retour ne
   * redonne pas les octets d'origine, on refuse — quelle que soit la justesse de la détection.
   */
  it('REFUSE quand l’aller-retour ne redonne pas les octets d’origine', () => {
    // Un UTF-16LE de longueur IMPAIRE après la marque : le dernier octet ne survit pas au décodage.
    const impair = Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x42])
    const d = readFileText(impair, 'a.txt')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/non réversible|corruption/i)
  })

  it('accepte un fichier UTF-8 ordinaire', () => {
    const d = readFileText(Buffer.from('const résultat = 1\n', 'utf8'), 'a.ts')
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.encoding).toBe('utf8')
  })
})
