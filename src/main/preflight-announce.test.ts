import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRAIN_GRACE_MS,
  decidePreflightAnnouncement,
  type AnnounceContext
} from './preflight-announce'
import type { PreflightResult } from './preflight'

const resultat = (rouges: string[] = []): PreflightResult => ({
  ok: rouges.length === 0,
  summary: rouges.length ? 'dégradé' : 'tout est prêt',
  checks: [
    { id: 'brain', label: 'brain_server (:8765)', ok: !rouges.includes('brain'), detail: 'injoignable — RAG désactivé' },
    { id: 'claude', label: 'CLI claude', ok: !rouges.includes('claude') },
    { id: 'codex-session', label: 'Session codex', ok: !rouges.includes('codex-session') }
  ] as PreflightResult['checks']
})

const ctx = (over: Partial<AnnounceContext> = {}): AnnounceContext => ({
  elapsedMs: 0,
  graceMs: DEFAULT_BRAIN_GRACE_MS,
  ...over
})

const detailBrain = (r: PreflightResult): string | undefined =>
  r.checks.find((c) => c.id === 'brain')?.detail

describe('se taire pendant que le Brain démarre', () => {
  it('un Brain encore froid ne déclenche AUCUNE alerte', () => {
    // C'est tout l'objet du changement : une alerte pour un service en train de démarrer apprend à
    // l'utilisateur à ignorer la bannière, et une alerte ignorée ne protège plus de rien.
    expect(decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 1_200 })).announce).toBe(
      false
    )
  })

  it('se taire jusqu’à la toute fin du délai, parler dès qu’il est atteint', () => {
    expect(
      decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 9_999 })).announce
    ).toBe(false)
    expect(
      decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 10_000 })).announce
    ).toBe(true)
  })

  it('le délai par défaut est de dix secondes', () => {
    expect(DEFAULT_BRAIN_GRACE_MS).toBe(10_000)
  })
})

describe('parler tout de suite de ce qui ne se répare pas seul', () => {
  it('une session CLI absente s’annonce sans attendre', () => {
    // Attendre dix secondes ne la fera pas apparaître : la retenir ne ferait que retarder.
    expect(
      decidePreflightAnnouncement(resultat(['codex-session']), ctx({ elapsedMs: 0 })).announce
    ).toBe(true)
  })

  it('un Brain froid ACCOMPAGNÉ d’un vrai problème ne masque pas ce dernier', () => {
    expect(
      decidePreflightAnnouncement(resultat(['brain', 'claude']), ctx({ elapsedMs: 0 })).announce
    ).toBe(true)
  })

  it('un démarrage entièrement vert s’annonce, pour effacer une bannière antérieure', () => {
    expect(decidePreflightAnnouncement(resultat([]), ctx({ elapsedMs: 0 })).announce).toBe(true)
  })
})

describe('quand on parle enfin, dire POURQUOI', () => {
  it('relaie la cause apprise par la tentative de démarrage', () => {
    // La première sonde ne pouvait pas le savoir ; la tentative de lancement, si.
    const decision = decidePreflightAnnouncement(
      resultat(['brain']),
      ctx({
        elapsedMs: 10_000,
        brainLaunch: { status: 'unavailable', detail: 'venv Python introuvable (C:\\py) — venv par machine à créer' }
      })
    )
    expect(detailBrain(decision.result)).toContain('venv Python introuvable')
    expect(detailBrain(decision.result)).toContain('après 10 s')
  })

  it('distingue « jamais démarré » de « démarré mais toujours pas prêt »', () => {
    const jamais = decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 10_000 }))
    const lent = decidePreflightAnnouncement(
      resultat(['brain']),
      ctx({ elapsedMs: 10_000, brainLaunch: { status: 'starting' } })
    )
    expect(detailBrain(jamais.result)).toContain('non démarré')
    expect(detailBrain(lent.result)).toContain('warm-up anormalement long')
  })

  it('n’écrase pas le détail des autres contrôles', () => {
    const decision = decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 10_000 }))
    expect(decision.result.checks.find((c) => c.id === 'claude')?.ok).toBe(true)
    expect(decision.result.checks).toHaveLength(3)
  })

  it('le détail générique du premier passage est REMPLACÉ, pas complété', () => {
    const decision = decidePreflightAnnouncement(resultat(['brain']), ctx({ elapsedMs: 10_000 }))
    expect(detailBrain(decision.result)).not.toContain('injoignable — RAG désactivé')
  })
})

describe('le démarrage de l’app consulte réellement cette politique', () => {
  // Une politique que personne n'applique laisse la bannière s'afficher comme avant.
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  it('la décision est prise AVANT de pousser le résultat au renderer', () => {
    const decide = index.indexOf('decidePreflightAnnouncement(raw, {')
    const pousse = index.indexOf("webContents.send('preflight:result'", decide)
    expect(decide).toBeGreaterThan(-1)
    expect(pousse).toBeGreaterThan(decide)
  })

  it('une décision de se taire coupe court', () => {
    expect(index).toMatch(/if \(!decision\.announce\) return/)
  })

  it('c’est le résultat ENRICHI qui part, pas le brut', () => {
    // Sinon le « pourquoi » calculé après la grâce n'atteindrait jamais l'écran.
    expect(index).toMatch(/const result = decision\.result/)
  })

  it('la tentative de démarrage est mémorisée pour nourrir ce pourquoi', () => {
    expect(index).toMatch(/brainLaunch = \{ status: r\.status, detail: r\.detail \}/)
  })
})
