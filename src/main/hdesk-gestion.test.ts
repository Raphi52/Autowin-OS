import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  bureauxGeres,
  creerBureau,
  fermerBureauGere,
  interpreterListeVivants,
  lireBureauxVivants,
  listerTousLesBureaux,
  scriptEnveloppeCreation,
  type DependancesCreation
} from './hdesk-gestion'
import type { DemandeFermeture, ResultatFermeture } from './hdesk-tv'
import { refusCreation } from '../shared/hdesk-gestion'

const RACINE = join('C:', 'autowin')
const vivantSauf =
  (...morts: number[]) =>
  (pid: number): boolean =>
    !morts.includes(pid)

function registre(fiches: Array<Record<string, unknown>>): string {
  const d = mkdtempSync(join(tmpdir(), 'hdesk-gestion-'))
  for (const f of fiches) writeFileSync(join(d, `${String(f.id)}.json`), JSON.stringify(f))
  return d
}

describe('vue Bureaux cachés — TOUS les bureaux, quel que soit le fil (conv-951)', () => {
  it('liste les bureaux de deux fils différents, exclut l’application morte, garde le bureau sans fiche', () => {
    const liste = listerTousLesBureaux(
      ['a', 'b', 'mort', 'orphelin'],
      [
        { id: 'a', travail: 'ZOX', conversationId: 'conv-1', pid: 10, lanceLe: '2026-10-16T10:00' },
        {
          id: 'b',
          travail: 'Teams',
          conversationId: 'conv-2',
          pid: 20,
          lanceLe: '2026-10-16T11:00'
        },
        { id: 'mort', travail: 'fini', conversationId: 'conv-1', pid: 30 }
      ],
      vivantSauf(30)
    )
    expect(liste.map((b) => b.id)).toEqual(['b', 'a', 'orphelin'])
    expect(liste.find((b) => b.id === 'a')).toMatchObject({ conversationId: 'conv-1', relie: true })
    expect(liste.find((b) => b.id === 'b')).toMatchObject({ conversationId: 'conv-2', relie: true })
    expect(liste.find((b) => b.id === 'orphelin')).toEqual({
      id: 'orphelin',
      travail: 'travail non relié',
      relie: false
    })
  })

  it('aucun bureau vivant → liste vide (l’écran affiche son état vide, pas une erreur)', () => {
    expect(listerTousLesBureaux([], [{ id: 'a', conversationId: 'conv-1', pid: 1 }])).toEqual([])
  })

  it('une liste illisible est une ERREUR, jamais une liste vide', async () => {
    expect(interpreterListeVivants('{"pret":true}\n{"bureaux":["x","y"]}')).toEqual({
      ok: true,
      vivants: ['x', 'y']
    })
    expect(interpreterListeVivants('', 'powershell absent')).toEqual({
      ok: false,
      message: 'Liste des bureaux illisible : powershell absent'
    })
    const r = await bureauxGeres(RACINE, registre([]), async () => ({
      ok: false as const,
      message: 'capture morte'
    }))
    expect(r).toEqual({ ok: false, message: 'capture morte' })
  })
})

describe('vue Bureaux cachés — Fermer passe le fil de la FICHE', () => {
  const resultat = (r: Partial<ResultatFermeture>): ResultatFermeture => ({
    ok: true,
    code: 0,
    ...r
  })

  it('le fil donné au script est celui de la fiche, jamais une valeur de l’écran', async () => {
    const d = registre([{ id: 'zox', conversationId: 'conv-autre', pid: 1 }])
    const fermer = vi.fn(async (_r: string, _d: DemandeFermeture) => resultat({ ferme: true }))
    const r = await fermerBureauGere(RACINE, 'zox', d, fermer)
    expect(fermer).toHaveBeenCalledWith(RACINE, { id: 'zox', conversationId: 'conv-autre' })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it('bureau déjà vide : succès sans erreur', async () => {
    const d = registre([{ id: 'zox', conversationId: 'conv-1' }])
    const r = await fermerBureauGere(RACINE, 'zox', d, async () => resultat({ dejaFerme: true }))
    expect(r).toMatchObject({ ok: true, dejaFerme: true })
  })

  it('fiche SANS fil : erreur, rien n’est lancé', async () => {
    const d = registre([{ id: 'zox', pid: 1 }])
    const fermer = vi.fn()
    const r = await fermerBureauGere(RACINE, 'zox', d, fermer)
    expect(fermer).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/fil/)
  })

  // conv-344 (scout n°1) : ce cas rendait « Ce bureau n'a pas de fiche » alors que le script sait
  // fermer ces bureaux depuis le 17/10 (-SansFiche, commit 41359673) — la vue ne le lui demandait pas.
  it('bureau sans fiche : fermé en mode « sans fiche », SANS fil — jumeau du cas avec fiche', async () => {
    const fermer = vi.fn(async (_r: string, _d: DemandeFermeture) =>
      resultat({ ferme: true, sansFiche: true })
    )
    const r = await fermerBureauGere(RACINE, 'ui-capture-7208', registre([]), fermer)
    expect(fermer).toHaveBeenCalledTimes(1)
    expect(fermer).toHaveBeenCalledWith(RACINE, { id: 'ui-capture-7208', sansFiche: true })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it('bureau sans fiche disparu entre la liste et le clic (code 2) : dit « n’existe plus », pas un échec', async () => {
    const r = await fermerBureauGere(RACINE, 'ui-capture-1', registre([]), async () => ({
      ok: false,
      code: 2,
      ferme: false,
      sansFiche: true,
      erreur: "Aucun bureau cache 'AutowinTest_ui-capture-1' vivant : rien n'a ete ferme."
    }))
    expect(r).toMatchObject({ ok: true, code: 2, dejaFerme: true })
    expect(r.message).toMatch(/n’existe plus/)
  })

  it('identifiant invalide : refus avant toute lecture', async () => {
    const fermer = vi.fn()
    expect((await fermerBureauGere(RACINE, '../x', registre([]), fermer)).ok).toBe(false)
    expect(fermer).not.toHaveBeenCalled()
  })

  it('refus du script : son message remonte tel quel', async () => {
    const d = registre([{ id: 'zox', conversationId: 'conv-1' }])
    const r = await fermerBureauGere(RACINE, 'zox', d, async () => ({
      ok: false,
      code: 6,
      survivants: [42]
    }))
    expect(r).toMatchObject({ ok: false, code: 6 })
    expect(r.message).toContain('42')
  })
})

/** Dépendances de création simulées : `etat` est ce que l'enveloppe écrirait dans son fichier. */
function depsCreation(
  etat: Record<string, unknown> | null,
  sortieLancement = '{"pid":4242,"horsJob":true}'
) {
  const executer = vi.fn(async (_args: string[]) => ({ code: 0, sortie: sortieLancement }))
  let t = 0
  const deps: DependancesCreation = {
    executer,
    lire: () => (etat ? JSON.stringify(etat) : null),
    supprimer: () => undefined,
    attendre: async (ms) => {
      t += ms
    },
    maintenant: () => t,
    fichierStatut: () => join(tmpdir(), 'statut.json')
  }
  return { deps, executer }
}

const enveloppeDecodee = (args: string[]): string => {
  const commande = args[args.indexOf('-Commande') + 1]
  return Buffer.from(commande.split('-EncodedCommand ')[1], 'base64').toString('utf16le')
}

describe('vue Bureaux cachés — Créer', () => {
  const demande = { id: 'zox2', executable: 'C:\\zox\\exe\\Zox.exe', travail: 'Essai ZOX' }

  it('passe par lancer-detache.ps1, lance hdesk-lancer.ps1 avec -Travail et -Conversation', async () => {
    const { deps, executer } = depsCreation({
      code: 0,
      sortie: '{"id":"zox2","pid":77,"pret":true}',
      erreur: ''
    })
    const r = await creerBureau(RACINE, demande, deps)
    expect(r).toEqual({ ok: true, id: 'zox2', pid: 77, message: 'Bureau « zox2 » prêt.' })
    const args = executer.mock.calls[0][0]
    expect(args).toContain(join(RACINE, 'scripts', 'lancer-detache.ps1'))
    const script = enveloppeDecodee(args)
    expect(script).toContain(join(RACINE, 'scripts', 'hdesk-lancer.ps1'))
    expect(script).toContain("-Travail 'Essai ZOX'")
    // Fil laissé vide → « manuel » : le lanceur refuse un bureau sans fil.
    expect(script).toContain("-Conversation 'manuel'")
  })

  it('le fil saisi est respecté, les apostrophes et guillemets survivent', () => {
    const script = scriptEnveloppeCreation(
      RACINE,
      { ...demande, travail: "l'essai", arguments: '"C:\\a b\\c.txt"', conversationId: 'conv-9' },
      'C:\\t\\s.json'
    )
    expect(script).toContain("-Travail 'l''essai'")
    expect(script).toContain('-Arguments \'"C:\\a b\\c.txt"\'')
    expect(script).toContain("-Conversation 'conv-9'")
  })

  it('identifiant occupé (code 5) : remonte l’identifiant libre proposé, sans relancer', async () => {
    const { deps, executer } = depsCreation({
      code: 5,
      sortie:
        '{"id":"zox2","pret":false,"pidOccupant":9,"conversationOccupante":"conv-1","travailOccupant":"ZOX","idLibre":"zox2-manuel-55","erreur":"Identifiant deja utilise"}',
      erreur: 'occupe'
    })
    const r = await creerBureau(RACINE, demande, deps)
    expect(r).toMatchObject({
      ok: false,
      code: 5,
      idLibre: 'zox2-manuel-55',
      travailOccupant: 'ZOX',
      conversationOccupante: 'conv-1'
    })
    expect(executer).toHaveBeenCalledTimes(1)
  })

  // conv-344 (scout n°3) : le lanceur rend 2 quand l'app meurt AVANT sa fenêtre (instance unique qui
  // passe la main, plantage au démarrage) — avant, 30 s d'attente puis « aucune fenêtre » (code 3).
  it('app arrêtée avant sa fenêtre (code 2) : le dit en clair, avec son code de sortie', async () => {
    const { deps } = depsCreation({
      code: 2,
      sortie:
        '{"id":"zox2","pret":false,"fenetresVisibles":0,"codeSortie":7,"journalWindows":[],"erreur":"arretee AVANT"}',
      erreur: 'arrete avant toute fenetre'
    })
    const r = await creerBureau(RACINE, demande, deps)
    expect(r).toMatchObject({ ok: false, code: 2 })
    expect(r.message).toMatch(/avant d’ouvrir sa fenêtre \(code de sortie 7\)/)
    expect(r.message).toMatch(/passé la main à une copie déjà ouverte/)
    expect(r.message).toMatch(/planté au démarrage/)
  })

  it('exécutable introuvable (code 1) : le message du lanceur est rendu tel quel', async () => {
    const { deps } = depsCreation({
      code: 1,
      sortie: '',
      erreur: 'Executable introuvable : C:\\x.exe'
    })
    expect(await creerBureau(RACINE, demande, deps)).toMatchObject({
      ok: false,
      code: 1,
      message: 'Executable introuvable : C:\\x.exe'
    })
  })

  it.each([
    ['identifiant vide', { ...demande, id: '  ' }],
    ['identifiant avec espace', { ...demande, id: 'mon bureau' }],
    ['identifiant accentué', { ...demande, id: 'bureau-é' }],
    ['identifiant avec /', { ...demande, id: 'a/b' }],
    ['exécutable vide', { ...demande, executable: '' }],
    ['libellé vide', { ...demande, travail: '   ' }],
    ['fil invalide', { ...demande, conversationId: 'conv 1' }]
  ])('%s : refusé sans aucun lancement', async (_cas, d) => {
    const { deps, executer } = depsCreation(null)
    const r = await creerBureau(RACINE, d, deps)
    expect(r).toMatchObject({ ok: false, code: null })
    expect(r.message).toBe(refusCreation(d))
    expect(executer).not.toHaveBeenCalled()
  })

  it('jumeau accepté : identifiant à tirets et soulignés, fil vide → manuel', () => {
    expect(refusCreation({ ...demande, id: 'Zox_2-b', conversationId: '' })).toBeNull()
  })

  it('le lanceur ne démarre pas : erreur, pas d’attente', async () => {
    const { deps } = depsCreation(null, '{"erreur":"Win32_Process.Create a rendu 9"}')
    const r = await creerBureau(RACINE, demande, deps)
    expect(r).toMatchObject({ ok: false, code: null })
    expect(r.message).toContain('Win32_Process.Create a rendu 9')
  })

  it('aucun verdict dans le délai : le dit, sans prétendre au succès', async () => {
    const { deps } = depsCreation(null)
    const r = await creerBureau(RACINE, demande, deps, 1000)
    expect(r).toMatchObject({ ok: false, code: null })
    expect(r.message).toMatch(/aucun verdict en 1 s/)
  })
})

// Vrai PowerShell, vrai WMI : prouve que l'enveloppe S'EXÉCUTE réellement (le bouton ⇄ répondait ok
// sans que son script ne tourne jamais — leçon du 2026-10-16). Aucun bureau n'est créé ici.
describe.skipIf(process.platform !== 'win32')('vue Bureaux cachés — chaîne réelle', () => {
  const racine = process.cwd()

  it('liste les bureaux vivants par un appel ponctuel', async () => {
    const r = await lireBureauxVivants(racine)
    expect(r.ok).toBe(true)
  }, 30_000)

  // Apostrophes TYPOGRAPHIQUES (’ ‘) : PowerShell les prend aussi pour des fins de chaîne. Courantes
  // en français (« l’essai »), elles cassaient l'enveloppe si seule « ' » était doublée.
  it('exécutable introuvable : le lanceur part par WMI et son refus revient, valeurs intactes', async () => {
    const exe = join(tmpdir(), `n’existe-pas-‘${process.pid}’.exe`)
    const r = await creerBureau(racine, {
      id: `test-gestion-introuvable-${process.pid}`,
      executable: exe,
      travail: "test d’un exécutable ‘introuvable’ et d'une apostrophe droite",
      arguments: '"C:\\un chemin\\avec espace.txt" -x’'
    })
    expect(r).toMatchObject({ ok: false, code: 1 })
    expect(r.message).toBe(`Executable introuvable : ${exe}`)
  }, 60_000)
})
