import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOM_SERVEUR_MCP,
  demarrerServeurOutilsNoeudSkill,
  outilsPublies,
  schemaEntree,
  traiterMessageMcp,
  issueMetier,
  lecturesDirectesDuBrain,
  libelleAppelObserve,
  porteLesOutilsNatifs,
  type AppelMcpObserve,
  type DeclarationArguments,
  type PerimetreOutils
} from './skill-node-mcp'
import type { LanceurCommandeSkill, SpecCommandeSkill } from './skill-node-tools'
import type { ExecutionEvidence, Message, SendOptions, SendResult } from '../providers/types'
import { AgentPilot, type PilotEvent } from '../agent-pilot/agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { CommandSpec } from '../commands/commands'
import { createChatTurn, reduceChatTurn } from '../../shared/chat-turn'

/** Les specs REELLES des commandes, recopiees de `commands.ts` (arguments compris). */
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
    name: 'brain_graph',
    description: 'Suivre les liens du Brain',
    args: {
      entity: 'identifiant exact, nom de symbole ou chemin knowledge/…md',
      direction: 'facultatif — dependents (défaut) | dependencies',
      depth: 'facultatif — 1 à 3, défaut 1',
      relation: 'facultatif — ne suivre qu’une relation (ex. calls)'
    }
  },
  {
    name: 'brain_read',
    description: 'Relire une note curée',
    args: { path: 'chemin de la note, knowledge/…/nom.md' }
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
    expect(noms).toEqual(['brain_query', 'remember', 'brain_graph', 'brain_read'])
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
        `mcp__${NOM_SERVEUR_MCP}__remember`,
        `mcp__${NOM_SERVEUR_MCP}__brain_graph`,
        `mcp__${NOM_SERVEUR_MCP}__brain_read`
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

  it('relaie un appel `brain_graph` au bus avec ses arguments', async () => {
    const vus: Array<{ name: string; args: unknown }> = []
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 4,
        params: {
          name: 'brain_graph',
          arguments: { entity: 'OrderService', direction: 'dependents' }
        }
      },
      lanceur(async (name, args) => {
        vus.push({ name, args })
        return { ok: true, data: 'OrderController calls OrderService' }
      })
    )
    expect(vus).toEqual([
      { name: 'brain_graph', args: { entity: 'OrderService', direction: 'dependents' } }
    ])
    const r = (rep.corps as { result: { content: Array<{ text: string }>; isError: boolean } })
      .result
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

  it('rend un résultat long EN ENTIER — une note ouverte n’arrive plus amputée', async () => {
    const note = `${'z'.repeat(10_000)}FIN-DE-NOTE`
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 5,
        params: { name: 'brain_read', arguments: { path: 'knowledge/x.md' } }
      },
      lanceur(async () => ({ ok: true, data: note }))
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(r.content[0]!.text).toBe(note)
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
      expect(noms).toEqual(['brain_query', 'remember', 'brain_graph', 'brain_read'])
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
    // Valeurs COPIÉES du run réel, où la trace affichait « remember : ok ».
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

/**
 * LIMITE DE TAILLE — mesurée le 2026-09-27 sur le vrai CLI (`scripts/probe-brain-read-taille.mts`) :
 * une note de 120 000 caractères n'arrivait PAS dans la conversation (« exceeds maximum allowed
 * tokens. Output has been saved to … », seuil par défaut ~50 000), et le fichier de repli tenait sur
 * UNE ligne (JSON échappé), donc illisible par `Read`. Documentation :
 * https://code.claude.com/docs/en/mcp — `_meta["anthropic/maxResultSizeChars"]`, jusqu'à 500 000.
 */
describe('taille des résultats — une note ouverte arrive entière et lisible', () => {
  it('chaque outil publié déclare le plafond maximal documenté (500 000 caractères)', () => {
    for (const outil of outilsPublies(lanceur())) {
      expect(outil._meta).toEqual({ 'anthropic/maxResultSizeChars': 500_000 })
    }
  })

  it('une note trouvée est rendue en TEXTE, ses lignes intactes — pas en JSON échappé', async () => {
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 21,
        params: { name: 'brain_read', arguments: { path: 'knowledge/a.md' } }
      },
      lanceur(async () => ({
        ok: true,
        data: { found: true, status: 'found', knowledge: '# Titre\nligne 2\nligne 3' }
      }))
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(r.content[0]!.text).toBe('# Titre\nligne 2\nligne 3')
  })

  it('au-delà de 500 000 caractères, brain_read renvoie vers le VRAI fichier de la note, pas vers un JSON d’une ligne', async () => {
    // Mesuré le 2026-09-27 : au-delà du plafond, le CLI range le résultat dans un `.json` où le texte
    // tient sur UNE ligne de 625 000 caractères. Deux notes du Brain dépassent ce plafond
    // (modele-ult.md 809 Ko, modele-operation.md 744 Ko) : le fichier .md, lui, a ses lignes.
    const vus: AppelMcpObserve[] = []
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 23,
        params: { name: 'brain_read', arguments: { path: 'knowledge/domain/modele-ult.md' } }
      },
      lanceur(async () => ({
        ok: true,
        data: { found: true, status: 'found', knowledge: 'x\n'.repeat(260_000) }
      })),
      (a) => vus.push(a)
    )
    const texte = (rep.corps as { result: { content: Array<{ text: string }> } }).result.content[0]!
      .text
    expect(texte.length).toBeLessThan(2_000)
    expect(texte).toContain('520000 caractères')
    expect(texte).toMatch(/knowledge\/domain\/modele-ult\.md/)
    expect(texte).toMatch(/offset|Grep/)
    // La trace le dit aussi : la note n'est PAS arrivée entière.
    expect(vus[0]?.issue).toMatch(/trop grande/)
  })

  it('le bord est exact : 500 000 caractères passent ENTIERS, 500 001 sont renvoyés vers le fichier', async () => {
    // Le seul test de dépassement portait sur 520 000 : un `>=` à la place du `>` passait inaperçu.
    const lire = async (taille: number): Promise<string> => {
      const rep = await traiterMessageMcp(
        {
          method: 'tools/call',
          id: 24,
          params: { name: 'brain_read', arguments: { path: 'knowledge/domain/bord.md' } }
        },
        lanceur(async () => ({
          ok: true,
          data: { found: true, status: 'found', knowledge: 'y'.repeat(taille) }
        }))
      )
      return (rep.corps as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
    }
    const auPlafond = await lire(500_000)
    expect(auPlafond.length).toBe(500_000)
    expect(auPlafond).toBe('y'.repeat(500_000))
    const auDela = await lire(500_001)
    expect(auDela).toContain('500001 caractères')
    expect(auDela).toMatch(/knowledge\/domain\/bord\.md/)
  })

  it('un chemin absolu écrit dans une AUTRE casse que la racine n’est pas préfixé deux fois', async () => {
    // Windows et le serveur du Brain ignorent la casse : `//NAS1/PARTAGE/…` désigne la même note que
    // `\\nas1\partage\…`. Le renvoi ne doit pas fabriquer `//nas1/…/Team Brain///NAS1/…`.
    const renvoi = async (chemin: string): Promise<string> => {
      const rep = await traiterMessageMcp(
        {
          method: 'tools/call',
          id: 25,
          params: { name: 'brain_read', arguments: { path: chemin } }
        },
        lanceur(async () => ({
          ok: true,
          data: { found: true, status: 'found', knowledge: 'z'.repeat(500_001) }
        }))
      )
      return (rep.corps as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
    }
    vi.stubEnv('AUTOWIN_BRAIN_ROOT', '\\\\nas1\\partage\\Projets IA\\Team Brain')
    try {
      for (const chemin of [
        '//NAS1/PARTAGE/Projets IA/Team Brain/knowledge/domain/modele-ult.md',
        '\\\\NAS1\\partage\\projets ia\\team brain\\knowledge\\domain\\modele-ult.md'
      ]) {
        const texte = await renvoi(chemin)
        expect(texte.match(/team brain/gi)).toHaveLength(1)
        expect(texte).toContain(`${chemin.replace(/\\/g, '/')}.`)
      }
      // Un chemin RELATIF, lui, reçoit bien la racine une fois.
      expect(await renvoi('knowledge/domain/modele-ult.md')).toContain(
        '//nas1/partage/Projets IA/Team Brain/knowledge/domain/modele-ult.md.'
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sans contenu (introuvable, panne), le résultat reste en JSON : le statut et la note se lisent', async () => {
    const rep = await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 22,
        params: { name: 'brain_read', arguments: { path: 'knowledge/x.md' } }
      },
      lanceur(async () => ({
        ok: true,
        data: { found: false, status: 'empty', knowledge: '', note: 'note not found' }
      }))
    )
    const r = (rep.corps as { result: { content: Array<{ text: string }> } }).result
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({
      found: false,
      note: 'note not found'
    })
  })
})

describe('mesure de lecture — quelle note, combien de caractères', () => {
  it('brain_read remonte la note ouverte et la longueur rendue jusqu’à la trace', async () => {
    const vus: AppelMcpObserve[] = []
    await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 11,
        params: { name: 'brain_read', arguments: { path: ' knowledge/domain/a.md ' } }
      },
      lanceur(async () => ({
        ok: true,
        data: { found: true, status: 'found', knowledge: 'x'.repeat(18994) }
      })),
      (a) => vus.push(a)
    )
    expect(vus[0]).toMatchObject({ cible: 'knowledge/domain/a.md', caracteres: 18994 })
    expect(libelleAppelObserve(vus[0]!, 'think')).toBe(
      'outil natif brain_read (think) : ok — trouve · knowledge/domain/a.md · 18994 car.'
    )
  })

  it('brain_query mesure la longueur de la liste rendue, sans cible', async () => {
    const vus: AppelMcpObserve[] = []
    await traiterMessageMcp(
      {
        method: 'tools/call',
        id: 12,
        params: { name: 'brain_query', arguments: { question: 'q' } }
      },
      lanceur(async () => ({ ok: true, data: { found: true, knowledge: 'liste' } })),
      (a) => vus.push(a)
    )
    expect(vus[0]?.cible).toBeUndefined()
    expect(libelleAppelObserve(vus[0]!, 'think')).toBe(
      'outil natif brain_query (think) : ok — trouve · 5 car.'
    )
  })

  it('les lectures DIRECTES du Brain (Read, Grep) deviennent des lignes de trace', () => {
    const racine = '//nas1/partage/Projets IA/Team Brain'
    const lignes = lecturesDirectesDuBrain(
      [
        {
          type: 'Read',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: 'Read',
          path: '\\\\nas1\\partage\\Projets IA\\Team Brain\\knowledge\\domain\\guide-choix-ult.md',
          outputChars: 18994
        },
        {
          type: 'Grep',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: 'Grep',
          searchPath: '\\\\nas1\\partage\\Projets IA\\Team Brain\\knowledge',
          pattern: 'Ult_Heure',
          outputChars: 300
        },
        // Hors du Brain, ou dans un dossier qui en PARTAGE seulement le début du nom : ignorés.
        {
          type: 'Read',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: '',
          path: 'D:\\AutoWinOS\\src\\a.ts'
        },
        {
          type: 'Read',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: '',
          path: '\\\\nas1\\partage\\Projets IA\\Team Brain-copie\\knowledge\\x.md'
        },
        {
          type: 'Edit',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: '',
          path: '\\\\nas1\\partage\\Projets IA\\Team Brain\\x.md'
        }
      ],
      racine,
      'think'
    )
    expect(lignes).toEqual([
      'lecture directe Read (think) : ok — knowledge/domain/guide-choix-ult.md · 18994 car.',
      'recherche directe Grep (think) : ok — « Ult_Heure » · knowledge · 300 car.'
    ])
    expect(lecturesDirectesDuBrain(undefined, racine, 'think')).toEqual([])
    expect(lecturesDirectesDuBrain([], '', 'think')).toEqual([])
  })

  it('lectures directes : casse et barre finale de la racine, Glob au chemin porté par le motif', () => {
    const preuve = (o: Partial<ExecutionEvidence>): ExecutionEvidence => ({
      type: 'Read',
      kind: 'inspection',
      status: 'completed',
      ok: true,
      summary: '',
      ...o
    })
    expect(
      lecturesDirectesDuBrain(
        [
          preuve({
            path: '\\\\NAS1\\partage\\projets ia\\TEAM BRAIN\\knowledge\\a.md',
            outputChars: 10
          }),
          // Un Glob sans dossier, dont le MOTIF porte le chemin complet sous le Brain.
          preuve({
            type: 'Glob',
            pattern: '//nas1/partage/Projets IA/Team Brain/knowledge/**/*ult*.md',
            outputChars: 5
          }),
          // Un Glob sans dossier ni chemin dans le motif : rien ne dit qu'il vise le Brain.
          preuve({ type: 'Glob', pattern: '**/*.md', outputChars: 5 }),
          preuve({ ok: false, path: '//nas1/partage/Projets IA/Team Brain/knowledge/absente.md' })
        ],
        '//nas1/partage/Projets IA/Team Brain/',
        'think'
      )
    ).toEqual([
      'lecture directe Read (think) : ok — knowledge/a.md · 10 car.',
      'recherche directe Glob (think) : ok — « //nas1/partage/Projets IA/Team Brain/knowledge/**/*ult*.md » · knowledge/**/*ult*.md · 5 car.',
      'lecture directe Read (think) : echec — knowledge/absente.md'
    ])
  })

  it('le libellé historique reste inchangé quand rien n’est mesurable', () => {
    expect(libelleAppelObserve({ outil: 'remember', refuse: false, ok: true }, 'learn')).toBe(
      'outil natif remember (learn) : ok'
    )
    expect(libelleAppelObserve({ outil: 'orchestrate', refuse: true, ok: false }, 'think')).toBe(
      'outil natif orchestrate (think) : refuse'
    )
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
    // `codex exec` les reçoit par `-c mcp_servers.*` (`optionsMcpCodex`, prouvé en vrai le 2026-10-31).
    expect(porteLesOutilsNatifs('codex')).toBe(true)
    // Mesure du 2026-08-20 : gemini et kimi spawnaient sans drapeau MCP.
    for (const muet of ['gemini', 'kimi', 'inconnu']) {
      expect(porteLesOutilsNatifs(muet), `${muet} ne transporte pas les outils`).toBe(false)
    }
  })
})

/**
 * ANNOTATIONS ET VRAIS TYPES (2026-10-31).
 *
 * Mesure sur 53 outils servis : tout partait en texte, 20 arguments sur 11 outils étaient exigés à
 * tort, et aucune annotation ne sortait alors que 51 commandes en portent. Documentation
 * (https://code.claude.com/docs/en/mcp, « Mark tools that are safe to call twice ») : `readOnlyHint`
 * fait tourner les appels ensemble, `readOnlyHint` et `idempotentHint` autorisent à rejouer une fois
 * un appel coupé.
 */
const LECTURE: NonNullable<CommandSpec['annotations']> = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
}
const ECRITURE: NonNullable<CommandSpec['annotations']> = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
}
const CATALOGUE_ANNOTE: CommandSpec[] = [
  {
    name: 'brain_read',
    description: 'lire une note',
    args: { path: 'chemin' },
    annotations: LECTURE
  },
  { name: 'remember', description: 'retenir', args: { type: 'type' }, annotations: ECRITURE }
]
const PERIMETRE_CHAT: PerimetreOutils = {
  outils: ['brain_read', 'remember'],
  refus: (nom) => `refus ${nom}`
}
const lanceurAnnote = (exec: LanceurCommandeSkill['exec']): LanceurCommandeSkill => ({
  exec,
  catalogue: () => CATALOGUE_ANNOTE
})
const appelDe = (
  nom: string,
  args: Record<string, unknown>,
  id = 1
): Parameters<typeof traiterMessageMcp>[0] => ({
  method: 'tools/call',
  id,
  params: { name: nom, arguments: args }
})
const texteDeLaReponse = (r: { corps?: unknown }): string =>
  (r.corps as { result: { content: Array<{ text: string }> } }).result.content[0]!.text

describe('annotations publiées', () => {
  it('chaque outil publie les annotations de sa commande : elles décident du lancement ensemble et du rejeu', () => {
    const outils = outilsPublies(lanceurAnnote(async () => ({ ok: true })))
    expect(outils.find((o) => o.name === 'brain_read')?.annotations).toEqual(LECTURE)
    expect(outils.find((o) => o.name === 'remember')?.annotations).toEqual(ECRITURE)
  })

  it("une commande sans annotations n'en invente aucune : le client garde son défaut prudent", () => {
    for (const outil of outilsPublies(lanceur())) expect(outil).not.toHaveProperty('annotations')
  })

  it('les annotations sortent par tools/list, là où le client les lit', async () => {
    const rep = await traiterMessageMcp(
      { method: 'tools/list', id: 1 },
      lanceurAnnote(async () => ({ ok: true }))
    )
    const { result } = JSON.parse(JSON.stringify(rep.corps)) as {
      result: { tools: Array<{ name: string; annotations?: unknown }> }
    }
    expect(result.tools.find((o) => o.name === 'brain_read')?.annotations).toEqual(LECTURE)
  })
})

describe('schemaEntree — déclaration des arguments', () => {
  it('sans déclaration, rien ne change : tout en texte, required lu sur le mot facultatif', () => {
    const attendu = {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'texte' },
        b: { type: 'string', description: 'facultatif — x' }
      },
      required: ['a']
    }
    expect(schemaEntree({ a: 'texte', b: 'facultatif — x' })).toEqual(attendu)
    expect(schemaEntree({ a: 'texte', b: 'facultatif — x' }, {})).toEqual(attendu)
  })

  it('argsTypes publie le vrai type et ses bornes ; la description de la commande reste', () => {
    const s = schemaEntree(
      { limite: 'facultatif — nombre maximum', mode: 'court|long' },
      {
        argsTypes: {
          limite: { type: 'integer', minimum: 1, maximum: 50 },
          mode: { type: 'string', enum: ['court', 'long'], maxLength: 5, description: 'le mode' }
        }
      }
    )
    expect(s.properties).toEqual({
      limite: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'facultatif — nombre maximum'
      },
      mode: { type: 'string', enum: ['court', 'long'], maxLength: 5, description: 'le mode' }
    })
    // Sans `argsFacultatifs`, le mot décide encore : les deux déclarations sont indépendantes.
    expect(s.required).toEqual(['mode'])
  })

  it('argsFacultatifs donne le required exact, dans les deux sens', () => {
    const args = {
      fil: 'conversation destinataire (optionnel)',
      message: 'texte',
      note: 'facultatif — x'
    }
    // Le défaut mesuré : `fil` était exigé parce que sa description ne COMMENCE pas par le mot.
    expect(schemaEntree(args, { argsFacultatifs: ['fil', 'note'] }).required).toEqual(['message'])
    // La liste déclarée prime sur le mot, sinon « exact » ne voudrait rien dire.
    expect(schemaEntree(args, { argsFacultatifs: ['fil'] }).required).toEqual(['message', 'note'])
    expect(schemaEntree({ a: 'facultatif — x' }, { argsFacultatifs: [] }).required).toEqual(['a'])
  })

  it('tableaux et objets gardent items, properties et required imbriqués', () => {
    const options = {
      type: 'array',
      items: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'string' } },
        required: ['x']
      }
    } as const
    const s = schemaEntree({ options: 'la liste' }, { argsTypes: { options } })
    expect(s.properties.options).toEqual({ ...options, description: 'la liste' })
  })

  it('argsTypes ne crée aucun argument : les noms restent ceux de la commande (défaut de conv-1339)', () => {
    const s = schemaEntree(
      { question: 'la question' },
      { argsTypes: { query: { type: 'string' } } }
    )
    expect(Object.keys(s.properties)).toEqual(['question'])
  })

  it('outilsPublies lit la déclaration sur la spec, sans la laisser sortir dans l’outil publié', () => {
    const spec: SpecCommandeSkill & DeclarationArguments = {
      name: 'brain_query',
      description: 'chercher',
      args: { question: 'la question', limite: 'nombre maximum' },
      argsTypes: { limite: { type: 'integer', minimum: 1 } },
      argsFacultatifs: ['limite']
    }
    const [outil] = outilsPublies({ exec: async () => ({ ok: true }), catalogue: () => [spec] })
    expect(outil!.inputSchema.properties.limite?.type).toBe('integer')
    expect(outil!.inputSchema.required).toEqual(['question'])
    expect(Object.keys(outil!)).not.toContain('argsTypes')
    expect(Object.keys(outil!)).not.toContain('argsFacultatifs')
  })
})

type ResultatBus = { ok: boolean; data?: unknown; error?: string }

/** Un bus qui mesure ses appels en vol ; le premier arrivé finit le dernier, pour croiser les fins. */
function busChronometre(reponse: (args: Record<string, unknown>) => ResultatBus): {
  exec: (nom: string, args: Record<string, unknown>) => Promise<ResultatBus>
  pic: () => number
} {
  let enVol = 0
  let pic = 0
  let rang = 0
  return {
    exec: async (_nom, args) => {
      const duree = 40 - 10 * Math.min(rang++, 3)
      enVol += 1
      pic = Math.max(pic, enVol)
      await new Promise((resolve) => setTimeout(resolve, duree))
      enVol -= 1
      return reponse(args)
    },
    pic: () => pic
  }
}

type ConfigMcp = { mcpServers: { autowin: { url: string; headers: Record<string, string> } } }
type ReponseRpc = { result?: { content?: Array<{ text?: string }>; isError?: boolean } }

/** Un appel d'outil posté sur le vrai port, comme le fait le CLI. */
async function posterAppel(options: SendOptions, nom: string, args: unknown): Promise<ReponseRpc> {
  const config = JSON.parse(options.skillNodeTools!.mcpConfig) as ConfigMcp
  const r = await fetch(config.mcpServers.autowin.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...config.mcpServers.autowin.headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: nom, arguments: args }
    })
  })
  return (await r.json()) as ReponseRpc
}

/** Un vrai tour de chat, seul le modèle est simulé : ses appels d'outils partent par `pendant`. */
function tourDeChat(
  etapes: Array<{ pendant?: (o: SendOptions) => Promise<void>; texte?: string }>,
  exec: (nom: string, args: Record<string, unknown>) => Promise<ResultatBus>
): {
  jouer: () => Promise<void>
  evenements: PilotEvent[]
  appelsBus: () => unknown[][]
} {
  const restantes = [...etapes]
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], options: SendOptions): Promise<SendResult> => {
      const etape = restantes.shift() ?? { texte: 'fin.' }
      if (etape.pendant) await etape.pendant(options)
      return { text: etape.texte ?? '' } as SendResult
    }),
    describePrompt: vi.fn(() => ({
      provider: 'claude',
      messages: [],
      transport: 't',
      options: {},
      limitation: 'test'
    })),
    honoursSessionResume: vi.fn(() => false)
  }
  const bus = {
    catalog: vi.fn(() => CATALOGUE_ANNOTE),
    snapshotForPrompt: vi.fn(async () => ({
      tab: 'chat',
      providers: [],
      runsBlocked: [],
      conversationsCount: 0
    })),
    exec: vi.fn(exec)
  }
  const pilote = new AgentPilot(
    registry as never,
    { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) } as never,
    bus as never,
    undefined,
    () => '',
    () => '',
    true
  )
  const evenements: PilotEvent[] = []
  return {
    jouer: () =>
      pilote.chat(
        [{ role: 'user', content: 'lis ces notes' } as Message],
        (e) => evenements.push(e),
        undefined,
        8
      ),
    evenements,
    appelsBus: () => bus.exec.mock.calls
  }
}

describe('appels simultanés', () => {
  const NOTES = ['a.md', 'b.md', 'c.md', 'd.md']
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-simultanes-'))))
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('chat : quatre lectures d’un même message tournent ensemble, chaque résultat suit SA carte', async () => {
    /*
     * ENSEMBLE DEPUIS le 2026-10-31. Ce test gardait la file tant que la trace
     * rattachait chaque événement au PRÉCÉDENT. `run-pilot-chat.ts` rattache maintenant le `result`
     * à SA `command`, `appelsDeLOutil` apparie par action, et `chat-mcp.ts` pose
     * `lecturesSimultanees: true` : les quatre lectures sont en vol en même temps.
     */
    const b = busChronometre((args) => ({ ok: true, data: `note de ${String(args.path)}` }))
    let reponses: ReponseRpc[] = []
    const t = tourDeChat(
      [
        {
          pendant: async (o) => {
            reponses = await Promise.all(
              NOTES.map((path) => posterAppel(o, 'brain_read', { path }))
            )
          },
          texte: 'Lu.'
        }
      ],
      b.exec
    )
    await t.jouer()

    expect(b.pic()).toBe(4)
    expect(reponses.map((r) => r.result?.content?.[0]?.text)).toEqual(
      NOTES.map((n) => `note de ${n}`)
    )

    const paires = t.evenements.flatMap((e) =>
      e.kind === 'command' || e.kind === 'result' ? [[e.kind, e.actionId]] : []
    )
    expect(paires).toHaveLength(8)
    // Croisés, les appels ne se suivent plus deux à deux : chaque action a SA commande puis SON résultat.
    for (const action of new Set(paires.map((p) => p[1]))) {
      expect(paires.filter((p) => p[1] === action).map((p) => p[0])).toEqual(['command', 'result'])
    }

    // Ce que voit le fil : une carte par appel, chacune avec le résultat de SON argument.
    let tour = createChatTurn('tour')
    for (const e of t.evenements) {
      const { actionId = '', name = '', args, ok = false, data } = e
      if (e.kind === 'command') {
        tour = reduceChatTurn(tour, { kind: 'command', actionId, name, args })
      } else if (e.kind === 'result') {
        tour = reduceChatTurn(tour, { kind: 'result', actionId, name, ok, data })
      }
    }
    const cartes = tour.parts.flatMap((p) => (p.kind === 'action' ? [p] : []))
    expect(new Set(cartes.map((c) => c.actionId)).size).toBe(4)
    for (const carte of cartes) {
      expect(carte.data).toBe(`note de ${String((carte.args as { path: string }).path)}`)
    }
  })

  it('chat : une lecture en échec au milieu n’arrête pas les suivantes et reste au bilan', async () => {
    const b = busChronometre((args) =>
      args.path === 'b.md' ? { ok: false, error: 'note absente' } : { ok: true, data: 'lu' }
    )
    let reponses: ReponseRpc[] = []
    const t = tourDeChat(
      [
        {
          pendant: async (o) => {
            reponses = await Promise.all(
              NOTES.map((path) => posterAppel(o, 'brain_read', { path }))
            )
          },
          texte: 'La note b.md manque.'
        }
      ],
      b.exec
    )
    await t.jouer()
    expect(reponses.map((r) => r.result?.isError)).toEqual([false, true, false, false])
    const bilan = t.evenements.find((e) => e.kind === 'echecs-abandonnes') as
      { data?: Array<{ actionId: string; cible: string }> } | undefined
    expect(bilan?.data).toHaveLength(1)
    expect(JSON.stringify(bilan?.data)).toContain('b.md')
  })

  it('chat : un <cmd> identique à une lecture simultanée n’est pas rejoué', async () => {
    const b = busChronometre(() => ({ ok: true, data: 'lu' }))
    const t = tourDeChat(
      [
        {
          pendant: async (o) => {
            await Promise.all(
              NOTES.slice(0, 2).map((path) => posterAppel(o, 'brain_read', { path }))
            )
          },
          texte: 'Lu.<cmd>{"name":"brain_read","args":{"path":"a.md"}}</cmd>'
        },
        { texte: 'Fait.' }
      ],
      b.exec
    )
    await t.jouer()
    expect(t.appelsBus().filter((c) => c[0] === 'brain_read')).toHaveLength(2)
  })

  it('étape de workflow : les lectures tournent ENSEMBLE, et chacune garde sa note et sa trace', async () => {
    // Ni carte ni trace causale ici : l'observateur reçoit des lignes qui portent déjà leur cible.
    const b = busChronometre((args) => ({
      ok: true,
      data: { found: true, knowledge: `note de ${String(args.path)}` }
    }))
    const l = lanceurAnnote(b.exec)
    const vus: AppelMcpObserve[] = []
    const reponses = await Promise.all(
      NOTES.map((path, i) =>
        traiterMessageMcp(appelDe('brain_read', { path }, i), l, (a) => vus.push(a))
      )
    )
    expect(b.pic()).toBe(4)
    expect(reponses.map(texteDeLaReponse)).toEqual(NOTES.map((n) => `note de ${n}`))
    // Fins croisées : le premier arrivé finit le dernier, sans perdre la note qu'il a ouverte.
    expect(vus.map((a) => a.cible)).toEqual([...NOTES].reverse())
  })

  it('la file ne retient que les lectures : une écriture passe même si une lecture est bloquée', async () => {
    let liberer = (): void => undefined
    const l = lanceurAnnote(async (nom) => {
      if (nom === 'brain_read') await new Promise<void>((resolve) => (liberer = resolve))
      return { ok: true, data: nom }
    })
    const lecture = traiterMessageMcp(
      appelDe('brain_read', { path: 'a.md' }),
      l,
      undefined,
      PERIMETRE_CHAT
    )
    const ecriture = await traiterMessageMcp(
      appelDe('remember', { type: 'lesson' }),
      l,
      undefined,
      PERIMETRE_CHAT
    )
    expect(texteDeLaReponse(ecriture)).toBe('remember')
    liberer()
    await lecture
  })

  it('une lecture qui JETTE ne bloque pas celles qui attendent derrière elle', async () => {
    const l = lanceurAnnote(async (_nom, args) => {
      if (args.path === 'a.md') throw new Error('brain injoignable')
      return { ok: true, data: 'lu' }
    })
    const [premiere, seconde] = await Promise.all([
      traiterMessageMcp(appelDe('brain_read', { path: 'a.md' }), l, undefined, PERIMETRE_CHAT),
      traiterMessageMcp(appelDe('brain_read', { path: 'b.md' }), l, undefined, PERIMETRE_CHAT)
    ])
    expect(texteDeLaReponse(premiere)).toContain('brain injoignable')
    expect(texteDeLaReponse(seconde)).toBe('lu')
  })

  it('une file par envoi : une lecture bloquée dans un fil ne retient pas celles d’un autre', async () => {
    let liberer = (): void => undefined
    const bloque = lanceurAnnote(async () => {
      await new Promise<void>((resolve) => (liberer = resolve))
      return { ok: true, data: 'tard' }
    })
    const libre = lanceurAnnote(async () => ({ ok: true, data: 'lu' }))
    const enAttente = traiterMessageMcp(
      appelDe('brain_read', { path: 'a.md' }),
      bloque,
      undefined,
      PERIMETRE_CHAT
    )
    const passee = await traiterMessageMcp(
      appelDe('brain_read', { path: 'b.md' }),
      libre,
      undefined,
      PERIMETRE_CHAT
    )
    expect(texteDeLaReponse(passee)).toBe('lu')
    liberer()
    await enAttente
  })
})
