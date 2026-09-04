import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { materializeClaudeAttachments } from './claude'

/*
 * LE NETTOYAGE DE FIN D'APPEL NE DOIT JAMAIS TENIR LA BOUCLE PRINCIPALE.
 *
 * Même classe de défaut que celui déjà corrigé pour le dossier de system-prompt : journal réel
 * `.autowin-data/autowin-os/gels.jsonl` (2026-08-31 18:45:36), `io:disque:rmSync` mesuré a 1 625 ms,
 * cause `entree-sortie-bloquante`. La suppression du dossier de PIÈCES JOINTES était restée
 * synchrone (`rmSync`) alors qu'elle s'exécute a la fin de CHAQUE appel au CLI, sur le fil qui
 * dessine la fenêtre — et un dossier d'images pèse bien plus qu'un fichier de prompt.
 *
 * Rien n'attend ce nettoyage. Il rend donc une promesse, et la variante asynchrone rend la main
 * entre chaque accès disque au lieu de figer l'interface.
 */
describe('claude — le nettoyage des pièces jointes ne bloque pas le fil principal', () => {
  it('rend une promesse plutôt que de supprimer en synchrone', async () => {
    const materialise = materializeClaudeAttachments([
      { kind: 'text', name: 'note.txt', mimeType: 'text/plain', content: 'bonjour' }
    ] as Parameters<typeof materializeClaudeAttachments>[0])

    expect(existsSync(materialise.dir)).toBe(true)
    const rendu = materialise.cleanup()
    expect(rendu).toBeInstanceOf(Promise)
    await rendu
    expect(existsSync(materialise.dir)).toBe(false)
  })

  it('un dossier déjà disparu ne casse pas la fin d’appel', async () => {
    const materialise = materializeClaudeAttachments([
      { kind: 'text', name: 'note.txt', mimeType: 'text/plain', content: 'bonjour' }
    ] as Parameters<typeof materializeClaudeAttachments>[0])

    await materialise.cleanup()
    await expect(materialise.cleanup()).resolves.toBeUndefined()
  })
})
