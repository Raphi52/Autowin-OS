import { describe, expect, it } from 'vitest'
import { rangerConversationSurLePremierMessage } from './rangement-premier-message'

/**
 * EXECUTION REELLE, pas lecture du texte de index.ts : on JOUE la decision avec un faux store et on
 * verifie l'EFFET (le dossier applique + le message ecrit dans le fil). Un bug d'execution echoue
 * ici, la ou un test textuel passait.
 */
const AUTOWIN = 'D:\\AutoWinOS'
const AUTRE = 'D:\\BrainRotRoyale'

async function harnais(
  conversation: Parameters<typeof rangerConversationSurLePremierMessage>[0]['conversation'],
  extra: Partial<Parameters<typeof rangerConversationSurLePremierMessage>[0]> = {}
) {
  const ranges: string[] = []
  const annonces: string[] = []
  const applique = await rangerConversationSurLePremierMessage({
    conversation,
    dossiersConnus: [AUTOWIN, AUTRE],
    dossierActif: AUTRE,
    existe: () => true,
    ranger: (chemin) => ranges.push(chemin),
    annoncer: (message) => annonces.push(message),
    ...extra
  })
  return { applique, ranges, annonces }
}

const premierMessage = (contenu: string) => ({ messages: [{ role: 'user', content: contenu }] })

describe('rangement au premier message — effet reel', () => {
  it('range la conversation dans le projet nomme et ecrit sa decision dans le fil', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin se parasitent"))
    expect(r.applique).toBe(AUTOWIN)
    expect(r.ranges).toEqual([AUTOWIN])
    expect(r.annonces).toHaveLength(1)
    expect(r.annonces[0]).toContain(AUTOWIN)
    expect(r.annonces[0]).toContain('change-le dans la liste des conversations')
  })

  it('ne touche a rien quand la conversation est deja rangee', async () => {
    const r = await harnais({
      projectPath: AUTRE,
      ...premierMessage("les bureaux virtuels d'Autowin")
    })
    expect(r.applique).toBeNull()
    expect(r.ranges).toEqual([])
    expect(r.annonces).toEqual([])
  })

  it('ne touche a rien quand une categorie a ete posee a la main', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      categorie: 'Perso'
    })
    expect(r.applique).toBeNull()
    expect(r.ranges).toEqual([])
  })

  it('ne range plus au-dela du premier message de l utilisateur', async () => {
    const r = await harnais({
      messages: [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'oui' },
        { role: 'user', content: "les bureaux virtuels d'Autowin" }
      ]
    })
    expect(r.applique).toBeNull()
    expect(r.ranges).toEqual([])
  })

  it('ne range pas quand le message ne nomme aucun projet connu', async () => {
    const r = await harnais(premierMessage('corrige ce bug de build stp'))
    expect(r.applique).toBeNull()
    expect(r.annonces).toEqual([])
  })

  /*
   * LE RANGEMENT TOURNE A COTE DE LA REPONSE (conv-867, 2026-09-26) : le tour ne l'attend plus.
   * Seul un rangement qui DEPLACE le dossier de travail attend la fin du tour — un tour a cheval
   * sur deux depots serait pire qu'un tour dans l'ancien.
   */
  it('attend la fin du tour avant de deplacer le dossier de travail', async () => {
    let finirTour!: () => void
    const finDuTour = new Promise<void>((resolve) => {
      finirTour = resolve
    })
    const ranges: string[] = []
    const annonces: string[] = []
    const enCours = rangerConversationSurLePremierMessage({
      conversation: premierMessage("les bureaux virtuels d'Autowin se parasitent"),
      dossiersConnus: [AUTOWIN, AUTRE],
      dossierActif: AUTRE,
      existe: () => true,
      finDuTour,
      ranger: (chemin) => ranges.push(chemin),
      annoncer: (message) => annonces.push(message)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    // LE CAS : la reponse tourne encore dans AUTRE, rien ne doit la deplacer.
    expect(ranges).toEqual([])
    expect(annonces).toEqual([])

    finirTour()
    await expect(enCours).resolves.toBe(AUTOWIN)
    expect(ranges).toEqual([AUTOWIN])
    expect(annonces[0]).toContain(`cette première réponse a travaillé dans ${AUTRE}`)
    expect(annonces[0]).toContain('tes prochains messages y travailleront')
  })

  it('range une categorie sans attendre la fin du tour', async () => {
    const tourSansFin = new Promise<void>(() => {})
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      categoriesConnues: ['Autowin OS'],
      finDuTour: tourSansFin,
      demanderAuModele: async () =>
        JSON.stringify({ rangement: 'Autowin OS', confiance: 0.95, motif: 'bureaux virtuels' })
    })
    expect(r.applique).toBe('Autowin OS')
    expect(r.ranges).toEqual(['Autowin OS'])
    expect(r.annonces[0]).toContain('Le dossier de travail ne change pas')
  })

  it('range le dossier deja actif sans attendre la fin du tour', async () => {
    const tourSansFin = new Promise<void>(() => {})
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      dossierActif: AUTOWIN,
      finDuTour: tourSansFin,
      demanderAuModele: async () =>
        JSON.stringify({ rangement: AUTOWIN, confiance: 0.95, motif: 'bureaux virtuels' })
    })
    expect(r.applique).toBe(AUTOWIN)
    expect(r.annonces[0]).toContain("n'était rangée nulle part")
  })

  it('n ecrase pas un rangement pose pendant l appel au modele', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      toujoursNonRangee: () => false
    })
    expect(r.applique).toBeNull()
    expect(r.ranges).toEqual([])
    expect(r.annonces).toEqual([])
  })

  it('laisse le tour partir si le store refuse le rangement', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      ranger: () => {
        throw new Error('store indisponible')
      }
    })
    expect(r.applique).toBeNull()
  })
})
