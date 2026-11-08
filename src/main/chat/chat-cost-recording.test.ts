import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CostAggregator } from '../dashboards/cost'
import { ChatTurnCostRecorder } from './chat-cost-recording'

describe('cout des tours de chat — le budget voit enfin la depense du superviseur', () => {
  it('un tour de chat tarife remonte dans budgetStatus().pricedSpendUsd', () => {
    const cost = new CostAggregator(100)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 1200, outputTokens: 300, costUsd: 2.5 },
      { provider: 'claude', model: 'claude-opus-5', conversationId: 'conv-467', turnId: 't1' }
    )
    const status = cost.budgetStatus()
    expect(status.pricedSpendUsd).toBeCloseTo(2.5, 6)
    expect(status.turns).toBe(1)
    expect(status.unpricedTurns).toBe(0)
  })

  it('les republications CUMULEES du meme tour ne comptent pas deux fois', () => {
    const cost = new CostAggregator(100)
    const recorder = new ChatTurnCostRecorder(cost)
    const id = { provider: 'claude', model: 'claude-opus-5' }
    expect(recorder.record({ inputTokens: 100, outputTokens: 10, costUsd: 1 }, id)).toBe(true)
    expect(recorder.record({ inputTokens: 100, outputTokens: 10, costUsd: 1 }, id)).toBe(false)
    expect(recorder.record({ inputTokens: 250, outputTokens: 40, costUsd: 3 }, id)).toBe(true)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(3, 6)
    expect(cost.byProvider().claude.costUsd).toBeCloseTo(3, 6)
  })

  // fix-ok: tours repris sous-comptés, mesurés sur le journal de tours (32 tours repris sur 34 à moins de
  // 95 % de leur usage). Ce test rouge reproduit l'écart : l'appel en cours, après l'appel repris, était écarté.
  it("un appel REPRIS garde son propre cumul : son coût s'ajoute à celui de l'appel en cours", () => {
    const cost = new CostAggregator(100)
    const recorder = new ChatTurnCostRecorder(cost)
    const tour = {
      provider: 'claude',
      model: 'claude-opus-5-5',
      conversationId: 'conv-1558',
      turnId: 't1'
    }
    // Appel coupé puis récupéré depuis son flux : son cumul est plus grand que celui qui suit.
    expect(
      recorder.record(
        { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 },
        { ...tour, appelId: 'appel-coupe' }
      )
    ).toBe(true)
    // Le processus relancé repart de zéro : son cumul est inférieur au précédent, il doit compter quand même.
    expect(
      recorder.record({ inputTokens: 1_500_000, outputTokens: 5_000, costUsd: 2.45 }, tour)
    ).toBe(true)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(18.45, 6)
  })

  it('republier un appel repris ne le compte pas deux fois', () => {
    const cost = new CostAggregator(100)
    const recorder = new ChatTurnCostRecorder(cost)
    const coupe = { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 }
    const identite = { provider: 'claude', turnId: 't1', appelId: 'appel-coupe' }
    expect(recorder.record(coupe, identite)).toBe(true)
    expect(recorder.record(coupe, identite)).toBe(false)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(16, 6)
  })

  // fix-ok: base d'un appel repris perdue à la relance — mesuré : le recorder neuf repartait de zéro et
  // recomptait l'appel repris. La base vient désormais du registre, relu du disque au démarrage.
  it('deux enregistreurs distincts ne comptent pas deux fois un appel repris', () => {
    const cost = new CostAggregator(100)
    const coupe = { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 }
    const identite = { provider: 'claude', turnId: 't1', appelId: 'appel-coupe' }
    expect(new ChatTurnCostRecorder(cost).record(coupe, identite)).toBe(true)
    expect(new ChatTurnCostRecorder(cost).record(coupe, identite)).toBe(false)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(16, 6)
  })

  it('après une relance, l’appel repris relu du disque ne se recompte pas, mais un cumul plus grand compte son écart', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'cout-repris-'))
    const chemin = join(dossier, 'cost.jsonl')
    const identite = { provider: 'claude', turnId: 't1', appelId: 'appel-coupe' }
    const avant = new CostAggregator(100, chemin)
    expect(
      new ChatTurnCostRecorder(avant).record(
        { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 },
        identite
      )
    ).toBe(true)
    await avant.flushPersist()
    // Processus relancé : registre relu du fichier, recorder neuf.
    const apres = new CostAggregator(100, chemin)
    expect(
      new ChatTurnCostRecorder(apres).record(
        { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 },
        identite
      )
    ).toBe(false)
    expect(apres.budgetStatus().pricedSpendUsd).toBeCloseTo(16, 6)
    // Jumeau accepté, même appel, cumul plus grand : seul l'écart s'ajoute.
    expect(
      new ChatTurnCostRecorder(apres).record(
        { inputTokens: 53_000_000, outputTokens: 160_000, costUsd: 17 },
        identite
      )
    ).toBe(true)
    expect(apres.budgetStatus().pricedSpendUsd).toBeCloseTo(17, 6)
  })

  // fix-ok: tours surcomptés — mesuré : 1 254 lignes superviseur pour 976 tours distincts sur 7 jours. Une
  // ligne par appel ou par règlement était comptée comme un tour ; le compte se fait par identifiant de tour.
  it('un appel repris puis l’appel en cours du MÊME tour comptent pour un seul tour', () => {
    const cost = new CostAggregator(100)
    const recorder = new ChatTurnCostRecorder(cost)
    const tour = { provider: 'claude', conversationId: 'fil-a', turnId: 't1' }
    recorder.record(
      { inputTokens: 52_000_000, outputTokens: 150_000, costUsd: 16 },
      { ...tour, appelId: 'appel-coupe' }
    )
    // L'appel en cours, sans identifiant d'appel repris, comme dans le tour réel.
    recorder.record({ inputTokens: 1_500_000, outputTokens: 5_000, costUsd: 2.45 }, tour)
    expect(cost.budgetStatus().turns).toBe(1)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(18.45, 6)
  })

  it('deux tours distincts restent deux tours', () => {
    // Forme de production : un enregistreur PAR TOUR (`runPilotChat`), même registre.
    const cost = new CostAggregator(100)
    const usage = { inputTokens: 100, outputTokens: 10, costUsd: 1 }
    new ChatTurnCostRecorder(cost).record(usage, { provider: 'claude', turnId: 't1' })
    new ChatTurnCostRecorder(cost).record(usage, { provider: 'claude', turnId: 't2' })
    expect(cost.budgetStatus().turns).toBe(2)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(2, 6)
  })

  it('un tour NON tarife est compte comme non tarife, pas comme gratuit', () => {
    const cost = new CostAggregator(100)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 500, outputTokens: 20, costUsd: null },
      { provider: 'claude' }
    )
    const status = cost.budgetStatus()
    expect(status.unpricedTurns).toBe(1)
    expect(status.spentIsPartial).toBe(true)
  })

  it('le pilote de chat CABLE bien le recorder sur os.cost', () => {
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    expect(source).toMatch(/new ChatTurnCostRecorder\(os\.cost\)/)
    // Les DEUX chemins de persistance d'usage du tour doivent alimenter le collecteur.
    expect(source.match(/chatCostRecorder\.record\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // Le tour repris compte son appel coupé sous sa propre clé, sinon son coût reste hors du ledger.
    expect(source).toMatch(/appelId: recovery\.call\.token/)
  })

  it("le role 'supervisor' apparait dans le journal de cout persiste", async () => {
    const path = join(process.env.TEMP ?? '/tmp', `cost-chat-${Date.now()}.jsonl`)
    const cost = new CostAggregator(undefined, path)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 10, outputTokens: 5, costUsd: 0.02 },
      { provider: 'claude' }
    )
    // Écriture DIFFÉRÉE depuis le 2026-09-12 (l'ancienne version figeait l'interface 9,4 s).
    await cost.flushPersist()
    expect(readFileSync(path, 'utf8')).toContain('"role":"supervisor"')
  })
})
