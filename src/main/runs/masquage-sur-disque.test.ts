import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  masquerFichierEnPlace,
  motifsDeMasquage,
  remplacementMemeLongueur
} from './masquage-sur-disque'

let dossier: string | undefined
afterEach(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true })
  dossier = undefined
})
const fichier = (nom: string, contenu: string | Buffer): string => {
  dossier ??= mkdtempSync(join(tmpdir(), 'masquage-disque-'))
  const chemin = join(dossier, nom)
  writeFileSync(chemin, contenu)
  return chemin
}

describe('masquage sur disque — même longueur, à la même place', () => {
  it('le remplacement a toujours la taille exacte de la valeur', () => {
    expect(remplacementMemeLongueur('GROQ_API_KEY', 30).toString()).toBe(
      '[secret:GROQ_API_KEY]*********'
    )
    // L'étiquette ne tient pas : des astérisques seuls, jamais un texte plus long.
    expect(remplacementMemeLongueur('GROQ_API_KEY', 10).toString()).toBe('**********')
  })

  it('une valeur à cheval sur deux morceaux de lecture (1 Mo) est masquée entière', async () => {
    const valeur = 'gsk_coupee_entre_deux_morceaux_0123'
    const avant = Buffer.alloc(1024 * 1024 - 10, 'a')
    const chemin = fichier('gros.jsonl', Buffer.concat([avant, Buffer.from(`${valeur}\nfin\n`)]))
    const taille = statSync(chemin).size

    const { remplacements } = await masquerFichierEnPlace(
      chemin,
      motifsDeMasquage({ GROQ_API_KEY: valeur })
    )

    expect(remplacements).toBe(1)
    const relu = readFileSync(chemin, 'utf8')
    expect(relu).not.toContain(valeur)
    expect(relu.endsWith(`${remplacementMemeLongueur('GROQ_API_KEY', valeur.length)}\nfin\n`)).toBe(
      true
    )
    expect(statSync(chemin).size).toBe(taille)
  })

  it('une valeur avec guillemet est retrouvée sous sa forme échappée par JSON', async () => {
    const valeur = 'abc"def\\ghi-0123'
    const ligne = JSON.stringify({ sortie: `clé ${valeur}` })
    const chemin = fichier('json.jsonl', `${ligne}\n`)

    await masquerFichierEnPlace(chemin, motifsDeMasquage({ MA_CLE_SECRET: valeur }))

    const relu = readFileSync(chemin, 'utf8')
    expect(relu).not.toContain(JSON.stringify(valeur).slice(1, -1))
    expect(() => JSON.parse(relu)).not.toThrow()
    expect(relu.length).toBe(ligne.length + 1)
  })

  it('reprend à une position, sans rater une valeur coupée par la lecture précédente', async () => {
    const valeur = 'sk-reprise-0123456789'
    const ligne = `debut ${valeur} fin\n`
    const chemin = fichier('reprise.log', ligne)
    // La lecture précédente s'est arrêtée au milieu de la valeur.
    const coupe = ligne.indexOf(valeur) + 4

    const { remplacements, taille } = await masquerFichierEnPlace(
      chemin,
      motifsDeMasquage({ CLE_API_KEY: valeur }),
      coupe
    )

    expect(remplacements).toBe(1)
    expect(taille).toBe(Buffer.byteLength(ligne))
    expect(readFileSync(chemin, 'utf8')).not.toContain(valeur)
  })

  it('une valeur trop courte n’est pas masquée, et un fichier absent ne fait rien', async () => {
    expect(motifsDeMasquage({ COURT_KEY: '1234567' }).liste).toHaveLength(0)
    const absent = join(tmpdir(), 'masquage-disque-absent-0000.jsonl')
    await expect(
      masquerFichierEnPlace(absent, motifsDeMasquage({ CLE_KEY: 'valeur-longue-0123' }))
    ).resolves.toEqual({ remplacements: 0, taille: 0 })
  })
})
