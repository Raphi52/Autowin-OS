import { describe, expect, it } from 'vitest'
import { porteeAvantPublication } from './verify-command'

/**
 * La portée que le commit automatique du chat rejoue AVANT de pousser.
 *
 * Mesuré le 2026-10-01 : le commit automatique `b6d2a3fc` (conv-892) a modifié `src/main/index.ts`
 * et rendu `chat-ipc-contract.test.ts` rouge sur main pendant 20 h. Ce test LIT `index.ts`
 * (`readFileSync`) au lieu de l'importer : `vitest related src/main/index.ts` ne l'aurait PAS
 * rejoué. La portée de publication ajoute donc, pour un fichier de code, les tests qui CITENT son nom.
 */
const citants =
  (table: Record<string, readonly string[] | undefined>) =>
  async (motif: string): Promise<readonly string[] | undefined> =>
    motif in table ? table[motif] : []

describe('porteeAvantPublication — ce que le commit automatique rejoue avant de pousser', () => {
  it('ajoute à un fichier de code les tests qui le LISENT au lieu de l’importer (cas b6d2a3fc)', async () => {
    const portee = await porteeAvantPublication(
      ['src/main/index.ts'],
      citants({ 'index.ts': ['src/main/chat-ipc-contract.test.ts'] })
    )
    expect(portee).toEqual(['src/main/index.ts', 'src/main/chat-ipc-contract.test.ts'])
  })

  it('réunit les portées de plusieurs fichiers, sans doublon', async () => {
    const portee = await porteeAvantPublication(
      ['src/main/a.ts', 'src/main/b.ts'],
      citants({ 'a.ts': ['src/main/commun.test.ts'], 'b.ts': ['src/main/commun.test.ts'] })
    )
    expect(portee).toEqual(['src/main/a.ts', 'src/main/commun.test.ts', 'src/main/b.ts'])
  })

  it('garde la règle des textes : un .md cité par un test est rejoué avec lui', async () => {
    const portee = await porteeAvantPublication(
      ['skills/curate/SKILL.md'],
      citants({ '.md': ['src/main/kit-cliquets.test.ts'] })
    )
    expect(portee).toEqual(['skills/curate/SKILL.md', 'src/main/kit-cliquets.test.ts'])
  })

  it('ne conclut pas quand UN fichier n’a aucune portée, ou quand la recherche n’a pas pu se faire', async () => {
    // Un texte que personne ne cite : aucun test ne le juge, la portée n'est pas dérivable.
    expect(
      await porteeAvantPublication(['src/main/a.ts', 'notes.md'], citants({ '.md': [] }))
    ).toBeUndefined()
    // « je n'ai pas pu chercher » ne se lit jamais comme « personne ne le cite ».
    expect(
      await porteeAvantPublication(['src/main/a.ts'], citants({ 'a.ts': undefined }))
    ).toBeUndefined()
    expect(await porteeAvantPublication([], citants({}))).toBeUndefined()
  })
})
