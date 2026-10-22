import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const chr10 = String.fromCharCode(10)

// Pourquoi ce test : la sonde ne lit que .ts/.tsx/.mts/.js/.jsx/.mjs/.cjs. Sur `scripts/`,
// 67 des 165 fichiers (41 %) sont hors de ce filtre — .ps1, .py, .vbs. Un rapport muet sur
// ce trou se lit comme un inventaire complet. Mesure du banc /arena du 2026-09-05 : les trois
// bras qui suivaient la sonde ont perdu contre un balayage direct, sur cet angle mort exactement.
const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

const dossier = (fichiers) => {
  const d = mkdtempSync(join(tmpdir(), 'scout-residus-'))
  aNettoyer.push(d)
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(d, nom)), { recursive: true })
    writeFileSync(join(d, nom), contenu, 'utf8')
  }
  return d
}

const sonde = (racine) =>
  execFileSync(process.execPath, ['scripts/scout-residus.mjs', racine], { encoding: 'utf8' })

describe('scout-residus — angle mort', () => {
  it('nomme les extensions NON analysees et les compte', () => {
    const d = dossier({
      'vivant.mjs': 'export const a = 1\n',
      'runner.ps1': 'Set-Location C:/nulle-part\n',
      'autre.ps1': 'Write-Host x\n',
      'outil.py': 'print(1)\n'
    })
    const rapport = sonde(d)
    expect(rapport).toMatch(/## 0\. Angle mort — 3 fichier\(s\) NON analysé\(s\)/)
    expect(rapport).toMatch(/`\.ps1` : 2/)
    expect(rapport).toMatch(/`\.py` : 1/)
  })

  it('dit explicitement "aucun" quand tout est couvert, au lieu de se taire', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'export const a = 1\n' }))
    expect(rapport).toMatch(/## 0\. Angle mort — aucun/)
  })

  it('place l angle mort AVANT la premiere section de candidats', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'export const a = 1\n', 'b.ps1': 'x\n' }))
    expect(rapport.indexOf('## 0. Angle mort')).toBeLessThan(rapport.indexOf('## 1. Fichiers'))
  })
})

describe('scout-residus — chemins absolus morts dans des fichiers vivants', () => {
  it('signale une racine Windows dont le dossier parent n existe pas', () => {
    // La racine est tiree du bac temporaire + un identifiant aleatoire : garantie absente sur
    // TOUTE machine. Une racine codee en dur existait sur certains postes, et rendait ce test
    // vert-ou-rouge selon la machine.
    const absent = join(parse(tmpdir()).root, 'scout-residus-absent-' + randomUUID(), 'sous')
    const d = dossier({ 'runner.ps1': "Set-Location '" + absent + "'" + chr10 })
    const rapport = sonde(d)
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts/)
    expect(rapport).toMatch(/runner\.ps1:1/)
    expect(rapport).toContain(absent)
  })

  it('lit les extensions que la sonde n analyse PAS — .ps1 y compris', () => {
    // Le defaut decisif du banc du 2026-09-06 vivait dans un `.ps1`, hors du filtre EXT.
    const contenu = ["Set-Location 'Z:", 'dossier-inexistant', "sous'"].join(String.fromCharCode(92)) + chr10
    const rapport = sonde(dossier({ 'seul.ps1': contenu }))
    expect(rapport).toMatch(/seul\.ps1:1/)
  })

  it('ne confond pas une URL avec une racine Windows', () => {
    const rapport = sonde(dossier({ 'a.mjs': "const u = 'http://127.0.0.1:9222/json'\n" }))
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('ignore un chemin interpole, invérifiable hors execution', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'const p = `C:/sortie/${nom}.png`\n' }))
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('rappelle d EXECUTER les scripts declares vivants, meme quand rien n est signale', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'export const a = 1\n' }))
    expect(rapport).toMatch(/exécute ceux que tu déclares vivants/)
  })
})

// Pourquoi ces trois cas : au banc /arena du 2026-09-06 (v3), le bras guidé par la sonde a perdu
// en reprenant ~10 signalements dont le motif « dossier de sortie disparu » était REFUTÉ par la
// ligne citée elle-même — le dossier est recréé par `mkdirSync(…, { recursive: true })`, ou le
// chemin n'est qu'un DEFAUT surchargeable (`arg('--out-dir', …)`, `process.env.X || …`). Un
// signalement dont la ligne porte sa propre réfutation coûte plus cher qu'un silence.
describe('scout-residus — chemins morts : ce qui n est PAS mort', () => {
  it('ecarte un dossier recree par mkdirSync recursive dans le meme fichier', () => {
    const rapport = sonde(
      dossier({
        'a.mjs': [
          "import { mkdirSync } from 'node:fs'",
          "const OUT = 'C:/nulle-part-xyz/rapports'",
          'mkdirSync(OUT, { recursive: true })',
          ''
        ].join(chr10)
      })
    )
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('ecarte un chemin qui n est qu un DEFAUT derriere un drapeau CLI', () => {
    const rapport = sonde(
      dossier({ 'a.mjs': "const out = arg('--out-dir', 'C:/nulle-part-xyz/rapports/x.png')" + chr10 })
    )
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('ecarte un chemin qui n est qu un repli de variable d environnement', () => {
    const rapport = sonde(
      dossier({ 'a.mjs': "const out = process.env.AUTOWIN_REPORT || 'C:/nulle-part-xyz/r/x.json'" + chr10 })
    )
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('ne lit pas un fichier BINAIRE (image) comme du texte', () => {
    const nul = String.fromCharCode(0)
    const rapport = sonde(
      dossier({ 'fond.png': 'PNG' + nul + nul + 'S:/nulle-part-xyz/octets-d-image' + nul + chr10 })
    )
    expect(rapport).toMatch(/## 0 bis\. Chemins absolus morts — aucun/)
  })

  it('signale ENCORE une racine codee en dur sans repli ni recreation', () => {
    const rapport = sonde(
      dossier({ 'b.mjs': "const racine = 'C:/nulle-part-xyz/socle'" + chr10 + 'readFileSync(racine)' + chr10 })
    )
    expect(rapport).toMatch(/b\.mjs:1/)
  })
})

// Pourquoi ces cas : au /residus du 2026-10-22 (conv-1062), les 59 « chemins absolus morts » de la
// passe 0 bis etaient TOUS des faux positifs — 30 commentaires et 5 fixtures dans `src/`, 24 lignes
// d'aide, de commentaire ou de donnees de test `_test.py` dans `scripts/`. Une section qui ne
// rapporte que du bruit apprend au lecteur a l'ignorer, y compris le jour ou elle a raison.
// Les chemins a barres obliques inverses passent par `String.raw` : en chaine ordinaire, `C:\nulle`
// porterait un saut de ligne et le cas ne testerait plus rien.
describe('scout-residus — chemins morts : commentaires, aide et donnees de test', () => {
  const aucun = /## 0 bis\. Chemins absolus morts — aucun/

  it('ignore une ligne de commentaire // ou * (bloc JS)', () => {
    const rapport = sonde(
      dossier({
        'a.mjs': [
          '// mesure faite dans C:/nulle-part-xyz/ancien-depot',
          '/**',
          String.raw` * ouverte dans E:\nulle-part-xyz\Autowin-OS, tour mort`,
          ' */',
          'export const a = 1',
          ''
        ].join(chr10)
      })
    )
    expect(rapport).toMatch(aucun)
  })

  it('ignore un commentaire # et un bloc d aide <# … #> PowerShell', () => {
    const rapport = sonde(
      dossier({
        'outil.ps1': [
          '<#',
          String.raw`  Usage : powershell -File outil.ps1 -Executable "C:\nulle-part-xyz\app.exe"`,
          '#>',
          String.raw`# modele : D:\nulle-part-xyz\Smoke\Runner.cs`,
          'Write-Host ok',
          ''
        ].join(chr10)
      })
    )
    expect(rapport).toMatch(aucun)
  })

  it('ignore un test Python _test.py, qui invente ses chemins comme un .test.mjs', () => {
    const rapport = sonde(
      dossier({
        'logo_test.py': String.raw`copie = r"D:\nulle-part-xyz\worktrees\icon.ico"` + chr10
      })
    )
    expect(rapport).toMatch(aucun)
  })

  it('ignore une fixture __fixtures__/ ou *.fixture.json', () => {
    const rapport = sonde(
      dossier({
        '__fixtures__/sortie.md': String.raw`| 1 | C:\nulle-part-xyz\application.exe |` + chr10,
        'juges.fixture.json': '{ "detail": "D:/nulle-part-xyz/worktrees/a.ts" }' + chr10
      })
    )
    expect(rapport).toMatch(aucun)
  })

  it('signale ENCORE une racine de code qui suit un bloc de commentaire ferme', () => {
    const rapport = sonde(
      dossier({
        'c.mjs': [
          '/* ancien : C:/nulle-part-xyz/a */',
          "const r = 'C:/nulle-part-xyz/socle'",
          ''
        ].join(chr10)
      })
    )
    expect(rapport).toMatch(/c\.mjs:2/)
    expect(rapport).not.toMatch(/c\.mjs:1/)
  })

  it('signale ENCORE une racine de code PowerShell apres un bloc <# … #> ferme', () => {
    const rapport = sonde(
      dossier({
        'run.ps1': ['<# aide #>', String.raw`Set-Location 'Q:\nulle-part-xyz\socle'`, ''].join(
          chr10
        )
      })
    )
    expect(rapport).toMatch(/run\.ps1:2/)
  })
})
