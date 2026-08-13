import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lireStockVeille } from './candidats-store'
import {
  construirePromptScout,
  executerPasse,
  extraireCandidats,
  redigerPromptCandidat
} from './passe'
import type { SourceVeille } from './sources'

/**
 * Une passe de veille, et les quatre façons dont elle pourrait rendre du plausible.
 *
 * Le scout est injecté : ces tests ne touchent pas le réseau. Ce qu'ils vérifient est le CONTRÔLE en
 * aval — parce qu'une consigne dans un prompt se contourne, alors qu'un tri qui refuse ne se contourne pas.
 */

const racines: string[] = []
afterEach(() => {
  for (const d of racines.splice(0)) rmSync(d, { recursive: true, force: true })
})
const chemin = (): string => {
  const dossier = mkdtempSync(join(tmpdir(), 'autowin-passe-'))
  racines.push(dossier)
  return join(dossier, 'veille-candidats.json')
}

const SOURCE: SourceVeille = { concurrent: 'Codex', url: 'https://exemple.test/releases' }
const CITATION = 'Ajout du support des serveurs MCP distants avec authentification OAuth'
const MAINTENANT = '2026-08-13T00:00:00.000Z'

const jsonScout = (entrees: unknown[]): string => JSON.stringify(entrees)

describe('le prompt du scout', () => {
  const prompt = construirePromptScout(SOURCE)

  it('donne l’URL à lire : le scout ne choisit pas où chercher', () => {
    expect(prompt).toContain(SOURCE.url)
    expect(prompt).toContain(SOURCE.concurrent)
  })

  it('exige une citation verbatim et annonce qu’elle sera VÉRIFIÉE', () => {
    // Annoncer la vérification change le comportement d'un agent bien plus qu'une consigne vague.
    expect(prompt).toMatch(/MOT POUR MOT/)
    expect(prompt).toMatch(/40 caractères/)
    expect(prompt).toMatch(/vérifiée en récupérant l’URL/)
  })

  it('donne une sortie vide comme issue légitime', () => {
    // Sans cette porte, un agent qui n'a rien trouvé produit quelque chose pour ne pas rendre vide.
    expect(prompt).toMatch(/réponds exactement : \[\]/)
  })

  it('interdit de deviner une date', () => {
    expect(prompt).toMatch(/Ne devine JAMAIS une date/)
  })
})

describe('extraction de la sortie', () => {
  it('tolère du bavardage autour du JSON', () => {
    const sortie = `Voici ce que j'ai lu :\n${jsonScout([{ titre: 'A' }])}\nJ'espère que ça aide.`
    expect(extraireCandidats(sortie)).toEqual([{ titre: 'A' }])
  })

  it('ne RÉPARE pas un JSON cassé : illisible rend undefined', () => {
    // Deviner ce qu'un agent a voulu écrire serait la première marche vers l'invention.
    expect(extraireCandidats('[{"titre": "A", ')).toBeUndefined()
    expect(extraireCandidats('aucun tableau ici')).toBeUndefined()
  })

  it('rend un tableau vide pour une page sans nouveauté', () => {
    expect(extraireCandidats('[]')).toEqual([])
  })
})

describe('une passe complète', () => {
  it('retient un candidat complet et écrit le stock', async () => {
    const p = chemin()
    const res = await executerPasse({
      chemin: p,
      sources: [SOURCE],
      maintenant: () => MAINTENANT,
      lancerScout: async () =>
        jsonScout([
          {
            titre: 'Support MCP distant',
            dateSource: '2026-08-07',
            citation: CITATION,
            langue: 'en'
          }
        ])
    })
    expect(res.retenus).toBe(1)
    expect(res.echecs).toHaveLength(0)
    const relu = lireStockVeille(p)
    expect(relu.candidats[0]).toMatchObject({
      concurrent: 'Codex',
      url: SOURCE.url,
      citation: CITATION,
      langue: 'en'
    })
    // Le prompt proposé porte la source : c'est dessus que l'utilisateur cliquera.
    expect(relu.candidats[0].prompt).toContain(SOURCE.url)
  })

  it('refuse une entrée sans citation, et le compte comme refus NOMMÉ', async () => {
    const res = await executerPasse({
      chemin: chemin(),
      sources: [SOURCE],
      maintenant: () => MAINTENANT,
      lancerScout: async () => jsonScout([{ titre: 'Inventé', dateSource: '2026-08-07' }])
    })
    expect(res.retenus).toBe(0)
    expect(res.refuses[0].raison).toBe('citation manquante')
  })

  it('un scout qui ÉCHOUE laisse une trace, il ne disparaît pas', async () => {
    const res = await executerPasse({
      chemin: chemin(),
      sources: [SOURCE],
      maintenant: () => MAINTENANT,
      lancerScout: async () => {
        throw new Error('HTTP 404')
      }
    })
    expect(res.retenus).toBe(0)
    // LE point : zéro candidat AVEC un échec affiché ne se lit pas comme « rien de neuf ».
    expect(res.echecs).toEqual([
      { concurrent: 'Codex', url: SOURCE.url, detail: 'HTTP 404', vuLe: MAINTENANT }
    ])
  })

  it('une sortie illisible devient un échec, pas un silence', async () => {
    const res = await executerPasse({
      chemin: chemin(),
      sources: [SOURCE],
      maintenant: () => MAINTENANT,
      lancerScout: async () => 'je pense que Codex a sorti plein de choses'
    })
    expect(res.echecs[0].detail).toMatch(/illisible/)
  })

  it('un scout qui tombe n’empêche pas les AUTRES de rendre', async () => {
    const autre: SourceVeille = { concurrent: 'OpenCode', url: 'https://autre.test/releases' }
    const res = await executerPasse({
      chemin: chemin(),
      sources: [SOURCE, autre],
      maintenant: () => MAINTENANT,
      lancerScout: async (source) => {
        if (source.concurrent === 'Codex') throw new Error('injoignable')
        return jsonScout([{ titre: 'Reprise auto', dateSource: '2026-08-13', citation: CITATION }])
      }
    })
    expect(res.retenus).toBe(1)
    expect(res.echecs).toHaveLength(1)
    expect(res.stock.candidats[0].concurrent).toBe('OpenCode')
  })

  it('rattache le candidat à la SOURCE, pas au produit que le scout annonce', async () => {
    // Un scout ne doit pas pouvoir rattacher une trouvaille à un produit qu'on ne lui a pas donné :
    // sinon une seule page pourrait « rapporter » des nouveautés sur tous les concurrents.
    const res = await executerPasse({
      chemin: chemin(),
      sources: [SOURCE],
      maintenant: () => MAINTENANT,
      lancerScout: async () =>
        jsonScout([
          {
            concurrent: 'Kimi',
            titre: 'Support MCP distant',
            dateSource: '2026-08-07',
            citation: CITATION
          }
        ])
    })
    expect(res.stock.candidats[0].concurrent).toBe('Codex')
  })

  it('deux passes sur la même page ne créent pas deux candidats', async () => {
    const p = chemin()
    const lancerScout = async (): Promise<string> =>
      jsonScout([{ titre: 'Support MCP distant', dateSource: '2026-08-07', citation: CITATION }])
    await executerPasse({ chemin: p, sources: [SOURCE], maintenant: () => MAINTENANT, lancerScout })
    const seconde = await executerPasse({
      chemin: p,
      sources: [SOURCE],
      maintenant: () => '2026-08-14T00:00:00.000Z',
      lancerScout
    })
    expect(seconde.retenus).toBe(0)
    expect(lireStockVeille(p).candidats).toHaveLength(1)
  })
})

describe('le prompt proposé à l’utilisateur', () => {
  it('porte la source, la date et l’extrait lu', () => {
    const prompt = redigerPromptCandidat({
      concurrent: 'Codex',
      titre: 'Support MCP distant',
      url: SOURCE.url,
      dateSource: '2026-08-07',
      citation: CITATION
    })
    expect(prompt).toContain(SOURCE.url)
    expect(prompt).toContain('2026-08-07')
    expect(prompt).toContain(CITATION)
  })

  it('demande d’abord de vérifier si Autowin le fait DÉJÀ', () => {
    // Sans ça, la liste proposera d'implémenter ce qui existe. C'est un des angles morts du cadrage.
    const prompt = redigerPromptCandidat({ concurrent: 'X', titre: 'T', url: 'u', citation: 'c' })
    expect(prompt).toMatch(/déjà couvert|fait déjà/)
  })
})
