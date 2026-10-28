import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  creerDossiersDuChat,
  FICHIER_DES_DOSSIERS_DU_CHAT,
  lireDossiersDuChatGardes
} from './board-dossiers-du-chat'

/**
 * La liste des dossiers du Chat gardée sur le poste (conv-1212). Entrée qui doit faire échouer ce
 * fichier : une liste perdue au redémarrage (la recopie de fin de tour renverrait alors tout sur le
 * partage), ou un fichier illisible qui ferait échouer le Board.
 */
const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})
function racine(): string {
  const d = mkdtempSync(join(tmpdir(), 'board-dossiers-chat-'))
  dossiers.push(d)
  return d
}

describe('creerDossiersDuChat', () => {
  it('jamais reçue = null ; reçue = gardée sur le poste et relue au lancement suivant', async () => {
    const r = racine()
    const liste = creerDossiersDuChat({ racine: r })
    expect(liste.lire()).toBeNull()
    liste.retenir(['D:\\AutoWinOS', 'D:\\Factures'], ['C:\\Users\\moi'])
    const attendue = { dossiers: ['D:\\AutoWinOS', 'D:\\Factures'], retires: ['C:\\Users\\moi'] }
    expect(liste.lire()).toEqual(attendue)
    await liste.attendre()
    expect(JSON.parse(readFileSync(join(r, FICHIER_DES_DOSSIERS_DU_CHAT), 'utf8'))).toEqual(
      attendue
    )
    // Les retraits survivent au redémarrage : la recopie de fin de tour les respecte Board fermé.
    expect(creerDossiersDuChat({ racine: r }).lire()).toEqual(attendue)
  })

  it('une liste vide reste une liste (Board vide), pas « jamais reçue »', async () => {
    const r = racine()
    const liste = creerDossiersDuChat({ racine: r })
    liste.retenir([])
    await liste.attendre()
    expect(creerDossiersDuChat({ racine: r }).lire()).toEqual({ dossiers: [], retires: [] })
  })

  it('un fichier de la forme d’avant (tableau seul) se relit sans retrait', () => {
    const r = racine()
    writeFileSync(join(r, FICHIER_DES_DOSSIERS_DU_CHAT), '["D:\\\\Factures"]', 'utf8')
    expect(lireDossiersDuChatGardes(r)).toEqual({ dossiers: ['D:\\Factures'], retires: [] })
  })

  it('fichier illisible = null, sans échec', () => {
    const r = racine()
    writeFileSync(join(r, FICHIER_DES_DOSSIERS_DU_CHAT), '{pas du json', 'utf8')
    expect(lireDossiersDuChatGardes(r)).toBeNull()
  })
})
