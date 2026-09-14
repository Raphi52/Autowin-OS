import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prendreVerrou, reserverAvecAttente } from './avec-instance-headless.mjs'

const racineScripts = __dirname
const lire = (nom) => readFileSync(join(racineScripts, nom), 'utf8')

/*
 * SUITE DU 2026-09-13 (travaux paralleles). Quatre trous restaient apres la reservation par verrou.
 */
describe('instances headless paralleles — trous restants', () => {
  /*
   * 1. COURSE A LA REPRISE D'UN VERROU MORT : A lit le pid mort, B reprend le verrou pendant ce
   * temps, puis A ecrasait le verrou VIVANT de B — les deux se croyaient proprietaires.
   */
  it('un seul lanceur gagne la reprise simultanee d un verrou mort', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-reprise-'))
    try {
      const fichier = join(racine, 'instance-x.lock')
      writeFileSync(fichier, '900')
      const vivant = (pid) => pid === 1 || pid === 2
      let b
      const a = prendreVerrou(fichier, 1, vivant, {
        apresLecture: () => {
          b = prendreVerrou(fichier, 2, vivant)
        }
      })
      expect(typeof b).toBe('boolean')
      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect(Number(readFileSync(fichier, 'utf8'))).toBe(a ? 1 : 2)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  /* 2. --attendre : une instance du meme nom occupee fait patienter au lieu de refuser. */
  it('attend que l instance du meme nom se libere, puis reserve', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-attente-'))
    try {
      const occupant = {
        racineInstances: racine,
        instanceId: 'x',
        portDemande: 9700,
        occupes: new Set(),
        pid: 1,
        vivant: () => true
      }
      const premier = reserverAvecAttente({ ...occupant, attendreMs: 0 })
      expect(premier.port).toBe(9700)
      let sommes = 0
      const second = reserverAvecAttente({
        ...occupant,
        pid: 2,
        attendreMs: 10000,
        dormir: () => {
          sommes += 1
          if (sommes === 2) for (const v of premier.verrous) rmSync(v, { force: true })
        }
      })
      expect(sommes).toBe(2)
      expect(second.refus).toBeUndefined()
      const sansAttente = reserverAvecAttente({ ...occupant, pid: 3, attendreMs: 0 })
      expect(sansAttente.refus).toBe('instance-occupee')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  /* 3. LES SONDES QUI DEMARRENT LEUR PROPRE INSTANCE passent par la reservation partagee. */
  it.each([
    'cdp-memory-system-proof.mjs',
    'cdp-knowledge-circular-proof.mjs',
    'cdp-relance-jusquau-vert-proof.mjs',
    'cdp-trois-conversations-proof.mjs',
    'verifier-chemin-critique.mjs',
    'verifier-sondes-lecture.mjs'
  ])('%s reserve son instance et son port', (nom) => {
    const source = lire(nom)
    expect(source).toMatch(/reserverInstance\(/)
    expect(source).not.toMatch(/choisirPortLibre\(/)
    expect(source).not.toMatch(/const port = \d+/)
  })

  /*
   * 4. BOM A LA SOURCE : `Set-Content -Encoding utf8` ecrit un BOM sous PowerShell 5, que JSON.parse
   * refuse. Les JSON ecrits par les .ps1 doivent l'etre sans BOM, et relus explicitement en UTF-8.
   */
  it('aucun script PowerShell n ecrit de JSON avec Set-Content', () => {
    const fautifs = readdirSync(racineScripts)
      .filter((f) => f.endsWith('.ps1') && !f.endsWith('.test.ps1'))
      .filter((f) => /ConvertTo-Json[^\n]*\|\s*Set-Content/i.test(lire(f)))
    expect(fautifs).toEqual([])
    expect(lire('autowin-headless.ps1')).toMatch(
      /Get-Content -LiteralPath \$stateFile -Raw -Encoding UTF8/
    )
  })
})

/*
 * 5. PRET TROP TOT : le lanceur declarait l'instance prete des qu'une page CDP existait — y compris
 * l'ecran d'attente `autowin-boot.html`, qui n'a pas le droit d'appeler l'IPC (« Origine renderer non
 * autorisee : null »). Seule, l'app passait l'attente assez vite ; deux demarrages simultanes la
 * ralentissaient et la sonde tombait dessus (reproduit 3 fois le 2026-09-13, sonde d'origine comprise).
 */
describe('pret seulement sur la vraie interface', () => {
  it('le lanceur ignore l ecran d attente dans sa detection de page prete', () => {
    const source = readFileSync(join(__dirname, 'autowin-headless.ps1'), 'utf8')
    expect(source).toMatch(/autowin-boot\.html/)
    expect(source).not.toMatch(/if \(\$pages\) \{/)
  })
})
