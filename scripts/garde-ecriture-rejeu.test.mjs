import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rejouer } from './garde-ecriture-rejeu.mjs'

/*
 * Le rejeu passe par la VRAIE garde : une entrée neuve à la racine d'un disque est refusée, une
 * écriture dans le dossier temporaire passe. ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un écart entre
 * l'attendu et l'obtenu rendu en code 0 ; un chemin Windows à antislashs mal transmis à la garde.
 */
const SCRIPT = fileURLToPath(new URL('./garde-ecriture-rejeu.mjs', import.meta.url))

describe('garde-ecriture-rejeu — la vraie garde, cas par cas', () => {
  let dossier
  let racineNeuve
  beforeAll(() => {
    dossier = realpathSync.native(mkdtempSync(join(tmpdir(), 'garde-rejeu-')))
    racineNeuve = `${dossier.slice(0, 2)}\\garde-rejeu-${process.pid}-${Date.now()}\\banc.log`
  })
  afterAll(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true })
  })
  const ecrire = (file_path) => ({
    tool_name: 'Write',
    tool_input: { file_path, content: 'x' },
    cwd: dossier
  })

  it('refus et passage lus sur la sortie de la garde, chemins à antislashs compris', () => {
    const [refus, passe] = rejouer([
      { attendu: 'refus', nom: 'racine du disque', entree: ecrire(racineNeuve) },
      { attendu: 'passe', nom: 'dossier temporaire', entree: ecrire(join(dossier, 'a.log')) }
    ])
    expect(refus).toMatchObject({ obtenu: 'refus', conforme: true })
    expect(refus.motif).toMatch(/racine du disque/u)
    expect(passe).toMatchObject({ obtenu: 'passe', conforme: true, motif: '' })
  })

  it('un écart avec l’attendu rend le code 1 ; un fichier de cas illisible, le code 2', () => {
    const cas = join(dossier, 'cas.json')
    writeFileSync(
      cas,
      JSON.stringify([{ attendu: 'passe', nom: 'écart', entree: ecrire(racineNeuve) }])
    )
    const ecart = spawnSync(process.execPath, [SCRIPT, cas], { encoding: 'utf8' })
    expect(ecart.status).toBe(1)
    expect(ecart.stdout).toMatch(/^KO {2}refus {2}écart/mu)
    writeFileSync(cas, '{pas du json')
    expect(spawnSync(process.execPath, [SCRIPT, cas], { encoding: 'utf8' }).status).toBe(2)
  })
})
