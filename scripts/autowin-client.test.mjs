import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { demarrerPointEntreeLocal } from '../src/main/point-entree-local.ts'
import {
  attendreFinDuTour,
  CODES,
  creerAppeleur,
  DELAI_DEFAUT_S,
  ErreurClient,
  executer,
  lireArguments,
  lirePointEntree,
  MESSAGE_MAX_CAR
} from './autowin-client.mjs'

/**
 * Le client du point d'entrée local (conv-1144) : un test par cas limite du cadrage. Le script est
 * lancé par `spawn` (asynchrone), jamais par `spawnSync` : un `spawnSync` vers un serveur HTTP du
 * MÊME processus bloque la boucle qui devrait lui répondre.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'autowin-client.mjs')
const CATALOGUE = ['create_conversation', 'chat_send', 'conversation_read'].map((name) => ({
  name,
  description: name,
  args: {}
}))

const aFermer = []
const aEffacer = []
afterEach(async () => {
  while (aFermer.length) await aFermer.pop().arreter()
  while (aEffacer.length) rmSync(aEffacer.pop(), { recursive: true, force: true })
})
const dossierTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'autowin-client-'))
  aEffacer.push(d)
  return d
}

/** Un bus minimal : des fils en mémoire, un tour qui dure `dureeTourMs` puis répond. */
function fauxBus({ dureeTourMs = 50, reponse = 'OK', occupes = [] } = {}) {
  const fils = new Map([['conv-occupe', []]])
  const actifs = new Set(occupes)
  const appels = []
  let n = 0
  const exec = async (nom, args) => {
    appels.push([nom, args])
    if (nom === 'create_conversation') {
      const id = `conv-${++n}`
      fils.set(id, [])
      return { ok: true, data: { id, title: args.title } }
    }
    const messages = fils.get(args.id ?? args.conversationId)
    if (!messages)
      return { ok: false, error: `Conversation introuvable: ${args.id ?? args.conversationId}` }
    if (nom === 'conversation_read')
      return {
        ok: true,
        data: {
          id: args.id,
          messageCount: messages.length,
          ...(actifs.has(args.id) ? { tourEnCours: true } : {}),
          messages: messages.slice(-1)
        }
      }
    if (nom === 'chat_send') {
      const id = args.conversationId
      messages.push({ role: 'user', text: args.message })
      actifs.add(id)
      setTimeout(() => {
        messages.push({ role: 'assistant', text: reponse })
        actifs.delete(id)
      }, dureeTourMs)
      return { ok: true, data: { conversationId: id, envoye: true } }
    }
    return { ok: false, error: `inattendu : ${nom}` }
  }
  return { exec, appels, actifs }
}

async function serveur(bus) {
  const dossier = dossierTmp()
  const point = await demarrerPointEntreeLocal({
    dossierDonnees: dossier,
    catalogue: () => CATALOGUE,
    exec: bus.exec
  })
  aFermer.push(point)
  return { dossier, point }
}

function lancer(args) {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    enfant.stdout.on('data', (c) => (stdout += c))
    enfant.stderr.on('data', (c) => (stderr += c))
    enfant.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

const codeDe = async (promesse) => {
  try {
    await promesse
  } catch (e) {
    if (e instanceof ErreurClient) return { code: e.code, message: e.message }
    throw e
  }
  return { code: CODES.ok }
}

/** Un faux `appeler` qui rejoue une suite de lectures, sans réseau. */
function appeleurScripte(lectures) {
  const appels = []
  const appeler = async (nom, args) => {
    appels.push([nom, args])
    if (nom !== 'conversation_read') return { envoye: true }
    return lectures.length > 1 ? lectures.shift() : lectures[0]
  }
  return { appeler, appels }
}
/** Horloge factice : chaque `dormir` avance le temps sans attendre. */
function horloge() {
  let t = 0
  return { maintenant: () => t, dormir: async (ms) => void (t += ms) }
}

describe('autowin-client — app ou fichier absent', () => {
  it('sans fichier : « Autowin n’est pas lancé », code 3, par le vrai script', async () => {
    const r = await lancer(['--donnees', dossierTmp(), '--nouveau', '--message', 'x'])
    expect(r.code).toBe(CODES.absent)
    expect(r.stderr).toContain("Autowin n'est pas lancé")
  })

  it('fichier laissé par une session arrêtée (processus mort) : même code', () => {
    const d = dossierTmp()
    writeFileSync(
      join(d, 'point-entree-local.json'),
      JSON.stringify({ url: 'http://127.0.0.1:1/mcp', jeton: 'j', pid: 2147483 })
    )
    expect(() => lirePointEntree(d)).toThrow(expect.objectContaining({ code: CODES.absent }))
  })

  it('port mort : connexion refusée, même code', async () => {
    // Un port réellement libre : ouvert puis refermé.
    const port = await new Promise((r) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const p = s.address().port
        s.close(() => r(p))
      })
    })
    const appeler = creerAppeleur({
      url: `http://127.0.0.1:${port}/mcp`,
      jeton: 'j',
      fichier: 'f',
      dossier: 'd'
    })
    const r = await codeDe(appeler('conversation_read', { id: 'conv-1' }))
    expect(r.code).toBe(CODES.absent)
    expect(r.message).toContain('connexion refusée')
  })
})

describe('autowin-client — jeton', () => {
  it('faux jeton : code 4, et le jeton n’apparaît pas dans le message', async () => {
    const { point } = await serveur(fauxBus())
    const appeler = creerAppeleur({
      url: point.url,
      jeton: 'jeton-secret-faux',
      fichier: point.fichier,
      dossier: 'd'
    })
    const r = await codeDe(appeler('conversation_read', { id: 'conv-1' }))
    expect(r.code).toBe(CODES.jetonRefuse)
    expect(r.message).not.toContain('jeton-secret-faux')
  })
})

describe('autowin-client — le message', () => {
  it('vide ou fait d’espaces : refusé avant tout envoi, code 2', () => {
    for (const m of ['', '   \n '])
      expect(() => lireArguments(['--nouveau', '--message', m])).toThrow(
        expect.objectContaining({ code: CODES.usage })
      )
  })

  it('au-delà de 500 000 caractères : refus nommé, code 2 ; juste à la borne : accepté', () => {
    expect(() =>
      lireArguments(['--nouveau', '--message', 'a'.repeat(MESSAGE_MAX_CAR + 1)])
    ).toThrow(/trop long/)
    expect(
      lireArguments(['--nouveau', '--message', 'a'.repeat(MESSAGE_MAX_CAR)]).message
    ).toHaveLength(MESSAGE_MAX_CAR)
  })

  it('qui commence par « / » : transmis tel quel', async () => {
    const bus = fauxBus()
    const { point } = await serveur(bus)
    const appeler = creerAppeleur(lirePointEntree(dirname(point.fichier)))
    await executer(lireArguments(['--fil', 'conv-occupe', '--message', '/frame cadre ça']), {
      appeler
    })
    expect(bus.appels.find(([nom]) => nom === 'chat_send')[1].message).toBe('/frame cadre ça')
  })
})

describe('autowin-client — le fil visé', () => {
  it('inconnu : l’erreur de l’app remonte, code 1, rien n’est envoyé', async () => {
    const bus = fauxBus()
    const { point } = await serveur(bus)
    const appeler = creerAppeleur(lirePointEntree(dirname(point.fichier)))
    const r = await codeDe(
      executer(lireArguments(['--fil', 'conv-absent', '--message', 'x']), { appeler })
    )
    expect(r.code).toBe(CODES.erreur)
    expect(r.message).toContain('Conversation introuvable')
    expect(bus.appels.some(([nom]) => nom === 'chat_send')).toBe(false)
  })

  it('occupé : refusé SANS envoyer, code 5', async () => {
    const bus = fauxBus({ occupes: ['conv-occupe'] })
    const { point } = await serveur(bus)
    const appeler = creerAppeleur(lirePointEntree(dirname(point.fichier)))
    const r = await codeDe(
      executer(lireArguments(['--fil', 'conv-occupe', '--message', 'x']), { appeler })
    )
    expect(r.code).toBe(CODES.filOccupe)
    expect(bus.appels.some(([nom]) => nom === 'chat_send')).toBe(false)
  })

  it('même envoi répété : le premier part, le second voit le fil occupé', async () => {
    const bus = fauxBus({ dureeTourMs: 5_000 })
    const { point } = await serveur(bus)
    const appeler = creerAppeleur(lirePointEntree(dirname(point.fichier)))
    const options = lireArguments(['--fil', 'conv-occupe', '--message', 'x'])
    expect((await executer(options, { appeler })).code).toBe(CODES.ok)
    expect((await codeDe(executer(options, { appeler }))).code).toBe(CODES.filOccupe)
    expect(bus.appels.filter(([nom]) => nom === 'chat_send')).toHaveLength(1)
  })
})

describe('autowin-client — le délai d’attente', () => {
  it('absent, zéro, négatif ou non numérique : 600 s, et c’est dit', () => {
    expect(lireArguments(['--fil', 'c', '--attendre']).delaiS).toBe(DELAI_DEFAUT_S)
    for (const v of ['0', '-5', 'abc']) {
      const o = lireArguments(['--fil', 'c', '--attendre', '--delai', v])
      expect(o.delaiS).toBe(DELAI_DEFAUT_S)
      expect(o.avertissements[0]).toContain('invalide')
    }
    expect(lireArguments(['--fil', 'c', '--attendre', '--delai', '30']).delaiS).toBe(30)
  })

  it('atteint : code 6, le fil est nommé, le tour n’est pas arrêté', async () => {
    const { appeler, appels } = appeleurScripte([
      { messageCount: 1, tourEnCours: true, messages: [] }
    ])
    const r = await codeDe(
      attendreFinDuTour(appeler, 'conv-7', { avant: 0, delaiS: 10, ...horloge() })
    )
    expect(r.code).toBe(CODES.delaiDepasse)
    expect(r.message).toContain('conv-7')
    expect(appels.every(([nom]) => nom === 'conversation_read')).toBe(true)
  })
})

describe('autowin-client — l’issue du tour', () => {
  it('jamais vu « en cours » et aucune réponse : « tour non démarré », code 7', async () => {
    const { appeler } = appeleurScripte([{ messageCount: 0, messages: [] }])
    const r = await codeDe(
      attendreFinDuTour(appeler, 'conv-8', { avant: 0, delaiS: 600, ...horloge() })
    )
    expect(r.code).toBe(CODES.nonDemarre)
  })

  it('terminé en échec : l’erreur est affichée, code 8 — pas une réponse vide', async () => {
    const { appeler } = appeleurScripte([
      { messageCount: 1, tourEnCours: true, messages: [] },
      {
        messageCount: 2,
        messages: [
          { role: 'assistant', text: '', statut: 'failed', erreur: 'error_during_execution' }
        ]
      }
    ])
    const r = await codeDe(attendreFinDuTour(appeler, 'conv-9', { avant: 0, ...horloge() }))
    expect(r.code).toBe(CODES.tourEchoue)
    expect(r.message).toContain('error_during_execution')
  })

  /*
   * Mesuré sur l'app réelle (instance cachée, conv-1144) : un tour RÉUSSI se relit avec
   * `statut: 'completed'` — `conversation_read` n'omet que `done`. Le client le prenait pour un échec.
   * Statuts réels : `ChatTurnStatus` (src/shared/chat-turn.ts).
   */
  it('statut « completed » : c’est une réponse, pas un échec', async () => {
    const { appeler } = appeleurScripte([
      { messageCount: 2, messages: [{ role: 'assistant', text: 'OK', statut: 'completed' }] }
    ])
    const dernier = await attendreFinDuTour(appeler, 'conv-10', { avant: 0, ...horloge() })
    expect(dernier.text).toBe('OK')
  })

  it('statuts « cancelled », « interrupted », « streaming » hors tour : échec, code 8', async () => {
    for (const statut of ['cancelled', 'interrupted', 'streaming']) {
      const { appeler } = appeleurScripte([
        { messageCount: 2, messages: [{ role: 'assistant', text: 'à moitié', statut }] }
      ])
      const r = await codeDe(attendreFinDuTour(appeler, 'conv-11', { avant: 0, ...horloge() }))
      expect(r.code).toBe(CODES.tourEchoue)
      expect(r.message).toContain(statut)
    }
  })

  it('nominal, par le vrai script : crée, envoie, attend, affiche la réponse, code 0', async () => {
    const bus = fauxBus({ reponse: 'OK du fil' })
    const { dossier, point } = await serveur(bus)
    const r = await lancer([
      '--donnees',
      dossier,
      '--nouveau',
      '--message',
      'réponds OK',
      '--attendre'
    ])
    expect(r.code).toBe(CODES.ok)
    expect(r.stdout.trim()).toBe('OK du fil')
    expect(r.stderr).toContain('conv-1')
    // Le jeton ne sort sur aucun des deux flux.
    const jeton = lirePointEntree(dirname(point.fichier)).jeton
    expect(r.stdout + r.stderr).not.toContain(jeton)
    expect(bus.appels.map(([nom]) => nom).slice(0, 3)).toEqual([
      'create_conversation',
      'conversation_read',
      'chat_send'
    ])
  }, 20_000)
})
