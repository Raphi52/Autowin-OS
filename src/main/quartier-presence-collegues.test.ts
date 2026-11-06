import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { creerLecteurDePresence, prenomDe, presenceLue } from './quartier-presence-collegues'
import { PRESENCE_AGENTS_MAX, PRESENCE_TITRE_MAX } from '../shared/quartier-presence'

/*
 * LA RELECTURE DE LA PRÉSENCE DES COLLÈGUES (plan « Village commun », conv-1429, lot 2).
 *
 * Le contenu d'un `presence.json` de collègue est une DONNÉE d'un partage d'équipe : ces tests le
 * piègent (champ trop long, type faux, 500 agents, JSON invalide) et vérifient qu'il ressort borné,
 * ou écarté — jamais en exception.
 */
const MAINTENANT = Date.parse('2026-11-02T09:00:00.000Z')
const iso = (decalageMs = 0): string => new Date(MAINTENANT + decalageMs).toISOString()

let dossier: string
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'presence-collegues-'))
})
afterEach(() => rmSync(dossier, { recursive: true, force: true }))

function ecrire(poste: string, contenu: unknown): string {
  mkdirSync(join(dossier, poste), { recursive: true })
  const fichier = join(dossier, poste, 'presence.json')
  writeFileSync(fichier, typeof contenu === 'string' ? contenu : JSON.stringify(contenu), 'utf8')
  return fichier
}

const agent = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `conv-${n}`,
  titre: `Fil ${n}`,
  phase: 'travail',
  metier: 'lire',
  depuis: iso(-60_000),
  ...extra
})

const presence = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'autowin-presence/1',
  poste: 'collegue.a',
  nom: 'Alice Martin',
  enregistreA: iso(-30_000),
  agents: [agent(1)],
  ...extra
})

const lecteur = (poste = 'moi.poste', maintenant = () => MAINTENANT) =>
  creerLecteurDePresence({ ou: () => ({ dossier, poste }), maintenant, delaiMs: 4_000 })

describe('présence des collègues — relecture du partage', () => {
  it('rend un collègue valide, avec son prénom, ses agents, et le poste de SON sous-dossier', async () => {
    ecrire('collegue.a', presence({ poste: 'quelqu-un-d-autre' }))
    const { collegues, erreur } = await lecteur().lire()
    expect(erreur).toBeUndefined()
    expect(collegues).toEqual([
      {
        poste: 'collegue.a',
        nom: 'Alice Martin',
        prenom: 'Alice',
        agents: [
          {
            id: 'conv-1',
            titre: 'Fil 1',
            phase: 'travail',
            metier: 'lire',
            depuis: iso(-60_000)
          }
        ]
      }
    ])
  })

  it('ignore le sous-dossier du poste, quelle que soit la casse', async () => {
    ecrire('Moi.Poste', presence())
    ecrire('collegue.a', presence())
    const { collegues } = await lecteur('moi.poste').lire()
    expect(collegues.map((c) => c.poste)).toEqual(['collegue.a'])
  })

  it('ignore un fichier périmé (plus de 3 min) et un fichier daté dans le futur', async () => {
    ecrire('eteint', presence({ enregistreA: iso(-4 * 60_000) }))
    ecrire('futur', presence({ enregistreA: '2099-01-01T00:00:00.000Z' }))
    ecrire('vivant', presence({ enregistreA: iso(-2 * 60_000) }))
    const { collegues, erreur } = await lecteur().lire()
    expect(collegues.map((c) => c.poste)).toEqual(['vivant'])
    // Un poste éteint n'est pas une panne : aucun message.
    expect(erreur).toBeUndefined()
  })

  it('ignore un fichier coupé (D6), sans erreur', async () => {
    ecrire('discret', presence({ coupe: true, agents: [] }))
    const { collegues, erreur } = await lecteur().lire()
    expect(collegues).toEqual([])
    expect(erreur).toBeUndefined()
  })

  it('écarte un JSON invalide et un fichier de plus de 16 Ko (500 agents), en le disant', async () => {
    ecrire('casse', '{ pas du json')
    ecrire('enorme', presence({ agents: Array.from({ length: 500 }, (_, n) => agent(n)) }))
    ecrire('vivant', presence())
    const { collegues, erreur } = await lecteur().lire()
    expect(collegues.map((c) => c.poste)).toEqual(['vivant'])
    expect(erreur).toContain('casse (JSON invalide)')
    expect(erreur).toContain('enorme (fichier trop gros)')
  })

  it('borne un fichier piégé : champ trop long, type faux, trop d’agents, contrôles retirés', () => {
    const lu = presenceLue(
      JSON.stringify(
        presence({
          nom: `Bob\u0007\u001b[31m ${'x'.repeat(500)}`,
          agents: [
            agent(1, { titre: 't'.repeat(5_000) }),
            agent(2, { id: 'i'.repeat(500) }),
            agent(3, { phase: 'pirate' }),
            agent(4, { metier: 'rm -rf' }),
            agent(5, { titre: 42, metier: 7 }),
            agent(6, { depuis: 'hier' }),
            // Inversion de sens, contrôle C1, largeur nulle : retirés, le titre lisible reste.
            agent(7, { titre: 'Fil \u202eretourné\u0085\u200b' }),
            ...Array.from({ length: 30 }, (_, n) => agent(100 + n))
          ]
        })
      )
    )
    expect(lu.kind).toBe('presence')
    if (lu.kind !== 'presence') return
    expect(lu.nom.length).toBeLessThanOrEqual(80)
    expect([...lu.nom].some((c) => c.charCodeAt(0) < 32)).toBe(false)
    expect(lu.agents.find((a) => a.id === 'conv-7')?.titre).toBe('Fil retourné')
    // Au plus 15 agents lus ; parmi les 6 premiers, l'id trop long, la phase et la date fausses sont écartés.
    expect(lu.agents.length).toBeLessThanOrEqual(PRESENCE_AGENTS_MAX)
    const ids = lu.agents.map((a) => a.id)
    expect(ids).not.toContain('i'.repeat(500))
    expect(ids).not.toContain('conv-3')
    expect(ids).not.toContain('conv-6')
    const un = lu.agents.find((a) => a.id === 'conv-1')
    expect(un?.titre?.length).toBe(PRESENCE_TITRE_MAX)
    expect(lu.agents.find((a) => a.id === 'conv-4')?.metier).toBeNull()
    const cinq = lu.agents.find((a) => a.id === 'conv-5')
    expect(cinq?.metier).toBeNull()
    expect(cinq && 'titre' in cinq).toBe(false)
  })

  it('écarte un fichier dont un champ obligatoire a un type faux', async () => {
    ecrire('type-faux', presence({ agents: 'beaucoup' }))
    ecrire('format-faux', presence({ format: 'autowin-presence/2' }))
    const { collegues, erreur } = await lecteur().lire()
    expect(collegues).toEqual([])
    expect(erreur).toContain('type-faux (champ manquant ou de mauvais type)')
    expect(erreur).toContain('format-faux (format inconnu)')
  })

  it('ne rend jamais plus de 20 collègues', async () => {
    for (let n = 0; n < 25; n++) ecrire(`poste-${String(n).padStart(2, '0')}`, presence())
    const { collegues } = await lecteur().lire()
    expect(collegues).toHaveLength(20)
  })

  it('un partage injoignable rend une liste vide avec l’erreur, sans exception', async () => {
    const absent = creerLecteurDePresence({
      ou: () => ({ dossier: join(dossier, 'nulle-part'), poste: 'moi' }),
      maintenant: () => MAINTENANT
    })
    const resultat = await absent.lire()
    expect(resultat.collegues).toEqual([])
    expect(resultat.erreur).toContain('Dossier du Board injoignable')
  })

  it('aucun dossier du Board : aucun collègue, aucune erreur', async () => {
    const sans = creerLecteurDePresence({ ou: () => null })
    expect(await sans.lire()).toEqual({ collegues: [] })
  })

  it('deux relectures sont espacées d’au moins 4 s, et un fichier inchangé n’est pas relu', async () => {
    let maintenant = MAINTENANT
    const l = lecteur('moi', () => maintenant)
    const fichier = ecrire('collegue.a', presence())
    // Une date ronde, en secondes : la remettre à l'identique ensuite ne perd aucune fraction.
    const dateRonde = Math.floor(MAINTENANT / 1000) - 10
    utimesSync(fichier, dateRonde, dateRonde)
    expect((await l.lire()).collegues).toHaveLength(1)

    // Dans les 4 s : le résultat est celui d'avant, même si le partage a changé.
    ecrire('collegue.b', presence())
    maintenant += 3_000
    expect((await l.lire()).collegues).toHaveLength(1)

    // Fichier remplacé par un JSON cassé MAIS même date et même taille : le cache le garde.
    const taille = statSync(fichier).size
    const meme = '#'.repeat(taille)
    writeFileSync(fichier, meme, 'utf8')
    utimesSync(fichier, dateRonde, dateRonde)
    maintenant += 2_000
    const apres = await l.lire()
    expect(apres.collegues.map((c) => c.poste)).toEqual(['collegue.a', 'collegue.b'])
  })
})

describe("présence des collègues — l'animal choisi (conv-1537)", () => {
  it('rend l’animal écrit par le collègue', async () => {
    ecrire('collegue.a', presence({ animal: 'tanuki' }))
    const { collegues } = await lecteur().lire()
    expect(collegues[0].animal).toBe('tanuki')
  })

  it('un fichier sans animal, ou avec un animal inconnu, garde le collègue, sans animal', async () => {
    ecrire('collegue.a', presence())
    ecrire('collegue.b', presence({ animal: '<img src=x>' }))
    const { collegues, erreur } = await lecteur().lire()
    expect(erreur).toBeUndefined()
    expect(collegues.map((c) => c.poste)).toEqual(['collegue.a', 'collegue.b'])
    expect(collegues.every((c) => !('animal' in c))).toBe(true)
  })
})

describe('présence des collègues — la couleur de tenue choisie (conv-1633)', () => {
  it('rend la tenue écrite par le collègue', async () => {
    ecrire('collegue.a', presence({ animal: 'panda', tenue: 'violet' }))
    const { collegues } = await lecteur().lire()
    expect(collegues[0]).toMatchObject({ animal: 'panda', tenue: 'violet' })
  })

  it('un fichier sans tenue, ou avec une couleur inconnue, garde le collègue, sans tenue', async () => {
    ecrire('collegue.a', presence())
    ecrire('collegue.b', presence({ tenue: '#ff0000' }))
    const { collegues, erreur } = await lecteur().lire()
    expect(erreur).toBeUndefined()
    expect(collegues.map((c) => c.poste)).toEqual(['collegue.a', 'collegue.b'])
    expect(collegues.every((c) => !('tenue' in c))).toBe(true)
  })
})

describe('prénom', () => {
  it('rend le premier mot du nom', () => {
    expect(prenomDe('Alice Martin')).toBe('Alice')
    expect(prenomDe('  Bob  ')).toBe('Bob')
  })
})
