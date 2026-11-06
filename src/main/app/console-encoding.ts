/**
 * SORTIE CONSOLE WINDOWS — la décoder dans la page de code que la console utilise VRAIMENT.
 *
 * DÉFAUT VÉCU. `spawnVerify` (commandes `run` et `verify`) décodait chaque morceau de sortie en
 * UTF-8. Or, sous Windows, `cmd.exe` et les outils du système (`ping`, `where`, `chcp`…) écrivent
 * dans la page de code OEM de leur console — 850 sur un poste français, où « é » vaut l'octet 0x82.
 * Un tel octet n'est pas de l'UTF-8 valide : `Buffer.toString('utf8')` le remplace en silence par
 * U+FFFD. `murs-rencontres.json` en gardait la trace : conv-92 « ex�cutable ou un fichier de
 * commandes », conv-129 « re�us ». Décoder morceau par morceau pouvait EN PLUS couper un caractère
 * multi-octets entre deux morceaux, d'où deux « � » au lieu d'un caractère valide.
 *
 * LA CORRECTION tient en deux gestes :
 *   1. accumuler les octets BRUTS et ne décoder qu'une fois le tout réuni — plus aucune coupure ;
 *   2. décoder selon la page OEM lue une fois par `chcp`, avec la même invocation que la commande
 *      (`cmd.exe /c`, donc la même AutoRun éventuelle : un `chcp 65001` posé là y est vu aussi).
 *
 * POURQUOI DES TABLES ÉCRITES ICI. Le `TextDecoder` de Node (et d'Electron) suit la norme WHATWG,
 * qui ne connaît PAS les pages 437 et 850 : `new TextDecoder('ibm850')` lève « encoding is not
 * supported » (constaté sous Node 20.20). Les deux tables ci-dessous ont été générées par
 * `[Text.Encoding]::GetEncoding(850|437)` de .NET, puis recoupées octet par octet avec `iconv-lite`
 * (0 écart, 128 caractères distincts chacune). Pour les pages que la norme connaît (866, 932, 936,
 * 949, 950, 125x), on passe par `TextDecoder`.
 *
 * POURQUOI UN DÉCODAGE MIXTE. Toute la sortie n'est pas en page OEM : Node, npm et vitest écrivent
 * en UTF-8 quelle que soit la console (« ✓ », « × », « ❯ »). Une sortie d'UTF-8 valide est donc
 * décodée en UTF-8. Sinon, pour une page mono-octet, chaque séquence UTF-8 valide reste UTF-8 et
 * chaque octet isolé passe par la table. Les minuscules accentuées françaises de la page 850
 * (0x80–0x9F) ne peuvent jamais COMMENCER une séquence UTF-8. Seul cas ambigu, et rare : une
 * majuscule accentuée codée 0xC2–0xF4 (« È » = 0xD4) immédiatement suivie d'un octet 0x80–0xBF,
 * dans une sortie qui n'est pas déjà de l'UTF-8 valide — la paire est alors lue comme UTF-8.
 */
import { execFile } from 'node:child_process'

/** Page 850 (Europe de l'Ouest), caractères des octets 0x80 à 0xFF. */
const CP850_HAUT =
  '\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5' +
  '\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9\u00FF\u00D6\u00DC\u00F8\u00A3\u00D8\u00D7\u0192' +
  '\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA\u00BF\u00AE\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB' +
  '\u2591\u2592\u2593\u2502\u2524\u00C1\u00C2\u00C0\u00A9\u2563\u2551\u2557\u255D\u00A2\u00A5\u2510' +
  '\u2514\u2534\u252C\u251C\u2500\u253C\u00E3\u00C3\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u00A4' +
  '\u00F0\u00D0\u00CA\u00CB\u00C8\u0131\u00CD\u00CE\u00CF\u2518\u250C\u2588\u2584\u00A6\u00CC\u2580' +
  '\u00D3\u00DF\u00D4\u00D2\u00F5\u00D5\u00B5\u00FE\u00DE\u00DA\u00DB\u00D9\u00FD\u00DD\u00AF\u00B4' +
  '\u00AD\u00B1\u2017\u00BE\u00B6\u00A7\u00F7\u00B8\u00B0\u00A8\u00B7\u00B9\u00B3\u00B2\u25A0\u00A0'

/** Page 437 (États-Unis), caractères des octets 0x80 à 0xFF. */
const CP437_HAUT =
  '\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5' +
  '\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9\u00FF\u00D6\u00DC\u00A2\u00A3\u00A5\u20A7\u0192' +
  '\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA\u00BF\u2310\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB' +
  '\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510' +
  '\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567' +
  '\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580' +
  '\u03B1\u00DF\u0393\u03C0\u03A3\u03C3\u00B5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229' +
  '\u2261\u00B1\u2265\u2264\u2320\u2321\u00F7\u2248\u00B0\u2219\u00B7\u221A\u207F\u00B2\u25A0\u00A0'

/** Page 858 : la 850 où l'octet 0xD5 porte « € » au lieu de « ı ». */
const CP858_HAUT = `${CP850_HAUT.slice(0, 0xd5 - 0x80)}\u20AC${CP850_HAUT.slice(0xd5 - 0x80 + 1)}`

const TABLES_MONO_OCTET: Readonly<Record<number, string>> = {
  437: CP437_HAUT,
  850: CP850_HAUT,
  858: CP858_HAUT
}

/** Pages que `TextDecoder` (norme WHATWG) sait décoder, avec leur libellé. */
const LIBELLES_TEXTDECODER: Readonly<Record<number, string>> = {
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258'
}

export const PAGE_UTF8 = 65001

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

function utf8Strict(octets: Uint8Array): string | undefined {
  try {
    return UTF8_STRICT.decode(octets)
  } catch {
    return undefined
  }
}

/**
 * Longueur de la séquence UTF-8 VALIDE qui commence en `i`, ou 0. Stricte : refuse les formes
 * trop longues (C0, C1, E0 80…, F0 80…), les demi-codets (ED A0…) et l'au-delà de U+10FFFF.
 */
function sequenceUtf8Valide(octets: Uint8Array, i: number): number {
  const a = octets[i]
  let longueur: number
  let min2 = 0x80
  let max2 = 0xbf
  if (a >= 0xc2 && a <= 0xdf) longueur = 2
  else if (a >= 0xe0 && a <= 0xef) {
    longueur = 3
    if (a === 0xe0) min2 = 0xa0
    if (a === 0xed) max2 = 0x9f
  } else if (a >= 0xf0 && a <= 0xf4) {
    longueur = 4
    if (a === 0xf0) min2 = 0x90
    if (a === 0xf4) max2 = 0x8f
  } else return 0
  if (i + longueur > octets.length) return 0
  const b = octets[i + 1]
  if (b < min2 || b > max2) return 0
  for (let k = 2; k < longueur; k += 1) {
    const c = octets[i + k]
    if (c < 0x80 || c > 0xbf) return 0
  }
  return longueur
}

/** UTF-8 là où il est valide, la table mono-octet partout ailleurs. */
function decoderMixte(octets: Buffer, haut: string): string {
  let texte = ''
  let debutAscii = 0
  let i = 0
  while (i < octets.length) {
    if (octets[i] < 0x80) {
      i += 1
      continue
    }
    if (i > debutAscii) texte += octets.toString('latin1', debutAscii, i)
    const longueur = sequenceUtf8Valide(octets, i)
    if (longueur > 0) {
      texte += octets.toString('utf8', i, i + longueur)
      i += longueur
    } else {
      texte += haut[octets[i] - 0x80]
      i += 1
    }
    debutAscii = i
  }
  if (octets.length > debutAscii) texte += octets.toString('latin1', debutAscii)
  return texte
}

/**
 * Décode la sortie COMPLÈTE d'une commande console. `pageDeCode` vient de `pageDeCodeConsole()` ;
 * absente (hors Windows, sonde en échec) ou inconnue, on garde l'UTF-8 — le comportement d'avant,
 * sans la coupure entre morceaux puisque le tampon arrive entier.
 */
export function decoderSortieConsole(octets: Buffer, pageDeCode?: number): string {
  if (pageDeCode === undefined || pageDeCode === PAGE_UTF8) return octets.toString('utf8')
  const utf8 = utf8Strict(octets)
  if (utf8 !== undefined) return utf8
  const haut = TABLES_MONO_OCTET[pageDeCode]
  if (haut) return decoderMixte(octets, haut)
  const libelle = LIBELLES_TEXTDECODER[pageDeCode]
  if (libelle) {
    try {
      return new TextDecoder(libelle).decode(octets)
    } catch {
      /* ICU réduite sans ce codec : on retombe sur l'UTF-8 plutôt que d'échouer la commande */
    }
  }
  return octets.toString('utf8')
}

/**
 * Lit le numéro de page dans la sortie de `chcp` : « Page de codes active : 850 », « Active code
 * page: 65001 », « Aktive Codepage: 850. ». Seule la DERNIÈRE ligne compte : une AutoRun peut
 * écrire avant, `chcp` parle toujours en dernier.
 */
export function pageDeCodeDepuisChcp(sortie: string): number | undefined {
  const lignes = sortie
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter(Boolean)
  const nombres = lignes.at(-1)?.match(/\d+/g)
  const page = Number(nombres?.at(-1))
  return Number.isInteger(page) && page > 0 ? page : undefined
}

let sonde: Promise<number | undefined> | undefined

/**
 * Page de code de la console des commandes lancées par `cmd.exe /c`, lue UNE fois puis gardée.
 * Hors Windows : `undefined` (UTF-8). Une sonde en échec n'est PAS gardée : la suivante retente,
 * plutôt que de figer pour toute la session le décodage d'avant.
 */
export function pageDeCodeConsole(): Promise<number | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  sonde ??= new Promise<number | undefined>((resolve) => {
    execFile(
      'cmd.exe',
      ['/c', 'chcp'],
      { windowsHide: true, timeout: 5_000, encoding: 'latin1' },
      (erreur, stdout) => {
        const page = erreur ? undefined : pageDeCodeDepuisChcp(String(stdout))
        if (page === undefined) sonde = undefined
        resolve(page)
      }
    )
  })
  return sonde
}
