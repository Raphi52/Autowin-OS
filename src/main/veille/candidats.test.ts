import { describe, expect, it } from 'vitest'
import {
  CITATION_MINIMUM,
  cleDedup,
  normaliserTitre,
  trierCandidats,
  bornerPertinence,
  type CandidatBrut
} from './candidats'

/**
 * Le tri des candidats de veille, et le mensonge précis qu'il empêche : une feature INVENTÉE.
 *
 * Un modèle à qui on demande ce qu'un concurrent a sorti produit une réponse plausible même sans avoir
 * rien lu. La citation est donc obligatoire, et ces tests vérifient qu'elle l'est vraiment — pas qu'elle
 * est demandée dans un commentaire.
 */

const MAINTENANT = '2026-08-13T00:00:00.000Z'
const CITATION = 'Ajout du support des serveurs MCP distants avec authentification OAuth'

const contexte = {
  maintenant: MAINTENANT,
  redigerPrompt: (c: CandidatBrut) => `Implémente ${c.titre}`
}

const brut = (partiel: Partial<CandidatBrut> = {}): CandidatBrut => ({
  concurrent: 'Codex',
  titre: 'Support MCP distant',
  url: 'https://github.com/openai/codex/releases',
  dateSource: '2026-08-07',
  citation: CITATION,
  type: 'ajout',
  ...partiel
})

describe('un candidat sans preuve n’entre pas', () => {
  it('refuse une citation absente, et le DIT', () => {
    const { retenus, refuses } = trierCandidats(
      [brut({ citation: undefined })],
      new Set(),
      contexte
    )
    expect(retenus).toHaveLength(0)
    // Le refus porte sa raison : une veille qui filtre en silence se lit comme une veille vide.
    expect(refuses).toEqual([{ raison: 'citation manquante', brut: expect.anything() }])
  })

  it('refuse une citation trop courte pour prouver quoi que ce soit', () => {
    // « nouvelle fonctionnalité » se retrouve dans n'importe quelle page : le vérificateur passerait au
    // vert sur un candidat inventé. C'est le trou que ce seuil ferme.
    const courte = 'nouvelle fonctionnalité'
    expect(courte.length).toBeLessThan(CITATION_MINIMUM)
    const { refuses } = trierCandidats([brut({ citation: courte })], new Set(), contexte)
    expect(refuses[0].raison).toBe('citation trop courte')
  })

  it('refuse une URL absente, non http, ou illisible', () => {
    for (const url of [undefined, 'file:///C:/inventé.md', 'data:text/html,x', 'pas une url']) {
      const { retenus, refuses } = trierCandidats([brut({ url })], new Set(), contexte)
      expect(retenus).toHaveLength(0)
      expect(['url manquante', 'url non http(s)']).toContain(refuses[0].raison)
    }
  })

  it('refuse une date absente : l’âge de la nouveauté est l’information utile', () => {
    const { refuses } = trierCandidats([brut({ dateSource: '  ' })], new Set(), contexte)
    expect(refuses[0].raison).toBe('date manquante')
  })

  it('CONSERVE une correction, en la marquant comme telle', () => {
    // Revirement assumé : la première version refusait tout ce qui n'était pas un ajout, ce qui écartait
    // 19 entrées sur 21 dans un seul CHANGELOG. Ce que les concurrents corrigent dit aussi où ils butent,
    // donc l'information est gardée et la séparation se fait à l'affichage.
    const { retenus, refuses } = trierCandidats(
      [brut({ type: 'correction', titre: 'Corrige un crash sur les chemins UNC' })],
      new Set(),
      contexte
    )
    expect(refuses).toHaveLength(0)
    expect(retenus[0].type).toBe('correction')
  })

  it('refuse une nature ABSENTE plutôt que de la deviner', () => {
    // Classer à la place du scout reviendrait à décider d'après un titre — l'à-peu-près qu'on évite.
    const { refuses } = trierCandidats([brut({ type: undefined })], new Set(), contexte)
    expect(refuses[0].raison).toBe('nature non precisee')
  })

  it('range une nature inconnue en `autre`, sans la deviner', () => {
    const { retenus } = trierCandidats([brut({ type: 'amélioration ?' })], new Set(), contexte)
    expect(retenus[0].type).toBe('autre')
  })

  it('accepte un candidat complet, et n’invente aucun champ', () => {
    const { retenus, refuses } = trierCandidats([brut()], new Set(), contexte)
    expect(refuses).toHaveLength(0)
    expect(retenus[0]).toMatchObject({
      concurrent: 'Codex',
      titre: 'Support MCP distant',
      dateSource: '2026-08-07',
      citation: CITATION,
      statut: 'nouveau',
      vuLe: MAINTENANT
    })
    // `langue` n'est pas fournie ici : le champ doit rester ABSENT, pas rempli d'une valeur devinée.
    expect(retenus[0].langue).toBeUndefined()
    expect(retenus[0].prompt).toBe('Implémente Support MCP distant')
  })
})

describe('déduplication d’une passe à l’autre', () => {
  it('ne rend pas deux fois la même entrée dans une même passe', () => {
    const { retenus, refuses } = trierCandidats([brut(), brut()], new Set(), contexte)
    expect(retenus).toHaveLength(1)
    expect(refuses[0].raison).toBe('deja connu')
  })

  it('reconnaît une entrée déjà connue malgré une retouche cosmétique du titre', () => {
    // Les notes de version se réécrivent : majuscule, point final, espace double. Comparer les titres
    // bruts créerait un doublon à chaque retouche.
    const connu = new Set([cleDedup(brut())])
    const { retenus, refuses } = trierCandidats(
      [brut({ titre: '  Support   MCP Distant. ' })],
      connu,
      contexte
    )
    expect(retenus).toHaveLength(0)
    expect(refuses[0].raison).toBe('deja connu')
  })

  it('ne confond PAS deux concurrents qui sortent la même feature', () => {
    // « support MCP » la même semaine chez deux produits, ce sont deux candidats, pas un doublon.
    const { retenus } = trierCandidats(
      [brut(), brut({ concurrent: 'OpenCode', url: 'https://github.com/sst/opencode/releases' })],
      new Set(),
      contexte
    )
    expect(retenus).toHaveLength(2)
  })

  it('ne fond pas deux entrées différentes de la MÊME page', () => {
    // Une page de notes de version porte toutes les versions : l'URL est partagée par ses voisines, donc
    // dédupliquer sur l'URL seule effacerait tout sauf une entrée.
    const { retenus } = trierCandidats(
      [brut(), brut({ titre: 'Reprise après coupure' })],
      new Set(),
      contexte
    )
    expect(retenus).toHaveLength(2)
  })
})

describe('normalisation du titre', () => {
  it('ramène les variantes d’écriture à la même forme', () => {
    expect(normaliserTitre('  Support   MCP Distant. ')).toBe(
      normaliserTitre('support mcp distant')
    )
    expect(normaliserTitre('Reprise (auto) !')).toBe('reprise auto')
  })
})

describe('pertinence — la note du scout, bornee et jamais inventee', () => {
  it('borne une valeur hors 0-100 et arrondit', () => {
    expect(bornerPertinence(150)).toBe(100)
    expect(bornerPertinence(-4)).toBe(0)
    expect(bornerPertinence(72.6)).toBe(73)
    expect(bornerPertinence('88')).toBe(88)
  })

  it('une pertinence absente ou illisible reste undefined — pas un zero', () => {
    expect(bornerPertinence(undefined)).toBeUndefined()
    expect(bornerPertinence('beaucoup')).toBeUndefined()
    expect(bornerPertinence(null)).toBeUndefined()
    expect(bornerPertinence(NaN)).toBeUndefined()
  })

  it('trierCandidats porte la pertinence sur le retenu, bornee', () => {
    const { retenus } = trierCandidats(
      [brut({ pertinence: 250 as unknown as number })],
      new Set(),
      contexte
    )
    expect(retenus[0].pertinence).toBe(100)
  })

  it('un candidat sans pertinence n’en gagne pas une par defaut', () => {
    const { retenus } = trierCandidats([brut()], new Set(), contexte)
    expect(retenus[0].pertinence).toBeUndefined()
  })
})
