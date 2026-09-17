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
    const r = await harnais({ projectPath: AUTRE, ...premierMessage("les bureaux virtuels d'Autowin") })
    expect(r.applique).toBeNull()
    expect(r.ranges).toEqual([])
    expect(r.annonces).toEqual([])
  })

  it('ne touche a rien quand une categorie a ete posee a la main', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), { categorie: 'Perso' })
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

  it('laisse le tour partir si le store refuse le rangement', async () => {
    const r = await harnais(premierMessage("les bureaux virtuels d'Autowin"), {
      ranger: () => {
        throw new Error('store indisponible')
      }
    })
    expect(r.applique).toBeNull()
  })
})
