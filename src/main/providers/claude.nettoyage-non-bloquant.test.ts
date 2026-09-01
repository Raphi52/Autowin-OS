import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nettoyerTemporairesDeLAppel } from './claude'

/**
 * LE NETTOYAGE DE FIN D'APPEL NE TIENT PLUS LA BOUCLE PRINCIPALE.
 *
 * Mesure du journal reel `.autowin-data/autowin-os/gels.jsonl` (2026-08-31 18:45:36) : deux gels
 * IMBRIQUES, mesures DIRECTEMENT sur l'appel lui-meme par l'enrobage de `gel-main` (ce n'est donc
 * pas une coincidence de battement) — `io:disque:rmSync C:/…/autowin-os-system-ajZp7B` a 1 625 ms
 * et `io:disque:unlinkSync` a 1 624 ms, cause `entree-sortie-bloquante`. Supprimer le dossier
 * temporaire du system-prompt figeait donc la fenetre 1,6 s a la fin de l'appel au CLI.
 *
 * COMMENT ON LE PROUVE, et pourquoi PAS avec l'instrument du produit : `instrumenterEntreesSorties-
 * DuMain` remplace les fonctions sur l'OBJET de module `node:fs`. Sous vitest, les sources restent
 * en ESM : un import nomme (`import { rmSync } from 'node:fs'`) est lie a la fonction ORIGINALE au
 * chargement et echappe au remplacement — mesure faite ici meme, un `rmSync` appele ainsi n'a
 * produit AUCUN gel. Un test bati dessus serait donc vert par aveuglement. Dans l'application
 * LIVREE le bundle est du CJS, l'appel repasse par l'objet de module et l'instrument voit bien
 * l'acces : c'est ainsi que les 1 625 ms du journal ont ete captes.
 *
 * On prouve donc le contraire d'un blocage, directement : au retour de l'appel et AVANT de
 * l'attendre, le travail ne doit PAS deja etre fait. Une suppression synchrone aurait tout efface
 * sans rendre la main ; une suppression asynchrone ne le peut pas.
 */
describe('claude — nettoyage de fin d’appel', () => {
  it('ne supprime rien en tenant la boucle, et supprime bien tout ensuite', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-test-nettoyage-'))
    const systemPromptDir = join(base, 'system')
    const settingsDir = join(base, 'settings')
    mkdirSync(systemPromptDir)
    mkdirSync(settingsDir)
    writeFileSync(join(systemPromptDir, 'system.md'), 'x'.repeat(5_000), 'utf8')
    writeFileSync(join(settingsDir, 'settings.json'), '{}', 'utf8')
    const inputPath = join(base, 'input.txt')
    writeFileSync(inputPath, 'prompt', 'utf8')

    const enCours = nettoyerTemporairesDeLAppel({ systemPromptDir, settingsDir, inputPath })
    // Le refutateur : avec l'ancien `rmSync`, ces trois lignes seraient deja `false`.
    const dejaFaitSansRendreLaMain = [
      !existsSync(systemPromptDir),
      !existsSync(settingsDir),
      !existsSync(inputPath)
    ]
    await enCours

    expect(dejaFaitSansRendreLaMain).toEqual([false, false, false])
    expect(existsSync(systemPromptDir)).toBe(false)
    expect(existsSync(settingsDir)).toBe(false)
    expect(existsSync(inputPath)).toBe(false)
  })

  it('supprime un journal de sortie VIDE et garde celui qui a servi', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-test-journal-'))
    const vide = join(base, 'vide.jsonl')
    const plein = join(base, 'plein.jsonl')
    writeFileSync(vide, '', 'utf8')
    writeFileSync(plein, '{"a":1}\n', 'utf8')

    await nettoyerTemporairesDeLAppel({ journalPath: vide })
    await nettoyerTemporairesDeLAppel({ journalPath: plein })

    expect(existsSync(vide)).toBe(false)
    // Le journal NON vide est la trace d'un appel qui a reellement parle : on ne le jette pas.
    expect(existsSync(plein)).toBe(true)
  })
})
