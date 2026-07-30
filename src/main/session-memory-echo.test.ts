import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ECHO_MAX_BLOCK_CHARS,
  ECHO_MAX_BODY_CHARS,
  ECHO_MAX_FACTS,
  evictedCount,
  forgetEcho,
  noteRemembered,
  rememberedFacts,
  sessionMemoryBlock,
  type RememberedFact
} from './session-memory-echo'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { buildTurnMessages } from './chat-turn-messages'

/**
 * ÉCHO DE MÉMOIRE — la moitié manquante de la mécanique de claude.exe.
 *
 * Un audit du 2026-07-30 a établi que `remember` livrait l'écriture sans la relecture : la régression
 * face à claude.exe était DÉPLACÉE et honnêtement dite, pas fermée. Ces tests gardent les deux exigences
 * qui s'opposent : le modèle doit RETROUVER ce qu'il a retenu, et l'écho ne doit JAMAIS redevenir le
 * robinet de 552 Ko qu'on avait coupé.
 */
beforeEach(forgetEcho)

const fait = (n: number) => ({ title: `Fait ${n}`, body: `le contenu numéro ${n}` })

describe('l’écho rend ce qui a été retenu — dans CE fil seulement', () => {
  it('un fait déposé est retrouvé au tour suivant', () => {
    noteRemembered('conv-1', fait(1))
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(bloc).toContain('Fait 1')
    expect(bloc).toContain('le contenu numéro 1')
  })

  it('les fils sont CLOISONNÉS — un autre fil ne voit rien', () => {
    noteRemembered('conv-1', fait(1))
    expect(rememberedFacts('conv-2')).toHaveLength(0)
    expect(sessionMemoryBlock(rememberedFacts('conv-2'))).toBe('')
  })

  it('sans rien de retenu, AUCUN bloc n’est produit', () => {
    // Un bloc vide laisserait un trou dans le prompt et coûterait des tokens pour rien.
    expect(sessionMemoryBlock(rememberedFacts(undefined))).toBe('')
    expect(sessionMemoryBlock([])).toBe('')
  })

  it('le bloc DIT la mécanique : relisible ici, pas encore partagé', () => {
    noteRemembered('conv-1', fait(1))
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(bloc).toMatch(/écho local/i)
    expect(bloc).toMatch(/promotion humaine/i)
    // Surtout : ne pas laisser croire que brain_query le trouverait deja.
    expect(bloc).toMatch(/pas encore/i)
  })

  it('un même fait re-déposé ne s’empile pas deux fois', () => {
    noteRemembered('conv-1', fait(1))
    noteRemembered('conv-1', fait(1))
    expect(rememberedFacts('conv-1')).toHaveLength(1)
  })

  it('un fait sans titre ou sans contenu n’entre pas dans l’écho', () => {
    noteRemembered('conv-1', { title: '  ', body: 'du contenu' })
    noteRemembered('conv-1', { title: 'un titre', body: '   ' })
    noteRemembered('', fait(9))
    expect(rememberedFacts('conv-1')).toHaveLength(0)
  })
})

describe('l’écho reste PLAFONNÉ — le robinet de 552 Ko ne se rouvre pas', () => {
  it('au-delà du plafond, les plus anciens sortent', () => {
    for (let n = 1; n <= ECHO_MAX_FACTS + 5; n += 1) noteRemembered('conv-1', fait(n))
    const gardes = rememberedFacts('conv-1')
    expect(gardes).toHaveLength(ECHO_MAX_FACTS)
    // Le plus recent est garde, le premier est sorti.
    expect(gardes.at(-1)?.title).toBe(`Fait ${ECHO_MAX_FACTS + 5}`)
    expect(gardes.some((f) => f.title === 'Fait 1')).toBe(false)
  })

  it('le bloc respecte son plafond de caractères, et DIT ce qu’il a coupé', () => {
    for (let n = 1; n <= ECHO_MAX_FACTS; n += 1) {
      noteRemembered('conv-1', { title: `Fait ${n}`, body: 'x'.repeat(400) })
    }
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'), 600)
    expect(bloc.length).toBeLessThanOrEqual(700)
    // Une troncature MUETTE ferait croire a une liste complete.
    expect(bloc).toMatch(/non repris/i)
  })

  it('un contenu très long est abrégé dans l’écho — le fait entier vit dans le Brain', () => {
    noteRemembered('conv-1', { title: 'Long', body: 'y'.repeat(2_000) })
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(bloc).toContain('[…]')
    expect(bloc.length).toBeLessThan(ECHO_MAX_BODY_CHARS + 400)
  })

  it('l’ordre RESTE chronologique dans le bloc rendu', () => {
    noteRemembered('conv-1', fait(1))
    noteRemembered('conv-1', fait(2))
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(bloc.indexOf('Fait 1')).toBeLessThan(bloc.indexOf('Fait 2'))
  })
})

/**
 * CYCLE 4 DE L'AUDIT — les défauts que deux juges ont trouvés indépendamment, chacun reproduit sur les
 * modules réels avant correction (sorties citées dans le RUN, section CausalHypothesis).
 */
describe('audit cycle 4 — les pertes silencieuses de l’écho', () => {
  it('un fait TROP GROS n’efface pas les autres — il est omis, et l’omission est DITE', () => {
    // Reproduit avant correctif : 7 faits retenus, bloc de longueur 0. Le `break` sautait la boucle, et
    // comme on itere du plus recent au plus ancien, un fait recent hors gabarit effacait tout.
    for (let n = 1; n <= 6; n += 1) noteRemembered('conv-1', fait(n))
    noteRemembered('conv-1', { title: 'T'.repeat(1_600), body: 'corps récent' })
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(rememberedFacts('conv-1')).toHaveLength(7)
    expect(bloc).not.toBe('')
    expect(bloc).toContain('Fait 1')
    expect(bloc).toContain('Fait 6')
  })

  it('quand RIEN ne tient dans le budget, le bloc le dit au lieu de disparaître', () => {
    noteRemembered('conv-1', { title: 'T'.repeat(500), body: 'x'.repeat(500) })
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'), 200)
    expect(bloc).toMatch(/non repris/i)
  })

  it('le budget est respecté PIED COMPRIS', () => {
    for (let n = 1; n <= ECHO_MAX_FACTS; n += 1) {
      noteRemembered('conv-1', { title: `Fait ${n}`, body: 'x'.repeat(200) })
    }
    // Assertion DURCIE : elle concédait « <= 700 » pour un budget de 600, donc elle ne pouvait pas voir
    // le depassement de ~61 caracteres du pied.
    for (const budget of [300, 600, 1_500]) {
      expect(sessionMemoryBlock(rememberedFacts('conv-1'), budget).length).toBeLessThanOrEqual(budget)
    }
  })

  it('les faits évincés par le plafond sont COMPTÉS, pas oubliés', () => {
    for (let n = 1; n <= ECHO_MAX_FACTS + 3; n += 1) noteRemembered('conv-1', fait(n))
    expect(evictedCount('conv-1')).toBe(3)
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'), ECHO_MAX_BLOCK_CHARS, evictedCount('conv-1'))
    expect(bloc).toMatch(/3 fait\(s\) non repris/)
  })

  it('l’éviction de conversations garde l’ACTIVE et jette les mortes', () => {
    // Reproduit avant correctif : `set` sur une cle existante ne change pas sa position dans une Map JS,
    // donc la conversation la plus active — inseree en premier — etait evincee avant 49 fils morts.
    noteRemembered('conv-active', fait(1))
    for (let n = 0; n < 49; n += 1) noteRemembered(`mort-${n}`, fait(n))
    noteRemembered('conv-active', fait(2)) // elle vit toujours
    noteRemembered('conv-nouvelle', fait(3)) // 51ᵉ → une éviction
    expect(rememberedFacts('conv-active').length).toBeGreaterThan(0)
    expect(rememberedFacts('mort-0')).toHaveLength(0)
  })

  it('deux faits de MÊME TITRE : le récent REMPLACE le périmé', () => {
    noteRemembered('conv-1', { title: 'Décision', body: 'on part sur A' })
    noteRemembered('conv-1', { title: 'Décision', body: 'finalement B — A est abandonné' })
    const facts = rememberedFacts('conv-1')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.body).toContain('finalement B')
  })

  it('un fait NON déposé au Brain est retenu ici, et signalé comme tel', () => {
    // Le cas courant : le service Brain est un partage SMB avec 30-40 s de préchauffage. Avant correctif,
    // « retiens ça » avec le serveur eteint ne retenait RIEN — ni durablement, ni dans le fil.
    noteRemembered('conv-1', { title: 'Fait local', body: 'établi ici', state: 'local' })
    const bloc = sessionMemoryBlock(rememberedFacts('conv-1'))
    expect(bloc).toContain('Fait local')
    expect(bloc).toMatch(/non déposé au Brain/)
  })

  it('un fait DÉPOSÉ ne porte pas cette mention — le signal doit DISCRIMINER', () => {
    noteRemembered('conv-1', { title: 'Fait durable', body: 'parti au Brain', state: 'depose' })
    expect(sessionMemoryBlock(rememberedFacts('conv-1'))).not.toMatch(/non déposé/)
  })

  it('la liste rendue est une COPIE — un appelant ne peut pas muter l’écho', () => {
    noteRemembered('conv-1', fait(1))
    const facts = rememberedFacts('conv-1') as RememberedFact[]
    facts.push({ title: 'intrus', body: 'injecté' })
    expect(rememberedFacts('conv-1')).toHaveLength(1)
  })

  it('noteRemembered DIT s’il a pu rattacher le fait', () => {
    expect(noteRemembered('conv-1', fait(1))).toBe(true)
    // Sans conversation, l'appelant doit pouvoir le SAVOIR au lieu de perdre le fait en silence.
    expect(noteRemembered('', fait(2))).toBe(false)
  })
})

describe('câblage — l’écho est réellement alimenté et réellement relu', () => {
  it('la commande remember alimente l’écho depuis le fait VALIDÉ, pas les args bruts', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toContain('noteRemembered')
    // La garde a CHANGÉ au cycle 4 : `outcome.stored` perdait le fait quand le Brain ne répondait pas.
    // La bonne condition est « le fait est RECEVABLE », l'état du dépôt voyageant avec lui.
    expect(source).toMatch(/if \(outcome\.fact\)/)
    expect(source).toContain('outcome.fact.body')
    // Et surtout : plus jamais les arguments bruts.
    expect(source).not.toMatch(/body: String\(a\.fact/)
  })

  it('le tour de chat PORTE réellement l’écho dans son message', () => {
    // Teste la SORTIE de l'assemblage, pas le texte du fichier : un test qui grep le source survit à un
    // câblage cassé. C'est pour cela que l'assemblage a été extrait.
    noteRemembered('conv-1', fait(1))
    const echo = sessionMemoryBlock(rememberedFacts('conv-1'))
    const messages = buildTurnMessages({
      snapshot: { ok: true },
      brainContext: 'CONNAISSANCE RÉCUPÉRÉE:\nquelque chose',
      memoryEcho: echo,
      history: [{ role: 'user', content: 'et donc ?' }]
    })
    expect(messages.join('\n\n')).toContain('Fait 1')
    // Position : apres l'etat et la connaissance recuperee, avant le fil.
    const iEcho = messages.findIndex((m) => m.includes('Fait 1'))
    const iHistoire = messages.findIndex((m) => m.startsWith('UTILISATEUR:'))
    expect(iEcho).toBeGreaterThan(0)
    expect(iEcho).toBeLessThan(iHistoire)
  })

  it('sans écho, le message ne porte AUCUNE entrée vide', () => {
    const messages = buildTurnMessages({
      snapshot: { ok: true },
      brainContext: '',
      memoryEcho: '',
      history: [{ role: 'user', content: 'salut' }]
    })
    expect(messages).toHaveLength(2)
    expect(messages.every((m) => m.trim().length > 0)).toBe(true)
  })

  it('l’écho voyage aussi quand une session CLI est REPRISE — sinon il disparaîtrait', () => {
    // Le cas coûteux : en reprise de session, seul le dernier message est renvoyé. Si l'écho n'y était
    // pas, la mémoire s'évaporerait précisément dans le mode le plus fréquent.
    noteRemembered('conv-1', fait(7))
    const messages = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: sessionMemoryBlock(rememberedFacts('conv-1')),
      history: [{ role: 'user', content: 'suite' }],
      resumeSessionId: 'sess-42',
      lastUserMessage: 'suite'
    })
    expect(messages.join('\n')).toContain('Fait 7')
  })

  it('l’écho n’entre PAS dans le prompt système — le préfixe doit rester cachable', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    const system = source.slice(source.indexOf('const systemParts'), source.indexOf('const system ='))
    expect(system).not.toContain('memoryEcho')
    expect(buildChatPilotagePrompt([])).not.toMatch(/CE QUE TU AS RETENU DANS CETTE CONVERSATION \(/)
  })

  it('le prompt distingue les DEUX portées : ce fil, et les autres', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/DANS CETTE CONVERSATION/)
    expect(prompt).toMatch(/CANDIDAT/)
    // L'honnetete qui manquait : l'echo est local et volatile.
    expect(prompt).toMatch(/redémarre/i)
  })
})
