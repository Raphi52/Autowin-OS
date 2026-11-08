import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RunSummary } from './runs'
import {
  compteHorsFenetrePourLeChat,
  compterHorsFenetreARegarder,
  demandeUnRegard,
  LIMITE_RUNS_SNAPSHOT,
  scanRunsPourSnapshot,
  SEUIL_ROUGE_ANCIEN_JOURS
} from './runs-scan'

/**
 * LE COMPTEUR DU CHAT NE COMPTE QUE CE QUI DEMANDE UN REGARD.
 *
 * Compter tout le hors-fenêtre noyait le signal : les verts déjà validés et les rouges de plusieurs
 * semaines y restent, et le chiffre n'alerte plus personne. Le compte se limite donc à ce qui
 * attend encore une décision ou une correction.
 *
 * L'âge se lit dans le journal (date la plus ancienne), pas dans la date du fichier : une clôture
 * réécrit le RUN.md et le rajeunirait à tort.
 */

const JOUR = 86_400_000
const maintenant = Date.now()
const dateAvant = (jours: number): string =>
  new Date(maintenant - jours * JOUR).toISOString().slice(0, 10)

interface Fixture {
  nom: string
  status: string
  /** Âge écrit dans le journal, en jours. */
  joursDepuis: number
  /** Date du fichier, si elle diffère du journal (réécriture de clôture). */
  mtimeJoursDepuis?: number
  /** Cases cochées / total de la DoD. */
  dod?: [number, number]
  /** Ligne de clôture ajoutée au journal. */
  cloture?: string
  /** Autre ligne de journal (reprise, abandon) ajoutée après l'ouverture. */
  ligneDeJournal?: string
}

function ecrireRun(root: string, session: string, f: Fixture): void {
  const dir = join(root, session, `${f.nom}-workspace`)
  mkdirSync(dir, { recursive: true })
  const [coches, total] = f.dod ?? [1, 1]
  const criteres = Array.from(
    { length: total },
    (_, i) => `- [${i < coches ? 'x' : ' '}] critère ${i + 1}`
  ).join('\n')
  const journal = [
    `[${dateAvant(f.joursDepuis)}] Orchestration lancée depuis la conversation ${session}.`,
    f.ligneDeJournal,
    f.cloture
  ]
    .filter(Boolean)
    .join('\n')
  const p = join(dir, 'RUN.md')
  writeFileSync(
    p,
    `status: ${f.status}\nsession: ${session}\nregime: standard\n\n## Besoin\n${criteres}\n\n## Journal\n${journal}\n\n## Défauts\n`,
    'utf8'
  )
  const date = new Date(maintenant - (f.mtimeJoursDepuis ?? f.joursDepuis) * JOUR)
  utimesSync(p, date, date)
}

/**
 * 24 runs de fenêtre (verts, à l'instant : ils ne sont jamais « hors fenêtre ») puis 15 runs plus
 * anciens que tous ceux-là. Chaque cas listé ci-dessous compte ou non, selon la règle.
 */
function racineAvecHistorique(): string {
  const root = mkdtempSync(join(tmpdir(), 'runs-a-regarder-'))
  for (let i = 0; i < LIMITE_RUNS_SNAPSHOT; i += 1) {
    ecrireRun(root, 'conv-fenetre', { nom: `fenetre-${i}`, status: 'green', joursDepuis: 0 })
  }
  const anciens: Fixture[] = [
    // COMPTÉS
    { nom: 'rouge-10j', status: 'red', joursDepuis: 10, dod: [0, 2] },
    { nom: 'rouge-29j', status: 'red', joursDepuis: SEUIL_ROUGE_ANCIEN_JOURS - 1, dod: [0, 1] },
    { nom: 'ouvert-3j', status: 'open', joursDepuis: 3, dod: [0, 1] },
    { nom: 'rouge-dod-complete', status: 'red', joursDepuis: 10, dod: [2, 2] },
    {
      nom: 'attente-de-publication',
      status: 'interrupted',
      joursDepuis: 2,
      cloture: `[${dateAvant(2)}] Cycle de vie terminal: interrupted (en attente de publication) (900 ms).`
    },
    {
      // Reprise bloquée à l'intégration : la base a des fichiers non commités, personne ne les range.
      nom: 'integration-bloquee',
      status: 'interrupted',
      joursDepuis: 1,
      ligneDeJournal: `[${dateAvant(1)}] Reprise — gate BLOQUÉ: intégration locale non terminée; blocage d’intégration: base-dirty — cause: des fichiers non committés de la base bloquent la publication`
    },
    {
      // Jumeau de l'abandon ci-dessous : la phrase est CITÉE dans une note, elle n'est pas la ligne de
      // clôture. Ce rouge n'a donc pas été abandonné, et il compte.
      nom: 'rouge-10j-cite-la-mention',
      status: 'red',
      joursDepuis: 10,
      dod: [0, 2],
      ligneDeJournal: `[${dateAvant(10)}] Note : la phrase « Abandonné : l'app s'est arrêtée avant la clôture » est citée ici, sans clôture.`
    },
    // NON COMPTÉS
    { nom: 'rouge-31j', status: 'red', joursDepuis: SEUIL_ROUGE_ANCIEN_JOURS + 1 },
    {
      nom: 'rouge-reecrit-recemment',
      status: 'red',
      joursDepuis: 40,
      mtimeJoursDepuis: 5
    },
    { nom: 'vert-complet', status: 'green', joursDepuis: 3, dod: [2, 2] },
    { nom: 'vert-dod-incomplete', status: 'green', joursDepuis: 3, dod: [1, 2] },
    { nom: 'interrompu', status: 'interrupted', joursDepuis: 4 },
    {
      // Interrompu sans aucune cause écrite : ni publication, ni intégration bloquée.
      nom: 'abandonne-app-arretee',
      status: 'interrupted',
      joursDepuis: 2,
      ligneDeJournal: `[${dateAvant(2)}] Abandonné : l'app s'est arrêtée avant la clôture`
    },
    {
      // Rouge d'un ancien écrivain, clos par l'abandon : l'app s'est arrêtée sous lui, aucun verdict.
      // Une perte de travail, pas un échec : il ne demande pas de regard, même à moins de 30 jours.
      nom: 'rouge-10j-abandonne',
      status: 'red',
      joursDepuis: 10,
      dod: [0, 2],
      ligneDeJournal: `[${dateAvant(10)}] Abandonné : l'app s'est arrêtée avant la clôture, aucun verdict n'a été rendu.`
    },
    {
      nom: 'rouge-coupe-par-stop',
      status: 'red',
      joursDepuis: 6,
      // Même date que le reste du journal : seule la coupe par Stop doit l'exclure, pas son âge.
      cloture: `[${dateAvant(6)}] Orchestration en échec: [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)`
    }
  ]
  for (const f of anciens) ecrireRun(root, 'conv-ancien', f)
  return root
}

/**
 * La même racine, plus un RUN.md qu'on ne peut pas lire : un dossier porte son nom, donc `stat` le
 * trouve et `readFile` échoue vraiment (EISDIR), sans simulation. Il est le plus ancien, donc hors
 * fenêtre.
 */
function racineAvecIllisible(): string {
  const root = racineAvecHistorique()
  const illisible = join(root, 'conv-ancien-illisible', 'illisible-workspace', 'RUN.md')
  mkdirSync(illisible, { recursive: true })
  const date = new Date(maintenant - 500 * JOUR)
  utimesSync(illisible, date, date)
  return root
}

/**
 * Les 24 plus récents sont verts ; le RUN.md illisible est le PLUS récent, donc il tombe DANS la
 * fenêtre du chemin chaud, celle que le chat lit à chaque tour.
 */
function racineAvecIllisibleRecent(): string {
  const root = mkdtempSync(join(tmpdir(), 'runs-illisible-recent-'))
  for (let i = 0; i < LIMITE_RUNS_SNAPSHOT; i += 1) {
    ecrireRun(root, 'conv-fenetre', { nom: `fenetre-${i}`, status: 'green', joursDepuis: 0 })
  }
  const illisible = join(root, 'conv-recent', 'illisible-workspace', 'RUN.md')
  mkdirSync(illisible, { recursive: true })
  const date = new Date(maintenant + 60_000)
  utimesSync(illisible, date, date)
  return root
}

describe('demandeUnRegard — la règle, cas par cas', () => {
  const r = (over: Partial<RunSummary>): RunSummary => ({
    status: 'green',
    dodTotal: 1,
    dodChecked: 1,
    journalEvents: 0,
    defauts: 0,
    ...over
  })

  it('un rouge de moins de 30 jours demande un regard (borne du côté compté)', () => {
    expect(demandeUnRegard(r({ status: 'red', dodChecked: 0 }), SEUIL_ROUGE_ANCIEN_JOURS - 1)).toBe(
      true
    )
  })

  it('un rouge de plus de 30 jours ne demande plus de regard (borne du côté exclu)', () => {
    expect(demandeUnRegard(r({ status: 'red', dodChecked: 0 }), SEUIL_ROUGE_ANCIEN_JOURS + 1)).toBe(
      false
    )
  })

  it('un vert à DoD complète ne demande rien, même une semaine après', () => {
    expect(demandeUnRegard(r({}), 7)).toBe(false)
  })

  it('un vert à DoD incomplète ne demande rien : le juge a validé', () => {
    expect(demandeUnRegard(r({ dodTotal: 2, dodChecked: 1 }), 7)).toBe(false)
  })

  it('un run interrompu sans publication refusée ne demande rien', () => {
    expect(demandeUnRegard(r({ status: 'interrupted' }), 2)).toBe(false)
    expect(demandeUnRegard(r({ status: 'interrupted' }), 2, false)).toBe(false)
    expect(demandeUnRegard(r({ status: 'interrupted', interruption: 'stop' }), 2)).toBe(false)
    expect(demandeUnRegard(r({ status: 'interrupted', interruption: 'quota' }), 2)).toBe(false)
  })

  // fix-ok: cause mesurée — `isBlocked` ne compte aucun run `interrupted` : sans cette règle, une publication refusée sortirait du compte sans rien le dire.
  it('un run validé dont la publication a été refusée demande un regard : rien ne prouve qu’il est repris', () => {
    expect(demandeUnRegard(r({ status: 'interrupted', interruption: 'publication' }), 2)).toBe(true)
  })

  // fix-ok: cause mesurée — `demandeUnRegard` ne lisait que `interruption === 'publication'` : les reprises bloquées à l'intégration sortaient du compte sans rien le dire.
  it('un run interrompu dont la reprise a été bloquée à l’intégration demande un regard : la base ne se range pas seule', () => {
    expect(demandeUnRegard(r({ status: 'interrupted' }), 1, true)).toBe(true)
  })

  it('un rouge coupé par Stop ne demande rien : il est annulé, pas raté', () => {
    expect(demandeUnRegard(r({ status: 'red', dodChecked: 0, interruption: 'stop' }), 2)).toBe(
      false
    )
  })

  // fix-ok: cause mesurée — la règle ne lisait pas la mention d'abandon : deux rouges de moins de 30 jours dont le Journal porte `[date] Abandonné : l'app s'est arrêtée…` demandaient un regard à tort.
  it('un rouge de 10 jours dont le journal porte la mention d’abandon ne demande rien : aucun verdict, une perte', () => {
    expect(demandeUnRegard(r({ status: 'red', dodChecked: 0 }), 10, false, true)).toBe(false)
  })

  it('un statut illisible demande un regard, même ancien : un RUN.md corrompu doit rester visible', () => {
    expect(demandeUnRegard(r({ status: 'unknown', dodChecked: 0 }), 400)).toBe(true)
  })

  it('un run jamais clos (ouvert, sans fin) demande un regard, même ancien : seuls les rouges sortent', () => {
    expect(demandeUnRegard(r({ status: 'open', dodChecked: 0 }), 400)).toBe(true)
  })

  it('un vert qui attend la réponse de l’utilisateur demande un regard', () => {
    expect(demandeUnRegard(r({ decisionAttendue: true }), 5)).toBe(true)
  })
})

describe('compterHorsFenetreARegarder — ce que le chat compte vraiment', () => {
  it('compte les 7 travaux qui demandent un regard, sur 15 hors fenêtre', async () => {
    const root = racineAvecHistorique()
    expect(await compterHorsFenetreARegarder(root)).toBe(7)
  })

  it('le total hors fenêtre reste celui du scan (le Board le garde)', async () => {
    const root = racineAvecHistorique()
    expect((await scanRunsPourSnapshot(root)).horsFenetre).toBe(15)
  })

  // fix-ok: cause mesurée — le `catch` rendait null en silence : un RUN.md illisible sortait du compte sans trace. Ce test casse si le signal disparaît.
  it('un RUN.md illisible ne compte pas, mais le dit dans la console avec son chemin', async () => {
    const root = racineAvecIllisible()
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await compterHorsFenetreARegarder(root)).toBe(7)
      expect(avertir).toHaveBeenCalledWith(
        expect.stringMatching(/RUN\.md illisible.*illisible-workspace/),
        expect.anything()
      )
    } finally {
      avertir.mockRestore()
    }
  })
})

describe('scan des plus récents — un RUN.md illisible dans la fenêtre se voit', () => {
  // fix-ok: cause mesurée — le `catch` rendait null en silence : une fiche illisible disparaissait de la liste lue à chaque tour. Ce test casse si le signal disparaît.
  it('la fiche illisible est écartée de la liste, et le chemin est écrit dans la console', async () => {
    const root = racineAvecIllisibleRecent()
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fenetre = await scanRunsPourSnapshot(root)
      expect(fenetre).toHaveLength(LIMITE_RUNS_SNAPSHOT - 1)
      expect(avertir).toHaveBeenCalledWith(
        expect.stringMatching(/RUN\.md illisible.*illisible-workspace/),
        expect.anything()
      )
    } finally {
      avertir.mockRestore()
    }
  })
})

describe('chemin chaud — le compte n’ajoute aucune lecture au tour de chat', () => {
  it('le premier appel rend le total sans attendre le compte, puis le compte arrive', async () => {
    const root = racineAvecHistorique()
    const premier = await scanRunsPourSnapshot(root)
    expect(premier.horsFenetre).toBe(15)
    expect(premier.horsFenetreARegarder).toBeUndefined()
    await vi.waitFor(async () =>
      expect((await scanRunsPourSnapshot(root)).horsFenetreARegarder).toBe(7)
    )
  })

  // Garde de contrat : une fois calculé, un compte nul reste un nombre (0), jamais `undefined`.
  // C'est ce qui permet au chat de distinguer « rien à regarder » de « pas encore su ».
  it('un calcul qui ne trouve rien à regarder rend 0 une fois fini, jamais undefined', async () => {
    const root = racineAvecHistorique()
    const aRien = vi.fn(async () => 0)
    expect(compteHorsFenetrePourLeChat(root, aRien)).toBeUndefined()
    await vi.waitFor(() => expect(compteHorsFenetrePourLeChat(root, aRien)).toBe(0))
  })

  // Un recalcul en échec doit se voir : sans signal, un compte figé passerait pour exact.
  // fix-ok: cause mesurée — le `.catch` rendait le compte figé sans rien dire : un calcul en échec ressemblait à un compte exact. Ce test casse si le signal disparaît.
  it('un recalcul en échec se signale dans la console, au lieu de figer le compte en silence', async () => {
    const root = racineAvecHistorique()
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const enPanne = vi.fn(async () => {
        throw new Error('recalcul en panne (test)')
      })
      compteHorsFenetrePourLeChat(root, enPanne)
      await vi.waitFor(() =>
        expect(avertir).toHaveBeenCalledWith(
          expect.stringContaining('compteur du chat'),
          expect.objectContaining({ message: 'recalcul en panne (test)' })
        )
      )
      expect(enPanne).toHaveBeenCalledTimes(1)
    } finally {
      avertir.mockRestore()
    }
  })
})
