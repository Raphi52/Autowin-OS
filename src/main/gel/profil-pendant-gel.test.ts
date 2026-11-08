import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOSSIER_DES_PROFILS, INDEX_DES_PROFILS } from './profil-pendant-gel'

/*
 * Le motif de « notre code » est celui du bundle en production ; l'enfant de ce test est un fichier
 * `enfant.mts`, donc le motif est passé en réglage. C'est le seul réglage qui change pour le test.
 */

/*
 * Le profileur ne voit que le thread PRINCIPAL du processus (`connectToMainThread`), et Vitest fait
 * tourner ce fichier dans un worker : le gel doit donc avoir lieu dans un processus à part, sur son
 * principal. L'enfant charge le vrai module (Node retire les types tout seul) et gèle deux fois :
 * 0,7 s (sous le seuil de garde) puis 2,5 s (au-dessus), avec des seuils raccourcis.
 */
function geleDansUnProcessusAPart(dir: string): Promise<void> {
  const module = pathToFileURL(join(__dirname, 'profil-pendant-gel.ts')).href
  const script = join(dir, 'enfant.mts')
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs'
import { demarrerProfilPendantGel, lireNomDuGelProfile } from ${JSON.stringify(module)}
const arreter = demarrerProfilPendantGel(${JSON.stringify(dir)}, {
  battementMs: 50, tickMs: 50, silenceAvantProfilMs: 300, gelGardeMs: 1500, couvertureMinMs: 300,
  motifNotreCode: 'enfant[.]mts$'
})
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
function geleCourtExpres() { const fin = Date.now() + 700; let x = 0; while (Date.now() < fin) x += Math.sqrt(x + 1); return x }
function boucleQuiGeleExpres() { const fin = Date.now() + 2500; let x = 0; while (Date.now() < fin) x += Math.sqrt(x + 1); return x }
await attendre(500)
geleCourtExpres()
await attendre(800)
boucleQuiGeleExpres()
await attendre(1500)
writeFileSync(${JSON.stringify(join(dir, 'nom.json'))}, JSON.stringify(lireNomDuGelProfile() ?? null))
arreter()
`
  )
  return new Promise((ok, ko) =>
    execFile(process.execPath, [script], { timeout: 30_000 }, (erreur, _sortie, erreurs) =>
      erreur ? ko(new Error(`${erreur.message}\n${erreurs}`)) : ok()
    )
  )
}

describe('profil CPU pendant un gel du processus principal', () => {
  it('garde le profil du gel long, qui nomme la fonction, et jette le gel court', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'profil-gel-'))
    await geleDansUnProcessusAPart(dir)

    const index = join(dir, DOSSIER_DES_PROFILS, INDEX_DES_PROFILS)
    expect(existsSync(index)).toBe(true)
    const lignes = readFileSync(index, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    // Un seul profil : le gel de 0,7 s est sous le seuil de garde.
    expect(lignes).toHaveLength(1)
    const [entree] = lignes
    expect(entree.schema).toBe('autowin.gel-profil/v1')
    expect(entree.gelMs).toBeGreaterThanOrEqual(1500)
    expect(Date.parse(entree.fin)).toBeGreaterThan(Date.parse(entree.debut))

    const profil = JSON.parse(readFileSync(join(dir, DOSSIER_DES_PROFILS, entree.fichier), 'utf8'))
    expect(profil.samples.length).toBeGreaterThan(50)

    /*
     * Le NOM vient des relevés de pile, pas du profil : la boucle, compilée à la volée avant que le
     * profileur démarre, y sort sans nom (mesuré, voir l'en-tête du module). Retirer les relevés
     * rend ce test rouge.
     */
    const { piles } = JSON.parse(readFileSync(join(dir, DOSSIER_DES_PROFILS, entree.piles), 'utf8'))
    expect(entree.releves).toBe(piles.length)
    expect(piles.length).toBeGreaterThanOrEqual(3)
    const sommets = (piles as Array<{ frames: string[] }>).map((p) => p.frames[0])
    expect(
      sommets.every((frame) => /^boucleQuiGeleExpres .*enfant\.mts:\d+:\d+$/.test(frame))
    ).toBe(true)
    // Position de DÉBUT de la fonction : tous les relevés de la même boucle donnent la même frame.
    expect(new Set(sommets).size).toBe(1)
    expect(JSON.stringify(piles)).not.toContain('geleCourtExpres')

    /*
     * LE NOM DU JOURNAL. fix-ok: le journal écrit « inconnu » pour les 10 gels profilés
     * (gels.jsonl, 06/11 10:57:00.222Z et suivants) parce que nommerOperationDuGel ne lit que
     * l'opération déclarée et l'accumulation, jamais le profil. Le détecteur doit donc lire le nom
     * pendant le gel, dans les relevés, et non après coup dans le classement.
     */
    const nomLu = JSON.parse(readFileSync(join(dir, 'nom.json'), 'utf8'))
    expect(nomLu).toBe('boucleQuiGeleExpres')
  }, 40_000)
})
