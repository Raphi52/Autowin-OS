import { describe, expect, it } from 'vitest'
import {
  NOM_SERVEUR_MCP,
  demarrerServeurOutilsNoeudSkill,
  outilsPublies,
  schemaEntree,
  traiterMessageMcp,
  issueMetier,
  porteLesOutilsNatifs,
  type AppelMcpObserve
} from './skill-node-mcp'
import type { LanceurCommandeSkill, SpecCommandeSkill } from './skill-node-tools'

/** Les specs REELLES des deux commandes, recopiees de `commands.ts` (arguments compris). */
const SPECS: SpecCommandeSkill[] = [
  {
    name: 'brain_query',
    description: 'Interroger le savoir curé du Brain',
    args: { question: 'la question, en langage naturel' }
  },
  {
    name: 'remember',
    description: 'Retenir un fait',
    args: {
      title: 'titre court',
      fact: 'le fait',
      type: 'lesson|decision|preference|domain',
      scope: 'périmètre',
      source: 'source vérifiable',
      tags: 'facultatif — mots-clés'
    }
  },
  {
    name: 'orchestrate',
    description: 'Lancer un run',
    args: { task: 'la tâche' }
  }
]

function lanceur(
  exec: LanceurCommandeSkill['exec'] = async () => ({ ok: true, data: 'ok' })
): LanceurCommandeSkill {
  return { exec, catalogue: () => SPECS }
}

describe('publication des outils', () => {
  it('ne publie QUE la liste blanche — `orchestrate` est absent du catalogue servi', () => {
    const noms = outilsPublies(lanceur()).map((o) => o.name)
    expect(noms).toEqual(['brain_query', 'remember'])
    expect(noms).not.toContain('orchestrate')
  })

  it('copie le nom EXACT des arguments depuis la spec (le défaut de conv-1339)', () => {
    const brain = outilsPublies(lanceur()).find((o) => o.name === 'brain_query')
    // `question`, PAS `query` : c'est l'écart qui rendait l'outil inutilisable.
    expect(Object.keys(brain!.inputSchema.properties)).toEqual(['question'])
    expect(brain!.inputSchema.required).toEqual(['question'])
  })

  it('exige scope et source, et laisse tags optionnel', () => {
    const r = outilsPublies(lanceur()).find((o) => o.name === 'remember')!
    expect(r.inputSchema.required).toContain('scope')
    expect(r.inputSchema.required).toContain('source')
    expect(r.inputSchema.required).not.toContain('tags')
  })

  it("un argument marqué facultatif n'est jamais exigé", () => {
    const s = schemaEntree({ a: 'obligatoire', b: 'facultatif — au choix' })
    expect(s.required).toEqual(['a'])
  })

  it('expose les noms tels que le CLI les verra', async () => {
    const serveur = await demarrerServeurOutilsNoeudSkill(lanceur())
    try {
      expect(serveur.nomsExposes()).toEqual([
        `mcp__${NOM_SERVEUR_MCP}__brain_query`,
        `mcp__${NOM_SERVEUR_MCP}__remember`
      ])
    } finally {
      await serveur.arreter()
    }
  })
})

describe('appel d’outil', () => {
  it('exécute une commande autorisée et rend son résultat', async () => {
    const vus: Array<{ name: string; args: unknown }> = []
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 1,
        params: { name: 'brain_query', arguments: { question: 'x' } }
      },
      lanceur(async (name, args) => {
        vus.push({ name, args })
        return { ok: true, data: 'le savoir' }
      })
    )
    expect(vus).toEqual([{ name: 'brain_query', args: { question: 'x' } }])
    const r = (rep.corps as { result: { content: Array<{ text: string }>; isError: boolean } })
      .result
    expect(r.content[0]!.text).toBe('le savoir')
    expect(r.isError).toBe(false)
  })

  it('REFUSE `orchestrate` sans jamais toucher au bus — et le dit', async () => {
    let touche = false
    const observe: AppelMcpObserve[] = []
    const rep = await traiterMessageMcp(
      { method: 'tools/call', id: 2, params: { name: 'orchestrate', arguments: { task: 'tout' } } },
      lanceur(async () => {
        touche = true
        return { ok: true }
      }),
      (a) => observe.push(a)
    )
    expect(touche).toBe(false)
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(r.content[0]!.text).toContain('REFUSÉ')
    expect(r.content[0]!.text).toContain('orchestrate')
    expect(observe).toEqual([{ outil: 'orchestrate', refuse: true, ok: false }])
  })

  it('un outil en ÉCHEC rend une erreur lisible, jamais une requête qui pend', async () => {
    const rep = await traiterMessageMcp(
      { method: 'tools/call', id: 3, params: { name: 'remember', arguments: {} } },
      lanceur(async () => ({ ok: false, error: 'scope manquant' }))
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }>; isError: boolean } })
      .result
    expect(r.content[0]!.text).toContain('scope manquant')
    expect(r.isError).toBe(true)
    expect(rep.statut).toBe(200)
  })

  it('un outil qui JETTE ne casse pas la réponse', async () => {
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 4,
        params: { name: 'brain_query', arguments: { question: 'x' } }
      },
      lanceur(async () => {
        throw new Error('brain injoignable')
      })
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(r.content[0]!.text).toContain('brain injoignable')
    expect(rep.statut).toBe(200)
  })

  it('borne un résultat généreux au lieu de noyer le contexte', async () => {
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 5,
        params: { name: 'brain_query', arguments: { question: 'x' } }
      },
      lanceur(async () => ({ ok: true, data: 'z'.repeat(10_000) }))
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(r.content[0]!.text.length).toBeLessThan(4_100)
    expect(r.content[0]!.text.endsWith('…')).toBe(true)
  })

  it('une notification (sans id) ne rend aucun corps', async () => {
    const rep = await traiterMessageMcp({ method: 'notifications/initialized' }, lanceur())
    expect(rep.statut).toBe(202)
    expect(rep.corps).toBeUndefined()
  })
})

describe('transport', () => {
  const poster = async (
    url: string,
    corps: unknown,
    jeton?: string
  ): Promise<{ statut: number; texte: string }> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jeton ? { 'X-Autowin-Token': jeton } : {})
      },
      body: JSON.stringify(corps)
    })
    return { statut: res.status, texte: await res.text() }
  }

  it('sert tools/list sur le port ouvert, et refuse sans le jeton', async () => {
    const serveur = await demarrerServeurOutilsNoeudSkill(lanceur())
    try {
      expect(serveur.port).toBeGreaterThan(0)
      const sansJeton = await poster(serveur.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect(sansJeton.statut).toBe(401)

      const avec = await poster(
        serveur.url,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        serveur.jeton
      )
      expect(avec.statut).toBe(200)
      const noms = (
        JSON.parse(avec.texte) as { result: { tools: Array<{ name: string }> } }
      ).result.tools.map((t) => t.name)
      expect(noms).toEqual(['brain_query', 'remember'])
    } finally {
      await serveur.arreter()
    }
  })

  it('la config MCP produite porte le type http, l’URL et le jeton en en-tête', async () => {
    const serveur = await demarrerServeurOutilsNoeudSkill(lanceur())
    try {
      const config = JSON.parse(serveur.configMcp()) as {
        mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>
      }
      const entree = config.mcpServers[NOM_SERVEUR_MCP]!
      expect(entree.type).toBe('http')
      expect(entree.url).toBe(serveur.url)
      expect(entree.headers['X-Autowin-Token']).toBe(serveur.jeton)
    } finally {
      await serveur.arreter()
    }
  })

  it('arreter() est idempotent — un run qui se termine deux fois ne jette pas', async () => {
    const serveur = await demarrerServeurOutilsNoeudSkill(lanceur())
    await serveur.arreter()
    await expect(serveur.arreter()).resolves.toBeUndefined()
  })
})

describe('issue métier — anti faux-vert dans la trace', () => {
  it('un remember refusé par le Brain ne passe PLUS pour un ok', () => {
    // Valeurs COPIÉES du run réel conv-1346, où la trace affichait « remember : ok ».
    expect(
      issueMetier({ allowed: true, stored: false, detail: 'refusé par le Brain : not found' })
    ).toBe('RIEN ECRIT — refusé par le Brain : not found')
  })

  it('un brain_query qui ne trouve rien le DIT', () => {
    expect(
      issueMetier({
        allowed: true,
        found: false,
        status: 'invalid',
        note: 'reponse Brain rejetee'
      })
    ).toBe('RIEN TROUVE — reponse Brain rejetee')
  })

  it('une écriture réussie reste annoncée comme telle', () => {
    expect(issueMetier({ stored: true })).toBe('ecrit')
  })

  it("n'invente aucun statut quand le résultat n'en porte pas", () => {
    expect(issueMetier({ quelquechose: 1 })).toBeUndefined()
    expect(issueMetier('texte brut')).toBeUndefined()
    expect(issueMetier(null)).toBeUndefined()
  })

  it("l'issue REMONTE jusqu'à l'observateur de la trace", async () => {
    const vus: AppelMcpObserve[] = []
    await traiterMessageMcp(
      { method: 'tools/call', id: 9, params: { name: 'remember', arguments: {} } },
      {
        exec: async () => ({ ok: true, data: { stored: false, detail: 'refusé par le Brain' } }),
        catalogue: () => SPECS
      },
      (a) => vus.push(a)
    )
    expect(vus[0]?.ok).toBe(true)
    expect(vus[0]?.issue).toContain('RIEN ECRIT')
  })
})

describe('corrections de l’audit', () => {
  it('un argument dont la description CONTIENT « facultatif » sans commencer par lui reste REQUIS', () => {
    // Defaut trouve par l'audit : le test de sous-chaine rendait cet argument optionnel en silence.
    expect(schemaEntree({ a: 'obligatoire sauf si facultatif' }).required).toEqual(['a'])
    // Et la forme reelle du bus (« facultatif — … ») reste bien optionnelle.
    expect(schemaEntree({ b: 'facultatif — mots-clés' }).required).toEqual([])
  })

  it('des arguments non-objet sont REFUSÉS avec un motif, sans toucher au bus', async () => {
    for (const hostile of ['une chaine', 42, [1, 2], true]) {
      let touche = false
      const rep = await traiterMessageMcp(
        {
          method: 'tools/call',
          id: 1,
          params: { name: 'brain_query', arguments: hostile as never }
        },
        lanceur(async () => {
          touche = true
          return { ok: true }
        })
      )
      const r = (rep.corps as { result: { content: Array<{ text: string }>; isError: boolean } })
        .result
      expect(touche, `arguments ${JSON.stringify(hostile)} ne doivent pas atteindre le bus`).toBe(
        false
      )
      expect(r.content[0]!.text).toContain('arguments invalides')
      expect(r.isError).toBe(true)
    }
  })

  it('seuls les providers qui CONSOMMENT réellement l’option sont déclarés', () => {
    expect(porteLesOutilsNatifs('claude')).toBe(true)
    // Mesure du 2026-08-20 : codex fait un POST direct, gemini et kimi spawnent sans drapeau MCP.
    for (const muet of ['codex', 'gemini', 'kimi', 'inconnu']) {
      expect(porteLesOutilsNatifs(muet), `${muet} ne transporte pas les outils`).toBe(false)
    }
  })
})
