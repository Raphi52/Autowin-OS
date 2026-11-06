import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  avertissementDossierConversation,
  diagnostiqueDossierConversation,
  dossierDeLectureDuFil,
  dossierDeTravailDuTour,
  DossierRangeDisparuError,
  refusDossierDuTour,
  refuserTourSiDossierDisparu
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
    expect(diagnostiqueDossierConversation('D:\\CONTOSOApplication', AUTOWIN, existe)).toBe(
      'bascule-requise'
    )
    expect(diagnostiqueDossierConversation(AUTOWIN, AUTOWIN, existe)).toBe('deja-aligne')
    expect(diagnostiqueDossierConversation(undefined, AUTOWIN, existe)).toBe('non-range')
    expect(diagnostiqueDossierConversation('Clients/Acme', AUTOWIN, existe)).toBe(
      'libelle-non-absolu'
    )
    expect(diagnostiqueDossierConversation('D:\\Disparu', AUTOWIN, () => false)).toBe(
      'dossier-absent'
    )
  })

  /** LE defaut a rendre visible : un libelle laisse le modele dans le depot d'Autowin, en silence. */
  it('avertit sur un libelle de rangement, en citant le dossier reellement utilise', () => {
    const texte = avertir('Clients/Acme')
    expect(texte).toContain('Clients/Acme')
    expect(texte).toContain(AUTOWIN)
  })

  it('avertit sur un dossier disparu du poste', () => {
    expect(avertir('D:\\Disparu', () => false)).toContain('introuvable')
  })

  it('se tait quand le dossier pilote vraiment le travail', () => {
    expect(avertir('D:\\CONTOSOApplication')).toBeNull()
    expect(avertir(AUTOWIN)).toBeNull()
    expect(avertir(undefined)).toBeNull()
  })
})

describe('dossierDeTravailDuTour', () => {
  const existe = (chemin: string): boolean => chemin.toLowerCase().includes('projet')
  const REPLI = resolve('/depot/autowin')

  it('rend le dossier range sur la conversation quand il existe', () => {
    expect(dossierDeTravailDuTour(resolve('/projet/contoso'), REPLI, existe)).toBe(
      resolve('/projet/contoso')
    )
  })

  it('retombe sur le repli pour un libelle non absolu', () => {
    expect(dossierDeTravailDuTour('Clients/Acme', REPLI, existe)).toBe(REPLI)
  })

  it('refuse le tour quand le dossier range a disparu, au lieu de se replier sur le depot partage', () => {
    const disparu = resolve('/disparu')
    let refus: unknown
    try {
      dossierDeTravailDuTour(disparu, REPLI, existe)
    } catch (erreur) {
      refus = erreur
    }
    expect(refus).toBeInstanceOf(DossierRangeDisparuError)
    const raison = (refus as DossierRangeDisparuError).message
    expect(raison).toContain(disparu)
    expect(raison).toContain('disparu')
    expect(raison).toContain('un autre dossier')
    expect(raison).not.toContain(REPLI)
    expect((refus as DossierRangeDisparuError).dossierRange).toBe(disparu)
  })

  it('la lecture sans tour garde le repli quand le dossier range a disparu', () => {
    expect(dossierDeLectureDuFil(resolve('/disparu'), REPLI, existe)).toBe(REPLI)
    expect(dossierDeLectureDuFil(resolve('/projet/x'), REPLI, existe)).toBe(resolve('/projet/x'))
  })

  it('refusDossierDuTour : la raison seulement pour un dossier range disparu', () => {
    expect(refusDossierDuTour(resolve('/disparu'), existe)).toContain('disparu')
    expect(refusDossierDuTour(resolve('/projet/x'), existe)).toBeNull()
    expect(refusDossierDuTour('Clients/Acme', existe)).toBeNull()
    expect(refusDossierDuTour(undefined, existe)).toBeNull()
  })

  it('retombe sur le repli quand la conversation n est pas rangee', () => {
    expect(dossierDeTravailDuTour(undefined, REPLI, existe)).toBe(REPLI)
    expect(dossierDeTravailDuTour('   ', REPLI, existe)).toBe(REPLI)
  })
})

describe('refuserTourSiDossierDisparu (entrée des tours)', () => {
  const absent = (): boolean => false
  const present = (): boolean => true

  it('écrit la raison dans le fil puis lève : le tour ne part pas', () => {
    const ecrit: string[] = []
    const chemin = resolve('/copies/fil-perdu')
    expect(() => refuserTourSiDossierDisparu(chemin, (r) => ecrit.push(r), absent)).toThrow(
      chemin
    )
    expect(ecrit).toHaveLength(1)
    expect(ecrit[0]).toContain(chemin)
  })

  it('lève même si l écriture dans le fil échoue', () => {
    expect(() =>
      refuserTourSiDossierDisparu(
        resolve('/copies/x'),
        () => {
          throw new Error('disque plein')
        },
        absent
      )
    ).toThrow(/x/)
  })

  it('jumeau : dossier présent ou fil sans dossier rangé → rien, rien écrit', () => {
    const ecrit: string[] = []
    refuserTourSiDossierDisparu(resolve('/copies/ok'), (r) => ecrit.push(r), present)
    refuserTourSiDossierDisparu(undefined, (r) => ecrit.push(r), absent)
    expect(ecrit).toEqual([])
  })
})
