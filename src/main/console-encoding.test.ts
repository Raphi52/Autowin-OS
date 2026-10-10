import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  PAGE_UTF8,
  decoderSortieConsole,
  pageDeCodeConsole,
  pageDeCodeDepuisChcp
} from './console-encoding'

/**
 * Octets tels que `cmd.exe` les écrit sur un poste français (page 850) : « é » = 0x82,
 * « ç » = 0x87. Écrits en hexadécimal pour que l'encodage de CE fichier ne puisse rien fausser.
 */
const CP850_EXECUTABLE = Buffer.from([
  ...Buffer.from('un programme ex', 'ascii'),
  0x82,
  ...Buffer.from('cutable', 'ascii')
])
const CP850_RECUS = Buffer.from([
  ...Buffer.from('re', 'ascii'),
  0x87,
  ...Buffer.from('us = 1', 'ascii')
])

describe('decoderSortieConsole — page OEM de la console Windows', () => {
  it('le défaut : décodé en UTF-8, l’octet cp850 de « é » devient U+FFFD', () => {
    // C'est EXACTEMENT ce que `spawnVerify` renvoyait à l'agent (conv-92).
    expect(CP850_EXECUTABLE.toString('utf8')).toBe('un programme ex\uFFFDcutable')
  })

  it('page 850 : « é » (0x82) et « ç » (0x87) sont rendus tels quels', () => {
    expect(decoderSortieConsole(CP850_EXECUTABLE, 850)).toBe('un programme exécutable')
    expect(decoderSortieConsole(CP850_RECUS, 850)).toBe('reçus = 1')
  })

  it('page 437 : mêmes octets pour les minuscules accentuées', () => {
    expect(decoderSortieConsole(CP850_EXECUTABLE, 437)).toBe('un programme exécutable')
  })

  it('page 858 : seul l’octet 0xD5 diffère de la 850 (« € » au lieu de « ı »)', () => {
    expect(decoderSortieConsole(Buffer.from([0xd5]), 850)).toBe('\u0131')
    expect(decoderSortieConsole(Buffer.from([0xd5]), 858)).toBe('\u20AC')
    expect(decoderSortieConsole(Buffer.from([0x82]), 858)).toBe('é')
  })

  it('une sortie déjà en UTF-8 valide (Node, npm, vitest) n’est PAS re-décodée en page OEM', () => {
    const vitest = Buffer.from('✓ 12 tests réussis × 0', 'utf8')
    expect(decoderSortieConsole(vitest, 850)).toBe('✓ 12 tests réussis × 0')
  })

  it('sortie MIXTE : l’UTF-8 de npm et le cp850 de cmd.exe sont lus chacun correctement', () => {
    const mixte = Buffer.concat([Buffer.from('✓ étape\n', 'utf8'), CP850_EXECUTABLE])
    expect(decoderSortieConsole(mixte, 850)).toBe('✓ étape\nun programme exécutable')
  })

  it('page 65001 ou inconnue : UTF-8, comme avant — sans coupure puisque le tampon arrive entier', () => {
    const e = Buffer.from('é', 'utf8')
    expect(decoderSortieConsole(e, PAGE_UTF8)).toBe('é')
    expect(decoderSortieConsole(e, undefined)).toBe('é')
    expect(decoderSortieConsole(e, 99999)).toBe('é')
  })

  it('page connue de TextDecoder (866) : passe par lui', () => {
    // 0xAE en cp866 = « о » cyrillique (U+043E).
    expect(decoderSortieConsole(Buffer.from([0xae]), 866)).toBe('\u043E')
  })
})

describe('pageDeCodeDepuisChcp', () => {
  it.each([
    ['Page de codes active : 850\r\n', 850],
    ['Active code page: 65001\r\n', 65001],
    ['Aktive Codepage: 850.\r\n', 850],
    // Une AutoRun qui parle avant : seule la DERNIÈRE ligne est celle de notre `chcp`.
    ['Page de codes active : 65001\r\nPage de codes active : 850\r\n', 850],
    ['', undefined],
    ['erreur sans chiffre', undefined]
  ])('%j -> %s', (sortie, attendu) => {
    expect(pageDeCodeDepuisChcp(sortie)).toBe(attendu)
  })
})

describe.skipIf(process.platform !== 'win32')('sur ce poste Windows, avec le vrai cmd.exe', () => {
  it('la page sondée décode le message d’erreur réel de cmd.exe sans aucun U+FFFD', async () => {
    const page = await pageDeCodeConsole()
    expect(page).toBeGreaterThan(0)
    let octets: Buffer
    try {
      octets = execFileSync('cmd.exe', ['/c', 'binaireabsentautowinxyz'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (erreur) {
      const e = erreur as { stdout: Buffer; stderr: Buffer }
      octets = Buffer.concat([e.stdout, e.stderr])
    }
    const texte = decoderSortieConsole(octets, page)
    expect(texte).toContain('binaireabsentautowinxyz')
    expect(texte).not.toContain('\uFFFD')
  })
})
