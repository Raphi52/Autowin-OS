/**
 * La publication de la présence (conv-1429, lot 1) : écrite pour de vrai dans un dossier temporaire,
 * avec une horloge et des minuteurs simulés pour le délai et le battement.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FORMAT_PRESENCE,
  PRESENCE_TAILLE_MAX,
  type AgentAPublier,
  type PresenceDuPoste
} from '../../shared/quartier-presence'
import {
  agentsAPublierLisibles,
  creerPublicationDeLaPresence,
  presenceAEcrire,
  type ReglageDeLaPresence
} from './quartier-presence'
import {
  creerDossierDuBoard,
  FICHIER_DU_REGLAGE,
  lireAnimalDuPoste,
  lirePartageDeLaPresence,
  lireTenueDuPoste
} from '../board/board-dossier'

/** Horloge et minuteurs à la main : `avancer` déclenche ce qui est dû, dans l'ordre. */
function horloge(debut = 1_800_000_000_000): {
  maintenant: () => number
  planifier: (fn: () => void, ms: number) => { annuler: () => void }
  avancer: (ms: number) => void
  enAttente: () => number
} {
  let t = debut
  let prochain = 0
  const minuteurs = new Map<number, { a: number; fn: () => void }>()
  return {
    maintenant: () => t,
    planifier(fn, ms) {
      const id = prochain++
      minuteurs.set(id, { a: t + ms, fn })
      return { annuler: () => minuteurs.delete(id) }
    },
    avancer(ms) {
      const fin = t + ms
      for (;;) {
        const dus = [...minuteurs.entries()].filter(([, m]) => m.a <= fin)
        if (!dus.length) break
        dus.sort((a, b) => a[1].a - b[1].a)
        const [id, m] = dus[0]
        minuteurs.delete(id)
        t = Math.max(t, m.a)
        m.fn()
      }
      t = fin
    },
    enAttente: () => minuteurs.size
  }
}

const agent = (n: number, extra: Partial<AgentAPublier> = {}): AgentAPublier => ({
  id: `conv-${n}`,
  titre: `Fil numéro ${n}`,
  phase: 'travail',
  metier: 'lire',
  depuis: 1_800_000_000_000 - n * 1000,
  ...extra
})

let racine: string
let partage: string

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'autowin-presence-'))
  partage = join(racine, 'partage')
  // Le dossier du Board existe ; le sous-dossier du poste est créé par l'écrivain.
  mkdirSync(partage)
})

afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function montage(
  reglage: Partial<ReglageDeLaPresence> = {},
  ecrire?: (fichier: string, contenu: string) => Promise<void>
) {
  const h = horloge()
  const r: ReglageDeLaPresence = { dossier: partage, nom: 'Alice', partager: true, ...reglage }
  const publication = creerPublicationDeLaPresence({
    reglage: () => r,
    poste: 'alice',
    maintenant: h.maintenant,
    planifier: h.planifier,
    ...(ecrire ? { ecrire } : {})
  })
  const fichier = join(partage, 'alice', 'presence.json')
  const lire = (): PresenceDuPoste => JSON.parse(readFileSync(fichier, 'utf8')) as PresenceDuPoste
  return { h, r, publication, fichier, lire }
}

describe('presence.json : le format', () => {
  it('écrit le format, le poste, le nom, la date et les agents, titres filtrés', async () => {
    const { publication, lire, h } = montage()
    publication.recevoir([
      agent(1, { titre: 'Corrige D:\\Projet\\src\\x.ts pour Lucie' }),
      agent(2, { titre: 'Une phrase ordinaire', phase: 'attente', metier: null })
    ])
    await publication.attendre()
    const lu = lire()
    expect(lu).toEqual({
      format: FORMAT_PRESENCE,
      poste: 'alice',
      nom: 'Alice',
      enregistreA: new Date(h.maintenant()).toISOString(),
      agents: [
        {
          id: 'conv-1',
          titre: 'Corrige … pour Lucie',
          phase: 'travail',
          metier: 'lire',
          depuis: new Date(1_800_000_000_000 - 1000).toISOString()
        },
        {
          id: 'conv-2',
          titre: 'Une phrase ordinaire',
          phase: 'attente',
          metier: null,
          depuis: new Date(1_800_000_000_000 - 2000).toISOString()
        }
      ]
    })
    expect(publication.etat()).toMatchObject({
      partager: true,
      dernier: { agents: 2, coupe: false }
    })
    expect(publication.etat().erreur).toBeUndefined()
  })

  it('coupe un titre à 80 caractères et garde 15 agents au plus, sous 16 Ko', async () => {
    const { publication, lire, fichier } = montage()
    publication.recevoir(
      Array.from({ length: 20 }, (_, i) => agent(i, { titre: '🦝 tanuki très bavard '.repeat(20) }))
    )
    await publication.attendre()
    const lu = lire()
    expect(lu.agents).toHaveLength(15)
    for (const a of lu.agents) expect(Array.from(a.titre ?? '').length).toBeLessThanOrEqual(80)
    expect(readFileSync(fichier).length).toBeLessThan(PRESENCE_TAILLE_MAX)
  })

  it('un fil privé est publié sans titre (D6)', async () => {
    const { publication, lire } = montage()
    publication.recevoir([agent(1, { titre: 'Secret de fabrication', prive: true })])
    await publication.attendre()
    const [a] = lire().agents
    expect(a).not.toHaveProperty('titre')
    expect(JSON.stringify(lire())).not.toContain('Secret')
  })

  it('partage coupé : { coupe: true, agents: [] }, et plus de battement (D6)', async () => {
    const { publication, lire, h, r } = montage({ partager: false })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(lire()).toMatchObject({ coupe: true, agents: [] })
    expect(JSON.stringify(lire())).not.toContain('Fil numéro')
    const date = lire().enregistreA
    h.avancer(10 * 60_000)
    await publication.attendre()
    expect(lire().enregistreA).toBe(date)
    // Rétabli : les agents reviennent et le battement reprend.
    r.partager = true
    publication.reglageChange()
    await publication.attendre()
    expect(lire().coupe).toBeUndefined()
    expect(lire().agents).toHaveLength(1)
  })

  it('le fichier est remplacé en entier : aucun fichier provisoire ne reste', async () => {
    const { publication } = montage()
    publication.recevoir([agent(1)])
    await publication.attendre()
    const restes = readdirSync(join(partage, 'alice')).filter((f) => f.endsWith('.tmp'))
    expect(restes).toEqual([])
  })
})

describe('presence.json : délai et battement', () => {
  it('deux changements rapprochés : une écriture, puis la suivante 5 s après', async () => {
    const { publication, lire, h } = montage()
    publication.recevoir([agent(1)])
    await publication.attendre()
    const premiere = lire().enregistreA
    h.avancer(1_000)
    publication.recevoir([agent(1), agent(2)])
    publication.recevoir([agent(1), agent(2), agent(3)])
    await publication.attendre()
    expect(lire().agents).toHaveLength(1)
    h.avancer(3_999)
    await publication.attendre()
    expect(lire().enregistreA).toBe(premiere)
    h.avancer(1)
    await publication.attendre()
    expect(lire().agents).toHaveLength(3)
  })

  it('un instantané inchangé ne réécrit pas ; le battement date le fichier toutes les 60 s', async () => {
    const { publication, lire, h } = montage()
    publication.recevoir([agent(1)])
    await publication.attendre()
    const premiere = lire().enregistreA
    h.avancer(10_000)
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(lire().enregistreA).toBe(premiere)
    h.avancer(50_000)
    await publication.attendre()
    expect(Date.parse(lire().enregistreA) - Date.parse(premiere)).toBe(60_000)
    h.avancer(60_000)
    await publication.attendre()
    expect(Date.parse(lire().enregistreA) - Date.parse(premiere)).toBe(120_000)
  })

  it('arrêtée, elle n’écrit plus et ne garde aucun minuteur', async () => {
    const { publication, lire, h } = montage()
    publication.recevoir([agent(1)])
    await publication.attendre()
    const date = lire().enregistreA
    publication.arreter()
    publication.recevoir([agent(2)])
    h.avancer(5 * 60_000)
    await publication.attendre()
    expect(lire().enregistreA).toBe(date)
    expect(h.enAttente()).toBe(0)
  })
})

describe('presence.json : un partage en panne ne bloque rien', () => {
  it('dossier injoignable : l’échec est gardé, aucune exception, et il est retenté', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { publication, h, r, fichier } = montage({ dossier: join(racine, 'absent') })
    expect(() => publication.recevoir([agent(1)])).not.toThrow()
    await publication.attendre()
    expect(publication.etat().erreur).toMatch(/introuvable ou injoignable/)
    // Le même échec au battement suivant ne se signale pas deux fois.
    h.avancer(60_000)
    await publication.attendre()
    expect(avertir).toHaveBeenCalledTimes(1)
    // Le partage revient : le battement suivant écrit et efface l'erreur.
    r.dossier = partage
    h.avancer(60_000)
    await publication.attendre()
    expect(existsSync(fichier)).toBe(true)
    expect(publication.etat().erreur).toBeUndefined()
  })

  it('une écriture qui échoue est gardée sans lever d’exception', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { publication } = montage({}, async () => {
      throw new Error('Accès refusé')
    })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(publication.etat().erreur).toBe('Accès refusé')
    expect(publication.etat().dernier).toBeUndefined()
  })

  it('sans dossier du Board, rien n’est écrit ; un dossier choisi ensuite le reçoit dans la minute', async () => {
    const { publication, h, r, fichier, lire } = montage({ dossier: null })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(publication.etat().fichier).toBeNull()
    expect(existsSync(join(partage, 'alice'))).toBe(false)
    // Aucun nouvel instantané (aucun agent ne bouge) : c'est le battement qui l'écrit.
    r.dossier = partage
    h.avancer(60_000)
    await publication.attendre()
    expect(publication.etat().fichier).toBe(fichier)
    expect(lire().agents.map((a) => a.id)).toEqual(['conv-1'])
  })
})

describe('agentsAPublierLisibles : la vue n’est pas une source sûre', () => {
  it('écarte un agent illisible et garde 15 agents au plus', () => {
    const lus = agentsAPublierLisibles([
      agent(1),
      { ...agent(2), id: '../../etc' },
      { ...agent(3), phase: 'danse' },
      { ...agent(4), depuis: Number.NaN },
      { ...agent(5), metier: 'Lire<script>' },
      { ...agent(6), titre: 42 },
      { ...agent(7), prive: 'oui' },
      null,
      'conv-8'
    ])
    expect(lus.map((a) => a.id)).toEqual(['conv-1', 'conv-5', 'conv-6', 'conv-7'])
    expect(lus[1].metier).toBeNull()
    expect(lus[2].titre).toBe('')
    expect(lus[3]).not.toHaveProperty('prive')
    expect(agentsAPublierLisibles(Array.from({ length: 30 }, (_, i) => agent(i)))).toHaveLength(15)
    expect(agentsAPublierLisibles('pas une liste')).toEqual([])
  })

  it('presenceAEcrire ne publie aucun agent quand le partage est coupé', () => {
    expect(presenceAEcrire([agent(1)], { nom: 'Alice', partager: false }, 'alice')).toEqual({
      format: FORMAT_PRESENCE,
      poste: 'alice',
      nom: 'Alice',
      coupe: true,
      agents: []
    })
  })
})

describe('le réglage partagerPresence, rangé dans le réglage du Board', () => {
  it('actif par défaut, coupé retenu sur le poste, et préservé par les autres réglages', async () => {
    expect(lirePartageDeLaPresence(racine)).toBe(true)
    const board = creerDossierDuBoard({ racine, utilisateur: 'alice' })
    expect(board.etat().partagerPresence).toBeUndefined()
    expect((await board.choisirPartagePresence(false)).partagerPresence).toBe(false)
    expect(lirePartageDeLaPresence(racine)).toBe(false)
    // Changer le nom ou oublier le dossier ne rallume pas le partage.
    await board.choisirNom('Alice M.')
    expect(lirePartageDeLaPresence(racine)).toBe(false)
    await board.effacer()
    expect(lirePartageDeLaPresence(racine)).toBe(false)
    // Relu au démarrage suivant.
    expect(creerDossierDuBoard({ racine, utilisateur: 'alice' }).etat().partagerPresence).toBe(
      false
    )
    await board.choisirPartagePresence(true)
    expect(lirePartageDeLaPresence(racine)).toBe(true)
    expect(JSON.parse(readFileSync(join(racine, FICHIER_DU_REGLAGE), 'utf8'))).not.toHaveProperty(
      'partagerPresence'
    )
  })

  it('un réglage illisible laisse le partage actif (D-9)', () => {
    writeFileSync(join(racine, FICHIER_DU_REGLAGE), '{ pas du json', 'utf8')
    expect(lirePartageDeLaPresence(racine)).toBe(true)
  })
})

describe("l'animal des agents du poste (conv-1537)", () => {
  it('écrit dans presence.json l’animal du réglage, que les collègues dessinent', async () => {
    const { publication, lire, r, h } = montage({ animal: 'renard' })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(lire().animal).toBe('renard')
    // Un changement de choix repart à la prochaine écriture permise, même sans agent qui bouge.
    r.animal = 'tanuki'
    publication.reglageChange()
    h.avancer(5_000)
    await publication.attendre()
    expect(lire().animal).toBe('tanuki')
  })

  it('n’écrit pas d’animal quand le partage est coupé : personne ne doit le voir', () => {
    expect(
      presenceAEcrire([agent(1)], { nom: 'Alice', partager: false, animal: 'renard' }, 'alice')
    ).not.toHaveProperty('animal')
  })

  it.each(['panda', 'panda-roux'] as const)('publie %s (conv-1546)', async (animal) => {
    const { publication, lire } = montage({ animal })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(lire().animal).toBe(animal)
    expect(
      presenceAEcrire([agent(1)], { nom: 'Alice', partager: true, animal }, 'alice').animal
    ).toBe(animal)
  })

  it('retenu sur le poste, relu au démarrage, et préservé par les autres réglages', async () => {
    expect(lireAnimalDuPoste(racine)).toBeNull()
    const board = creerDossierDuBoard({ racine, utilisateur: 'alice' })
    expect(board.etat().animal).toBeUndefined()
    expect((await board.choisirAnimal('renard')).animal).toBe('renard')
    expect(lireAnimalDuPoste(racine)).toBe('renard')
    // Le nom, le partage coupé ou l'oubli du dossier ne font pas perdre l'animal.
    await board.choisirNom('Alice M.')
    await board.choisirPartagePresence(false)
    await board.effacer()
    expect(lireAnimalDuPoste(racine)).toBe('renard')
    expect(creerDossierDuBoard({ racine, utilisateur: 'alice' }).etat().animal).toBe('renard')
    // Revenir au défaut retire la clé du fichier.
    expect((await board.choisirAnimal(null)).animal).toBeUndefined()
    expect(JSON.parse(readFileSync(join(racine, FICHIER_DU_REGLAGE), 'utf8'))).not.toHaveProperty(
      'animal'
    )
  })

  it('un animal inconnu dans le réglage se lit comme aucun choix', () => {
    writeFileSync(join(racine, FICHIER_DU_REGLAGE), JSON.stringify({ animal: 'dragon' }), 'utf8')
    expect(lireAnimalDuPoste(racine)).toBeNull()
  })
})

describe('la couleur de tenue des agents du poste (conv-1633)', () => {
  it('écrit dans presence.json la tenue du réglage, que les collègues dessinent', async () => {
    const { publication, lire, r, h } = montage({ animal: 'panda', tenue: 'bleu' })
    publication.recevoir([agent(1)])
    await publication.attendre()
    expect(lire().tenue).toBe('bleu')
    // Un changement de choix repart à la prochaine écriture permise, même sans agent qui bouge.
    r.tenue = 'rose'
    publication.reglageChange()
    h.avancer(5_000)
    await publication.attendre()
    expect(lire().tenue).toBe('rose')
    // Revenir à la tenue d'origine retire la clé : le collègue redessine la tenue peinte.
    delete r.tenue
    publication.reglageChange()
    h.avancer(5_000)
    await publication.attendre()
    expect(lire()).not.toHaveProperty('tenue')
  })

  it('n’écrit ni une tenue quand le partage est coupé, ni une couleur inconnue', () => {
    expect(
      presenceAEcrire([agent(1)], { nom: 'Alice', partager: false, tenue: 'rouge' }, 'alice')
    ).not.toHaveProperty('tenue')
    const piegee = 'noir<script>' as unknown as 'rouge'
    expect(
      presenceAEcrire([agent(1)], { nom: 'Alice', partager: true, tenue: piegee }, 'alice')
    ).not.toHaveProperty('tenue')
  })

  it('retenue sur le poste, relue au démarrage, et préservée par les autres réglages', async () => {
    expect(lireTenueDuPoste(racine)).toBeNull()
    const board = creerDossierDuBoard({ racine, utilisateur: 'alice' })
    expect(board.etat().tenue).toBeUndefined()
    expect((await board.choisirTenue('vert')).tenue).toBe('vert')
    expect(lireTenueDuPoste(racine)).toBe('vert')
    // L'animal, le nom, les masques, le partage coupé ou l'oubli du dossier ne font pas perdre la tenue.
    await board.choisirAnimal('renard')
    await board.choisirNom('Alice M.')
    await board.choisirMasquesPresence(['bob'])
    await board.choisirPartagePresence(false)
    await board.effacer()
    expect(lireTenueDuPoste(racine)).toBe('vert')
    expect(lireAnimalDuPoste(racine)).toBe('renard')
    expect(creerDossierDuBoard({ racine, utilisateur: 'alice' }).etat().tenue).toBe('vert')
    // Et choisir la tenue ne fait pas perdre l'animal.
    await board.choisirTenue('jaune')
    expect(lireAnimalDuPoste(racine)).toBe('renard')
    // Revenir à la tenue d'origine retire la clé du fichier.
    expect((await board.choisirTenue(null)).tenue).toBeUndefined()
    expect(JSON.parse(readFileSync(join(racine, FICHIER_DU_REGLAGE), 'utf8'))).not.toHaveProperty(
      'tenue'
    )
  })

  it('une couleur inconnue dans le réglage se lit comme aucun choix', () => {
    writeFileSync(join(racine, FICHIER_DU_REGLAGE), JSON.stringify({ tenue: 'noir' }), 'utf8')
    expect(lireTenueDuPoste(racine)).toBeNull()
  })
})
