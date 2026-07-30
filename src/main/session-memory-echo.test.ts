import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ECHO_MAX_BODY_CHARS,
  ECHO_MAX_FACTS,
  forgetEcho,
  noteRemembered,
  rememberedFacts,
  sessionMemoryBlock
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

describe('câblage — l’écho est réellement alimenté et réellement relu', () => {
  it('la commande remember alimente l’écho, et SEULEMENT sur un dépôt réel', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toContain('noteRemembered')
    // La garde qui compte : un refus ne doit pas entrer dans l'echo.
    expect(source).toMatch(/if \(outcome\.stored\)/)
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
