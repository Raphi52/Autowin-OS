import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * MEME CAUSE QUE LA CORRUPTION D'`edit_file`, DE L'AUTRE COTE : `readFileSync(p, 'utf8')` ne jette
 * PAS sur une entree invalide — Node substitue U+FFFD. Cote LECTURE rien n'est detruit sur le
 * disque, mais le modele recoit une ligne FAUSSE presentee comme le contenu du fichier, sans le
 * moindre signal ; et c'est sur cette ligne qu'il batira son `oldText`.
 *
 * On ne refuse pas la lecture (l'ASCII du fichier reste vrai et utile, et un refus aveuglerait
 * l'agent sans rien proteger) : on NOMME la substitution.
 *
 * ENTREE QUI FAIT ECHOUER CES TESTS SI LA GARDE EST FAUSSE : ce meme fichier cp1252 lu SANS le
 * drapeau — le `\uFFFD` arrive alors dans le contenu sans qu'aucun champ ne le signale, ce que la
 * premiere version du produit faisait exactement.
 */
const CRLF = String.fromCharCode(13, 10)
const REMPLACEMENT = String.fromCharCode(0xfffd)

const temporaires: string[] = []
afterEach(() => {
  while (temporaires.length > 0) {
    try {
      rmSync(temporaires.pop()!, { recursive: true, force: true })
    } catch {
      /* un fichier verrouille ne doit pas faire echouer le test qui vient de passer */
    }
  }
})

/** Un dossier contenant UN fichier cp1252 et UN fichier UTF-8 accentue, pour discriminer. */
function bureau(): { racine: string; bus: AppCommandBus } {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-encodage-'))
  temporaires.push(racine)
  writeFileSync(
    join(racine, 'legacy.ts'),
    Buffer.concat([
      Buffer.from('// calcul', 'latin1'),
      Buffer.from([0xe9]), // `é` en cp1252 : aucun decodage utf8 ne sait le rendre
      Buffer.from(' vieux fichier' + CRLF + 'export const legacy = 1' + CRLF, 'latin1')
    ])
  )
  // Le TEMOIN : accentue lui aussi, mais en UTF-8 valide. Il ne doit JAMAIS etre signale.
  writeFileSync(join(racine, 'moderne.ts'), '// calculé fichier moderne' + CRLF, 'utf8')
  const bus = new AppCommandBus({ executionWorkspace: racine } as never, () => undefined)
  return { racine, bus }
}

describe('lecture d’un fichier non UTF-8 — la substitution silencieuse est NOMMÉE', () => {
  it('read_file signale l’encodage et rend quand même les lignes ASCII', async () => {
    const { bus } = bureau()

    const result = await bus.exec('read_file', { path: 'legacy.ts' })

    const data = (result.data ?? {}) as { lu?: boolean; contenu?: string; encodage?: string }
    expect(data.lu).toBe(true)
    // L'ASCII reste vrai et exploitable : on n'a pas aveuglé l'agent.
    expect(data.contenu ?? '').toContain('export const legacy = 1')
    // La ligne rendue MENT — et le champ le dit. Sans lui, rien ne distingue ce � d'un vrai.
    expect(data.contenu ?? '').toContain(REMPLACEMENT)
    expect(data.encodage ?? '').toContain('non UTF-8')
  })

  it('ne signale RIEN sur un fichier UTF-8 accentué — le drapeau discrimine', async () => {
    const { bus } = bureau()

    const result = await bus.exec('read_file', { path: 'moderne.ts' })

    const data = (result.data ?? {}) as { contenu?: string; encodage?: string }
    expect(data.contenu ?? '').toContain('calculé')
    expect(data.contenu ?? '').not.toContain(REMPLACEMENT)
    // Un drapeau qui se leve aussi sur du texte VALIDE ne vaut rien : il serait ignore.
    expect(data.encodage).toBeUndefined()
  })

  it('find_in_files nomme les fichiers non UTF-8 qu’il CITE, et eux seuls', async () => {
    const { bus } = bureau()

    const result = await bus.exec('find_in_files', { pattern: 'fichier' })

    const data = (result.data ?? {}) as { correspondances?: string[]; fichiersNonUtf8?: string[] }
    // Les deux fichiers contiennent le motif : la recherche n'en écarte aucun.
    expect((data.correspondances ?? []).join('|')).toContain('legacy.ts')
    expect((data.correspondances ?? []).join('|')).toContain('moderne.ts')
    expect(data.fichiersNonUtf8).toEqual(['legacy.ts'])
  })
})
