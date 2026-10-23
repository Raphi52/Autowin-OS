import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DemandeDeLaCarte } from '../shared/carte-des-besoins'
import type { AzureTicketSource, GitHubTicketSource, TicketItem } from '../shared/tickets'
import { formatTicketReferencePrompt } from '../renderer/src/components/ticket-treatment'
import { TicketProviderError } from './ticket-providers/provider-contract'
import {
  creerLiensWorkItems,
  detacher,
  lierLesDemandesDuFil,
  lireSaisieDeWorkItem,
  rattacherALaMain,
  referencesDuPrompt,
  verifierLesMentions,
  type SourceDesFiches
} from './liens-work-items'

/**
 * LIER UN PROMPT À UN WORK ITEM (option E du cadrage conv-1127, 2026-10-23) : lien automatique
 * quand il est sûr (fil ouvert par la vue Tickets, mention `#1234` lue à la source), rattachement à
 * la main depuis la fiche de la Carte du projet.
 *
 * Les entrées qui font échouer une version fausse : un prompt de la vue Tickets dont le numéro est
 * aussi lu comme mention (doublon) ; des « #1 », « &#1234; », « page#1234 », « #0123 », « #12ab »
 * et du code, qui ne sont PAS des work items ; un numéro inexistant à la source, posé quand même ;
 * une source injoignable qui pose un lien « au cas où » ; une saisie vide, mal typée ou hors bornes
 * qui part au fournisseur ; un lien perdu au redémarrage ; un même numéro lié deux fois ; une
 * mention nue devinée quand plusieurs sources sont configurées.
 */

const AZURE: AzureTicketSource = {
  id: 'azure:contoso:projet:depot',
  label: 'contoso / projet',
  provider: 'azure',
  organization: 'contoso',
  project: 'projet'
}
const GITHUB: GitHubTicketSource = {
  id: 'github:contoso:depot',
  label: 'contoso/depot',
  provider: 'github',
  owner: 'contoso',
  repository: 'depot'
}

const fiche = (id: string, title: string, sourceId = AZURE.id): TicketItem => ({
  id,
  sourceId,
  type: 'Task',
  title,
  state: 'Active',
  url: `https://example.test/${id}`,
  updatedAt: '2026-10-23T10:00:00Z',
  fields: {}
})

/** La source simulée : `connues` existent, `injoignable` fait échouer TOUTE lecture. */
function source(
  connues: Record<string, string>,
  options: { injoignable?: boolean; sources?: SourceDesFiches['sources'] } = {}
) {
  const lireFiche = vi.fn(async (s: { id: string }, id: string): Promise<TicketItem> => {
    if (options.injoignable)
      throw new TicketProviderError('NETWORK_ERROR', 'Fournisseur indisponible.')
    const titre = connues[id]
    if (titre === undefined) throw new Error(`Fiche Azure DevOps ${id} introuvable.`)
    return fiche(id, titre, s.id)
  })
  return { sources: options.sources ?? (() => [AZURE]), lireFiche }
}

const dossierTemporaire = (): string => mkdtempSync(join(tmpdir(), 'liens-work-items-'))

const demande = (rang: number, extra: Partial<DemandeDeLaCarte> = {}): DemandeDeLaCarte => ({
  conversationId: 'conv-1',
  conversationTitre: 'Fil 1',
  rang,
  messageId: `m${rang}`,
  titre: `Demande ${rang}`,
  statut: 'prouve',
  constat: 'npm test → exit 0',
  ...extra
})

describe('références écrites dans un prompt', () => {
  it('un prompt de la vue Tickets donne ses fiches avec leur source, sans doublon de mention', () => {
    const prompt = formatTicketReferencePrompt(
      [fiche('1234', 'Corriger X'), fiche('88', 'Y')],
      AZURE
    )
    expect(referencesDuPrompt(prompt)).toEqual([
      { id: '1234', sourceId: AZURE.id, origine: 'tickets' },
      { id: '88', sourceId: AZURE.id, origine: 'tickets' }
    ])
  })

  it('les mentions #1234 et AB#56 sont des candidats ; un numéro répété ne compte qu’une fois', () => {
    expect(referencesDuPrompt('corrige #1234 puis AB#56, et relis #1234.')).toEqual([
      { id: '1234', origine: 'mention' },
      { id: '56', origine: 'mention', azure: true }
    ])
  })

  it('ni ordinal, ni entité HTML, ni ancre, ni zéro en tête, ni code ne sont des work items', () => {
    const texte = [
      'prends la #1 et la #2',
      'le caractère &#1234; et la page#4321',
      'le numéro #0123 et la couleur #12ab',
      'le code `#4567` et :',
      '```css',
      '.a { color: #7890; }',
      '```'
    ].join('\n')
    expect(referencesDuPrompt(texte)).toEqual([])
  })
})

describe('saisie d’un numéro de work item', () => {
  it.each([
    ['', 'vide'],
    ['   ', 'vide'],
    ['abc', 'numéro'],
    ['#12a', 'numéro'],
    ['https://dev.azure.com/contoso/projet/_workitems/edit/12', 'numéro'],
    ['0', 'positif'],
    ['-5', 'numéro'],
    ['99999999999', 'trop grand'],
    [42, 'numéro']
  ])('« %s » est refusé (%s)', (saisie, motif) => {
    const lu = lireSaisieDeWorkItem(saisie)
    expect(lu.ok).toBe(false)
    if (!lu.ok) expect(lu.raison.toLowerCase()).toContain(motif)
  })

  it.each([
    ['1234', '1234'],
    [' #1234 ', '1234'],
    ['AB#1234', '1234'],
    ['WI 1234', '1234']
  ])('« %s » donne %s', (saisie, id) => {
    expect(lireSaisieDeWorkItem(saisie)).toEqual({ ok: true, id })
  })
})

describe('rattacher à la main', () => {
  it('le lien est relu après un redémarrage, avec le titre recopié de la source', async () => {
    const racine = dossierTemporaire()
    const liens = creerLiensWorkItems({ racine, maintenant: () => 1_000 })
    const s = source({ '1234': 'Corriger X' })
    const resultat = await rattacherALaMain(
      { ...s, etat: liens.lire(), ajouter: liens.ajouter },
      { conversationId: 'conv-1', demande: 'm1', saisie: '#1234' }
    )
    expect(resultat).toEqual({
      ok: true,
      workItem: {
        sourceId: AZURE.id,
        id: '1234',
        titre: 'Corriger X',
        type: 'Task',
        origine: 'manuel'
      }
    })

    // « Redémarrage » : un nouveau magasin, sans mémoire, relit le fichier.
    const relu = creerLiensWorkItems({ racine }).lire()
    const [liee] = lierLesDemandesDuFil('conv-1', [demande(1)], relu)
    expect(liee.workItems).toEqual([
      { sourceId: AZURE.id, id: '1234', titre: 'Corriger X', type: 'Task', origine: 'manuel' }
    ])
  })

  it('un numéro inexistant à la source est refusé et rien n’est écrit', async () => {
    const racine = dossierTemporaire()
    const liens = creerLiensWorkItems({ racine })
    const resultat = await rattacherALaMain(
      { ...source({}), etat: liens.lire(), ajouter: liens.ajouter },
      { conversationId: 'conv-1', demande: 'm1', saisie: '999' }
    )
    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.raison).toContain('n’existe pas')
    expect(lierLesDemandesDuFil('conv-1', [demande(1)], liens.lire())[0].workItems).toBeUndefined()
  })

  it('une source injoignable refuse le lien au lieu de le poser « au cas où »', async () => {
    const racine = dossierTemporaire()
    const liens = creerLiensWorkItems({ racine })
    const resultat = await rattacherALaMain(
      {
        ...source({ '1234': 'X' }, { injoignable: true }),
        etat: liens.lire(),
        ajouter: liens.ajouter
      },
      { conversationId: 'conv-1', demande: 'm1', saisie: '1234' }
    )
    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.raison).toContain('injoignable')
    expect(existsSync(liens.chemin)).toBe(false)
  })

  it('une saisie vide ou mal typée ne part jamais au fournisseur', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const s = source({ '1234': 'X' })
    for (const saisie of ['', 'abc', '0']) {
      const r = await rattacherALaMain(
        { ...s, etat: liens.lire(), ajouter: liens.ajouter },
        { conversationId: 'conv-1', demande: 'm1', saisie }
      )
      expect(r.ok).toBe(false)
    }
    expect(s.lireFiche).not.toHaveBeenCalled()
  })

  it('le même numéro lié deux fois ne donne qu’un lien', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const s = source({ '1234': 'X' })
    for (let i = 0; i < 2; i += 1)
      await rattacherALaMain(
        { ...s, etat: liens.lire(), ajouter: liens.ajouter },
        { conversationId: 'conv-1', demande: 'm1', saisie: '1234' }
      )
    expect(lierLesDemandesDuFil('conv-1', [demande(1)], liens.lire())[0].workItems).toHaveLength(1)
    const lignes = readFileSync(liens.chemin, 'utf8').trim().split('\n')
    expect(lignes.filter((l) => l.includes('"action":"lier"'))).toHaveLength(1)
  })

  it('plusieurs sources sans précision : refus, on ne devine pas le projet', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const s = source({ '1234': 'X' }, { sources: () => [AZURE, GITHUB] })
    const r = await rattacherALaMain(
      { ...s, etat: liens.lire(), ajouter: liens.ajouter },
      { conversationId: 'conv-1', demande: 'm1', saisie: '1234' }
    )
    expect(r.ok).toBe(false)
    expect(s.lireFiche).not.toHaveBeenCalled()
  })

  it('détacher retire le lien, y compris après relecture', async () => {
    const racine = dossierTemporaire()
    const liens = creerLiensWorkItems({ racine })
    await rattacherALaMain(
      { ...source({ '1234': 'X' }), etat: liens.lire(), ajouter: liens.ajouter },
      { conversationId: 'conv-1', demande: 'm1', saisie: '1234' }
    )
    expect(
      detacher(
        { ajouter: liens.ajouter },
        { conversationId: 'conv-1', demande: 'm1', sourceId: AZURE.id, id: '1234' }
      )
    ).toEqual({ ok: true })
    const relu = creerLiensWorkItems({ racine }).lire()
    expect(lierLesDemandesDuFil('conv-1', [demande(1)], relu)[0].workItems).toBeUndefined()
  })
})

describe('lien automatique', () => {
  it('un fil ouvert par la vue Tickets est lié sans geste ; le titre vient de la source une fois lue', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const ouverte = demande(0, {
      references: [{ id: '1234', sourceId: AZURE.id, origine: 'tickets' }]
    })
    expect(lierLesDemandesDuFil('conv-1', [ouverte], liens.lire())[0].workItems).toEqual([
      { sourceId: AZURE.id, id: '1234', origine: 'tickets' }
    ])
    const bilan = await verifierLesMentions(
      { ...source({ '1234': 'Corriger X' }), etat: liens.lire(), ajouter: liens.ajouter },
      [ouverte]
    )
    expect(bilan.lues).toBe(1)
    expect(lierLesDemandesDuFil('conv-1', [ouverte], liens.lire())[0].workItems).toEqual([
      { sourceId: AZURE.id, id: '1234', titre: 'Corriger X', type: 'Task', origine: 'tickets' }
    ])
  })

  it('un lien de la vue Tickets détaché à la main ne revient pas', () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    detacher(
      { ajouter: liens.ajouter },
      { conversationId: 'conv-1', demande: 'm0', sourceId: AZURE.id, id: '1234' }
    )
    const ouverte = demande(0, {
      references: [{ id: '1234', sourceId: AZURE.id, origine: 'tickets' }]
    })
    expect(lierLesDemandesDuFil('conv-1', [ouverte], liens.lire())[0].workItems).toBeUndefined()
  })

  it('une mention devient un lien seulement si la fiche existe ; l’inexistante n’est pas relue', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const d = demande(1, {
      references: [
        { id: '1234', origine: 'mention' },
        { id: '999', origine: 'mention' }
      ]
    })
    expect(lierLesDemandesDuFil('conv-1', [d], liens.lire())[0].workItems).toBeUndefined()
    const s = source({ '1234': 'Corriger X' })
    const bilan = await verifierLesMentions({ ...s, etat: liens.lire(), ajouter: liens.ajouter }, [
      d
    ])
    expect(bilan).toMatchObject({ lues: 2, liees: 1, introuvables: 1, injoignable: false })
    expect(lierLesDemandesDuFil('conv-1', [d], liens.lire())[0].workItems).toEqual([
      { sourceId: AZURE.id, id: '1234', titre: 'Corriger X', type: 'Task', origine: 'mention' }
    ])
    const deuxieme = await verifierLesMentions(
      { ...s, etat: liens.lire(), ajouter: liens.ajouter },
      [d]
    )
    expect(deuxieme.lues).toBe(0)
    expect(s.lireFiche).toHaveBeenCalledTimes(2)
  })

  it('source injoignable : la passe s’arrête et ne pose rien', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const d = demande(1, { references: [{ id: '1234', origine: 'mention' }] })
    const bilan = await verifierLesMentions(
      {
        ...source({ '1234': 'X' }, { injoignable: true }),
        etat: liens.lire(),
        ajouter: liens.ajouter
      },
      [d]
    )
    // Aucune réponse de la source : rien n'est compté comme lu (la vue ne recalcule pas pour rien).
    expect(bilan).toMatchObject({ lues: 0, liees: 0, injoignable: true, restantes: 1 })
    expect(lierLesDemandesDuFil('conv-1', [d], liens.lire())[0].workItems).toBeUndefined()
  })

  it('plusieurs sources : une mention nue n’est pas devinée, AB# va à la seule source Azure', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const s = source({ '12': 'Azure 12', '34': 'Azure 34' }, { sources: () => [AZURE, GITHUB] })
    const d = demande(1, {
      references: [
        { id: '12', origine: 'mention' },
        { id: '34', origine: 'mention', azure: true }
      ]
    })
    await verifierLesMentions({ ...s, etat: liens.lire(), ajouter: liens.ajouter }, [d])
    expect(s.lireFiche).toHaveBeenCalledTimes(1)
    expect(lierLesDemandesDuFil('conv-1', [d], liens.lire())[0].workItems).toEqual([
      { sourceId: AZURE.id, id: '34', titre: 'Azure 34', type: 'Task', origine: 'mention' }
    ])
  })

  it('le plafond par passe laisse le reste à la suivante', async () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const d = demande(1, {
      references: ['101', '102', '103'].map((id) => ({ id, origine: 'mention' as const }))
    })
    const bilan = await verifierLesMentions(
      {
        ...source({ '101': 'a', '102': 'b', '103': 'c' }),
        etat: liens.lire(),
        ajouter: liens.ajouter,
        plafond: 2
      },
      [d]
    )
    expect(bilan).toMatchObject({ lues: 2, restantes: 1 })
  })
})

describe('demande qui poursuit la précédente', () => {
  it('une demande « suite » sans lien reprend celui de la précédente, marqué hérité', () => {
    const liens = creerLiensWorkItems({ racine: dossierTemporaire() })
    const demandes = [
      demande(0, { references: [{ id: '1234', sourceId: AZURE.id, origine: 'tickets' }] }),
      demande(2, { besoin: { nature: 'suite' } }),
      demande(4, { besoin: { nature: 'nouveau' } })
    ]
    const [, suite, nouvelle] = lierLesDemandesDuFil('conv-1', demandes, liens.lire())
    expect(suite.workItems).toEqual([
      { sourceId: AZURE.id, id: '1234', origine: 'tickets', herite: true }
    ])
    expect(nouvelle.workItems).toBeUndefined()
  })
})
