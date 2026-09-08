import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  avertissementDossierConversation,
  diagnostiqueDossierConversation,
  dossierDeTravailDuTour
} from './bascule-dossier-conversation'

describe('avertissement quand le rangement ne pilote pas le dossier de travail', () => {
  const existe = (): boolean => true
  const AUTOWIN = 'D:\\AutoWinOS'
  const avertir = (projectPath: string | undefined, existeF = existe): string | null =>
    avertissementDossierConversation(
      diagnostiqueDossierConversation(projectPath, AUTOWIN, existeF),
      projectPath,
      AUTOWIN
    )

  it('nomme le motif de chaque cas', () => {
    expect(diagnostiqueDossierConversation('D:\\RIGApplication', AUTOWIN, existe)).toBe(
      'bascule-requise'
    )
    expect(diagnostiqueDossierConversation(AUTOWIN, AUTOWIN, existe)).toBe('deja-aligne')
    expect(diagnostiqueDossierConversation(undefined, AUTOWIN, existe)).toBe('non-range')
    expect(diagnostiqueDossierConversation('Clients/Amitel', AUTOWIN, existe)).toBe(
      'libelle-non-absolu'
    )
    expect(diagnostiqueDossierConversation('D:\\Disparu', AUTOWIN, () => false)).toBe(
      'dossier-absent'
    )
  })

  /** LE defaut a rendre visible : un libelle laisse le modele dans le depot d'Autowin, en silence. */
  it('avertit sur un libelle de rangement, en citant le dossier reellement utilise', () => {
    const texte = avertir('Clients/Amitel')
    expect(texte).toContain('Clients/Amitel')
    expect(texte).toContain(AUTOWIN)
  })

  it('avertit sur un dossier disparu du poste', () => {
    expect(avertir('D:\\Disparu', () => false)).toContain('introuvable')
  })

  it('se tait quand le dossier pilote vraiment le travail', () => {
    expect(avertir('D:\\RIGApplication')).toBeNull()
    expect(avertir(AUTOWIN)).toBeNull()
    expect(avertir(undefined)).toBeNull()
  })
})

describe('dossierDeTravailDuTour', () => {
  const existe = (chemin: string): boolean => chemin.toLowerCase().includes('projet')
  const REPLI = resolve('/depot/autowin')

  it('rend le dossier range sur la conversation quand il existe', () => {
    expect(dossierDeTravailDuTour(resolve('/projet/rig'), REPLI, existe)).toBe(
      resolve('/projet/rig')
    )
  })

  it('retombe sur le repli pour un libelle non absolu', () => {
    expect(dossierDeTravailDuTour('Clients/Amitel', REPLI, existe)).toBe(REPLI)
  })

  it('retombe sur le repli quand le dossier range a disparu', () => {
    expect(dossierDeTravailDuTour(resolve('/disparu'), REPLI, existe)).toBe(REPLI)
  })

  it('retombe sur le repli quand la conversation n est pas rangee', () => {
    expect(dossierDeTravailDuTour(undefined, REPLI, existe)).toBe(REPLI)
    expect(dossierDeTravailDuTour('   ', REPLI, existe)).toBe(REPLI)
  })
})
