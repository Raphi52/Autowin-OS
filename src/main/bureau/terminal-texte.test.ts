/**
 * Le texte que `terminal_lire` rend à l'agent (conv-1362, lot 3/3). La première preuve est une VRAIE
 * capture : c'est elle qui a montré qu'un simple retrait des séquences rend un texte faux.
 */
import { describe, expect, it } from 'vitest'
import { lignesDuTerminal } from './terminal-texte'
import { sansSequencesAnsi } from '../../shared/ansi'
import capture from '../__fixtures__/terminal-powershell-reel.json'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const taille = { colonnes: 20, lignes: 5 }

describe('sortie réelle de PowerShell', () => {
  const avantCls = capture.brut.slice(0, capture.brut.indexOf('[H' + ESC + '[K'))

  it('rend exactement ce que le terminal affiche', () => {
    expect(lignesDuTerminal(avantCls.slice(0, -1), capture)).toEqual([
      'PS D:\\AutoWinOS> Write-Output "alpha   beta      gamma"',
      'alpha   beta      gamma',
      'PS D:\\AutoWinOS> 1..3 | ForEach-Object { "ligne $_" }',
      'ligne 1',
      'ligne 2',
      'ligne 3',
      'PS D:\\AutoWinOS> Write-Host -ForegroundColor Red "rouge"',
      'rouge',
      'PS D:\\AutoWinOS> "é à ü €"',
      'é à ü €',
      'PS D:\\AutoWinOS> Get-ChildItem src/shared | Select-Object -First 3 Name',
      '',
      'Name',
      '----',
      '__fixtures__',
      'ansi.residus.test.ts',
      'ansi.test.ts',
      '',
      '',
      'PS D:\\AutoWinOS>'
    ])
  })

  it('retirer les séquences ne suffisait pas : l’invite se collait et le « > » doublait', () => {
    const depouille = sansSequencesAnsi(avantCls)
    expect(depouille).toContain('> > Write-Output')
    expect(depouille).toMatch(/ansi\.test\.ts +PS D:/)
  })

  it('cls efface vraiment : le texte d’avant n’est plus lisible', () => {
    expect(lignesDuTerminal(capture.brut, capture)).toEqual([
      'PS D:\\AutoWinOS> "apres cls"',
      'apres cls',
      'PS D:\\AutoWinOS> exit 3'
    ])
  })

  it('ne laisse aucun caractère de contrôle', () => {
    expect(lignesDuTerminal(capture.brut, capture).join('')).not.toMatch(
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f-\u009f]/
    )
  })
})

describe('séquences', () => {
  it('écarte titre, couleurs, modes et chaînes DCS', () => {
    const brut =
      `${ESC}]0;titre piégé${BEL}${ESC}[31mrouge${ESC}[0m` +
      `${ESC}]8;;https://exemple.fr${ESC}\\lien${ESC}]8;;${ESC}\\` +
      `${ESC}Pq#0;2;0;0;0${ESC}\\${ESC}(B${ESC}[?25l fin`
    expect(lignesDuTerminal(brut, { colonnes: 40, lignes: 5 })).toEqual(['rougelien fin'])
  })

  it('une séquence coupée en fin de tampon ne fuit pas', () => {
    expect(lignesDuTerminal(`texte${ESC}[3`, taille)).toEqual(['texte'])
    expect(lignesDuTerminal(`texte${ESC}]0;titre`, taille)).toEqual(['texte'])
    expect(lignesDuTerminal(`texte${ESC}`, taille)).toEqual(['texte'])
  })

  it('reconnaît le CSI en 8 bits et retire le DEL', () => {
    expect(lignesDuTerminal(`a${String.fromCharCode(0x9b)}31mb\u007fc`, taille)).toEqual(['abc'])
  })
})

describe('sortie hostile', () => {
  // La sortie vient de n'importe quel programme : un compte géant ne doit jamais coûter sa taille.
  const GEANT = '999999999'

  it('borne les insertions, retraits et défilements à la taille de l’écran', () => {
    for (const finale of ['@', 'P', 'L', 'M', 'S', 'X', 'A', 'B', 'C', 'D']) {
      const lignes = lignesDuTerminal(`a\r\nb${ESC}[${GEANT}${finale}c`, taille)
      expect(lignes.length).toBeLessThanOrEqual(7)
      expect(lignes.join('').length).toBeLessThanOrEqual(40)
    }
  })

  it('tient un compte qui dépasse les nombres représentables', () => {
    const infini = '9'.repeat(400)
    for (const finale of ['@', 'P', 'L', 'M', 'S', 'X', 'A', 'C', 'H']) {
      expect(() => lignesDuTerminal(`a${ESC}[${infini}${finale}b`, taille)).not.toThrow()
    }
  })

  it('borne l’historique : des défilements répétés ne s’accumulent pas sans fin', () => {
    const tres = { colonnes: 80, lignes: 1000 }
    const lignes = lignesDuTerminal(`${ESC}[1000S`.repeat(28_000) + 'fin', tres)
    expect(lignes.length).toBeLessThanOrEqual(11_000)
    expect(lignes.at(-1)).toBe('fin')
  })

  it('borne un saut de curseur géant', () => {
    expect(lignesDuTerminal(`${ESC}[${GEANT};${GEANT}Hx`, taille)).toEqual([
      '',
      '',
      '',
      '',
      ' '.repeat(19) + 'x'
    ])
  })
})

describe('écran', () => {
  it('une barre de progression réécrite par \\r ne garde que son dernier état', () => {
    expect(lignesDuTerminal('  10 %\r 100 %\r\nfin', taille)).toEqual([' 100 %', 'fin'])
  })

  it('le retour arrière remplace le caractère', () => {
    expect(lignesDuTerminal('abX\bc', taille)).toEqual(['abc'])
  })

  it('une ligne coupée par la largeur redevient une seule ligne', () => {
    expect(lignesDuTerminal('a'.repeat(50) + '\r\nb', taille)).toEqual(['a'.repeat(50), 'b'])
  })

  it('une ligne pile à la largeur ne crée pas de ligne vide', () => {
    expect(lignesDuTerminal('a'.repeat(20) + '\r\nb', taille)).toEqual(['a'.repeat(20), 'b'])
  })

  it('ce qui défile reste dans l’historique', () => {
    const brut = Array.from({ length: 12 }, (_, i) => `ligne ${i + 1}`).join('\r\n')
    const lignes = lignesDuTerminal(brut, taille)
    expect(lignes).toHaveLength(12)
    expect(lignes[0]).toBe('ligne 1')
    expect(lignes[11]).toBe('ligne 12')
  })

  it('les déplacements relatifs repeignent au bon endroit', () => {
    expect(lignesDuTerminal(`un\r\ndeux${ESC}[A${ESC}[4GX`, taille)).toEqual(['un X', 'deux'])
    expect(lignesDuTerminal(`abc${ESC}[2Dz`, taille)).toEqual(['azc'])
    expect(lignesDuTerminal(`a${ESC}[3Cb`, taille)).toEqual(['a   b'])
  })

  it('efface ligne et cases sans décaler le reste', () => {
    expect(lignesDuTerminal(`abcdef${ESC}[3G${ESC}[2X`, taille)).toEqual(['ab  ef'])
    expect(lignesDuTerminal(`abcdef${ESC}[3G${ESC}[K`, taille)).toEqual(['ab'])
    expect(lignesDuTerminal(`abcdef${ESC}[3G${ESC}[1K`, taille)).toEqual(['   def'])
    expect(lignesDuTerminal(`abcdef${ESC}[3G${ESC}[2K`, taille)).toEqual([])
  })

  it('insère et retire des cases', () => {
    expect(lignesDuTerminal(`abcd${ESC}[2G${ESC}[2P`, taille)).toEqual(['ad'])
    expect(lignesDuTerminal(`abcd${ESC}[2G${ESC}[2@`, taille)).toEqual(['a  bcd'])
  })

  it('insère et retire des rangées visibles', () => {
    const base = `a\r\nb\r\nc${ESC}[2;1H`
    expect(lignesDuTerminal(`${base}${ESC}[L`, taille)).toEqual(['a', '', 'b', 'c'])
    expect(lignesDuTerminal(`${base}${ESC}[M`, taille)).toEqual(['a', 'c'])
  })

  it('efface l’écran sans toucher l’historique, puis l’historique', () => {
    const haut = Array.from({ length: 7 }, (_, i) => `l${i + 1}`).join('\r\n')
    expect(lignesDuTerminal(`${haut}${ESC}[2J`, taille)).toEqual(['l1', 'l2'])
    expect(lignesDuTerminal(`${haut}${ESC}[2J${ESC}[3J`, taille)).toEqual([])
  })

  it('efface du curseur à la fin, ou du début au curseur', () => {
    const base = `a\r\nb\r\nc${ESC}[2;1H`
    expect(lignesDuTerminal(`${base}${ESC}[J`, taille)).toEqual(['a'])
    expect(lignesDuTerminal(`${base}${ESC}[1J`, taille)).toEqual(['', '', 'c'])
  })

  it('garde et rend le curseur', () => {
    expect(lignesDuTerminal(`ab${ESC}7${ESC}[3;1Hc${ESC}8d`, taille)).toEqual(['abd', '', 'c'])
    expect(lignesDuTerminal(`ab${ESC}[s${ESC}[3;1Hc${ESC}[ud`, taille)).toEqual(['abd', '', 'c'])
  })

  it('une réinitialisation complète repart d’un écran vide', () => {
    expect(lignesDuTerminal(`avant${ESC}capres`, taille)).toEqual(['apres'])
  })

  it('une tabulation rejoint le taquet suivant', () => {
    expect(lignesDuTerminal('a\tb', taille)).toEqual(['a       b'])
  })

  it('tient les caractères hors du plan de base', () => {
    expect(lignesDuTerminal('😀 ok', taille)).toEqual(['😀 ok'])
  })
})
