import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { ecrireLangueReglee } from './langue-reglage'
import { contenuDeNotificationDeFinDeTour } from './notification-fin-de-tour'
import { htmlDePopup } from './notification-popup'
import { runPreflight, type PreflightProbes } from './preflight'
import { decidePreflightAnnouncement } from './preflight-announce'
import { repairPreflightCheck } from './preflight-repair'

// `os.ts` tire Electron : même doublure que `os.test.ts`.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false, getVersion: () => '0.0.0', on: vi.fn() },
  Notification: class {},
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {}
}))

/**
 * LES TEXTES DU CŒUR SUIVENT LA LANGUE RÉGLÉE (conv-1170, lot 18) — par les vrais modules, pas par la
 * table seule : fin de tour (bulle et carte), Diagnostic (contrôles, résumé, Brain après la grâce,
 * résultat d'une réparation) et bulle d'abandon. Entrée qui fait échouer ce fichier : un de ces
 * modules qui garde son texte français en dur au lieu de passer par `traduireCoeur`.
 * Racine de données à soi : `langue.json` n'y est écrit que pour ce fichier.
 */
let racine: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'textes-coeur-branchement-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

const FIN = {
  titreDuFil: 'Corriger le test',
  fenetreRegardee: false,
  instanceDeTest: false,
  tourDeFond: false,
  cancelled: false
}

/** Tout est rouge : chaque contrôle sort son nom et son motif. */
const TOUT_ROUGE: PreflightProbes = {
  pingBrain: async () => false,
  hasBin: async () => false,
  claudeSession: () => 'absent',
  hasBrainToken: () => false,
  hasBrainRuntime: () => false
}

async function textesAffiches(): Promise<Record<string, string | undefined>> {
  const { contenuDeNotificationDAbandon } = await import('./os')
  const pret = contenuDeNotificationDeFinDeTour({ ...FIN, ok: true, text: '' })
  const echec = contenuDeNotificationDeFinDeTour({ ...FIN, ok: false })
  const carte = htmlDePopup(
    { title: 't', body: 'Fait', fil: 'Corriger le test', issue: 'prete' },
    '14:32'
  )
  const diagnostic = await runPreflight(TOUT_ROUGE, { conversationsEcartees: ['D:\\c.json'] })
  const check = (id: string) => diagnostic.checks.find((c) => c.id === id)
  const brainSeul = await runPreflight({
    ...TOUT_ROUGE,
    hasBin: async () => true,
    claudeSession: () => 'authenticated',
    hasBrainToken: () => true,
    hasBrainRuntime: () => true
  })
  const annonce = decidePreflightAnnouncement(brainSeul, { elapsedMs: 20_000, graceMs: 10_000 })
  const abandon = contenuDeNotificationDAbandon({ runId: 'run-1', tache: 'Traduire le cœur' })
  return {
    titrePret: pret?.title,
    corpsPret: pret?.body,
    titreEchec: echec?.title,
    corpsEchec: echec?.body,
    carte,
    labelSession: check('claude-session')?.label,
    detailToken: check('brain-token')?.detail,
    detailHistorique: check('conversations-ecartees')?.detail,
    resume: diagnostic.summary,
    brainApresGrace: annonce.result.checks.find((c) => c.id === 'brain')?.detail,
    reparation: (await repairPreflightCheck('brain-token')).detail,
    abandonTitre: abandon.title,
    abandonCorps: abandon.body
  }
}

describe('textes du cœur — anglais quand il est réglé, français sinon', () => {
  it('anglais réglé : la fin de tour, la carte, le Diagnostic et l’abandon parlent anglais', async () => {
    ecrireLangueReglee('en')
    const t = await textesAffiches()
    expect(t.titrePret).toBe('Corriger le test — answer ready')
    expect(t.corpsPret).toBe('The turn is finished.')
    expect(t.titreEchec).toBe('Corriger le test — the turn failed')
    expect(t.corpsEchec).toBe('The turn stopped on an error.')
    expect(t.carte).toContain('Answer ready · 14:32')
    expect(t.carte).toContain('title="Open the thread"')
    expect(t.carte).toContain('title="Close"')
    expect(t.carte).toContain('<html lang="en">')
    expect(t.labelSession).toBe('claude session')
    expect(t.detailToken).toBe('missing — set AUTOWIN_BRAIN_TOKEN')
    expect(t.detailHistorique).toBe(
      'unreadable at startup — set aside, NOTHING was deleted. File(s) kept: D:\\c.json'
    )
    expect(t.resume).toBe(
      'Incomplete configuration: Conversation history, brain_server (:8765), Brain runtime (Python), Brain token, claude CLI, claude session. Some features will be degraded.'
    )
    expect(t.brainApresGrace).toBe(
      'unreachable after 10 s — local service not started, RAG disabled'
    )
    expect(t.reparation).toBe('No known automatic repair for this prerequisite.')
    expect(t.abandonTitre).toBe('Autowin — a job was abandoned')
    expect(t.abandonCorps).toBe(
      '“Traduire le cœur” could not be integrated. Its work stays on its backup branch.'
    )
  })

  it('sans réglage, puis revenu au français : les mêmes textes, mot pour mot comme avant', async () => {
    const attendus = {
      titrePret: 'Corriger le test — réponse prête',
      corpsPret: 'Le tour est terminé.',
      titreEchec: 'Corriger le test — le tour a échoué',
      corpsEchec: 'Le tour s’est arrêté sur une erreur.',
      labelSession: 'Session claude',
      detailToken: 'absent — définir AUTOWIN_BRAIN_TOKEN',
      detailHistorique:
        "illisible au demarrage — mis de cote, RIEN n'a ete supprime. Fichier(s) conserve(s) : D:\\c.json",
      resume:
        'Configuration incomplète : Historique des conversations, brain_server (:8765), runtime Brain (Python), token Brain, CLI claude, Session claude. Certaines fonctions seront dégradées.',
      brainApresGrace: 'injoignable après 10 s — service local non démarré, RAG désactivé',
      reparation: 'Aucune réparation automatique connue pour ce prérequis.',
      abandonTitre: 'Autowin — un travail a ete abandonne',
      abandonCorps:
        "« Traduire le cœur » n'a pas pu etre integre. Son travail reste sur sa branche de secours."
    }
    for (const passe of ['sans réglage', 'revenu au français']) {
      if (passe === 'revenu au français') {
        ecrireLangueReglee('en')
        ecrireLangueReglee('fr')
      }
      const { carte, ...t } = await textesAffiches()
      expect(t, passe).toEqual(attendus)
      expect(carte).toContain('Réponse prête · 14:32')
      expect(carte).toContain('title="Ouvrir le fil"')
      expect(carte).toContain('title="Fermer"')
      expect(carte).toContain('<html lang="fr">')
    }
  })
})
