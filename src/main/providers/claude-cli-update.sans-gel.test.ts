import { ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { claudeExeEnCours, maybeUpdateClaudeCli } from './claude-cli-update'
import { arreterFilDExecution } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'

/**
 * LA MISE À JOUR DU CLI CLAUDE NE CRÉE PLUS DE PROCESSUS SUR LE FIL PRINCIPAL (2026-10-31).
 *
 * Mesure `gels.jsonl`, session du 2026-10-31 19:33 → 20:22 UTC : `spawn tasklist`
 * (`claude-cli-update.ts:125`, 20,8 s d'un seul appel — retenté toutes les 15 min tant que le CLI
 * tourne) et `spawn cmd.exe` (`claude-cli-update.ts:136`, 16,2 s).
 *
 * Aucun test ne lance le vrai CLI : un faux `claude.cmd` tient sa place.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : `tasklist` ou `claude update` créés par le fil principal.
 */
const windows = process.platform === 'win32'
let dossier = ''
beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'aos-cli-sans-gel-'))
  writeFileSync(
    join(dossier, 'faux-ok.cmd'),
    '@echo Checking for updates...\r\n@echo Successfully updated to version 9.9.9\r\n'
  )
  writeFileSync(join(dossier, 'faux-ko.cmd'), '@echo debut\r\n@echo boom 1>&2\r\n@exit /b 2\r\n')
})
afterAll(async () => {
  await arreterFilDExecution()
  await supprimerArbre(dossier)
})

const sansCreationSurCeFil = async <T>(geste: () => Promise<T>): Promise<T> => {
  const creations = vi.spyOn(ChildProcess.prototype as unknown as { spawn: () => unknown }, 'spawn')
  try {
    const resultat = await geste()
    expect(creations).not.toHaveBeenCalled()
    return resultat
  } finally {
    creations.mockRestore()
  }
}

describe.skipIf(!windows)('mise à jour du CLI Claude — hors du fil principal', () => {
  it('claudeExeEnCours voit une image qui tourne (node.exe), sans créer de processus ici', async () => {
    expect(await sansCreationSurCeFil(() => claudeExeEnCours('C:/x/node.exe'))).toBe(true)
  })

  it('claude update réussi : outcome updated et dernière ligne utile', async () => {
    const resultat = await sansCreationSurCeFil(() =>
      maybeUpdateClaudeCli(join(dossier, 'stamp-ok.json'), { bin: join(dossier, 'faux-ok.cmd') })
    )
    expect(resultat).toEqual({
      outcome: 'updated',
      detail: 'Successfully updated to version 9.9.9'
    })
  })

  it('claude update en échec : outcome failed, et la ligne d’erreur reste le détail', async () => {
    const resultat = await sansCreationSurCeFil(() =>
      maybeUpdateClaudeCli(join(dossier, 'stamp-ko.json'), { bin: join(dossier, 'faux-ko.cmd') })
    )
    expect(resultat).toEqual({ outcome: 'failed', detail: 'boom' })
  })
})
