import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enregistrerTarifsCli,
  lireTarifsDuResultat,
  recoverUnpricedCallsUsage,
  sessionIdFromArgv,
  type RecoveredCallUsage,
  type TarifsAppris
} from './cli-usage-recovery'
import {
  applyRecoveredUsage,
  costSamplesFrom,
  summarizeCostSamples,
  type PromptCallRecord
} from './prompt-observability'

/**
 * « 7,00 $ + non exposé » — ce que l'utilisateur a sous les yeux quand un appel meurt sans que le
 * CLI ait eu le temps d'émettre son event `result` (tué par le watchdog). Le montant manquant n'est
 * PAS perdu : le CLI a écrit chaque message assistant, avec son `usage`, dans
 * `~/.claude/projects/<projet>/<session>.jsonl`. Ce test verrouille la récupération de ces valeurs.
 *
 * Mesure de terrain (2026-09-03, session b5f40533) qui a servi d'oracle : sur un appel
 * DÉJÀ tarifé par le CLI (2,2687 $), la même fenêtre lue dans le transcript rend exactement
 * `inputTokens` = 3 006 418 et `outputTokens` = 16 371 — les deux chiffres du journal, au token.
 */

/** Ligne assistant telle que le CLI l'écrit (forme relue sur un transcript réel). */
const ligne = (
  ts: string,
  requestId: string,
  usage: Record<string, number>,
  model = 'claude-opus-5'
): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    requestId,
    isSidechain: false,
    message: { model, usage }
  })

const USAGE_A = {
  input_tokens: 4,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  output_tokens: 100
}
const USAGE_B = {
  input_tokens: 2,
  cache_read_input_tokens: 500,
  cache_creation_input_tokens: 0,
  output_tokens: 60
}

/**
 * FENÊTRE : le transcript est un journal de SESSION, pas d'appel. Il contient donc le travail des
 * appels voisins — dont ceux que le provider a déjà tarifés. Les lignes `req-avant` et `req-apres`
 * sont l'entrée qui doit faire ÉCHOUER ce test si la récupération lisait le fichier entier
 * (999 999 et 888 888 tokens de sortie : impossibles à confondre avec un total juste).
 *
 * DOUBLON : `req-a` est écrit TROIS fois (partiels de streaming). C'est l'entrée qui doit faire
 * échouer ce test si la récupération sommait les lignes au lieu de dédoublonner par `requestId` —
 * observé sur le transcript réel, où 140 lignes assistant ne portent que 79 requêtes distinctes.
 */
function transcriptRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-cli-usage-'))
  const projet = join(root, 'C--Sources-AutoWinOS')
  mkdirSync(projet, { recursive: true })
  writeFileSync(
    join(projet, 'sess-1.jsonl'),
    [
      ligne('2026-09-02T10:00:00.000Z', 'req-avant', { ...USAGE_A, output_tokens: 999999 }),
      ligne('2026-09-02T12:00:00.000Z', 'req-a', USAGE_A),
      ligne('2026-09-02T12:00:01.000Z', 'req-a', USAGE_A),
      ligne('2026-09-02T12:00:02.000Z', 'req-a', USAGE_A),
      JSON.stringify({ type: 'user', timestamp: '2026-09-02T12:00:03.000Z', message: {} }),
      ligne('2026-09-02T12:01:00.000Z', 'req-b', USAGE_B),
      ligne('2026-09-02T13:00:00.000Z', 'req-apres', { ...USAGE_A, output_tokens: 888888 }),
      'pas du json'
    ].join('\n') + '\n',
    'utf8'
  )
  return root
}

const appelTue = (overrides: Partial<PromptCallRecord> = {}): PromptCallRecord =>
  ({
    id: 'call-tue',
    ts: '2026-09-02T12:05:00.000Z',
    conversationId: 'conv-1',
    turnId: 't1',
    iteration: 0,
    actor: 'orchestrator',
    provider: 'claude',
    model: 'opus',
    transport: 'claude CLI spawn argv',
    boundary: 'b',
    limitation: 'l',
    messages: [],
    options: { argv: ['-p', '--resume', 'sess-1', '--model', 'opus'] },
    response: '',
    status: 'failed',
    error: 'claude CLI fige (aucune sortie) - tue par le watchdog',
    durationMs: 600_000,
    ...overrides
  }) as PromptCallRecord

describe('session du CLI dans les arguments', () => {
  it('lit --resume et --session-id, et ne devine rien sans eux', () => {
    expect(sessionIdFromArgv(['-p', '--resume', 'abc'])).toBe('abc')
    expect(sessionIdFromArgv(['--session-id', 'def', '-p'])).toBe('def')
    expect(sessionIdFromArgv(['-p', '--model', 'opus'])).toBeUndefined()
    expect(sessionIdFromArgv(undefined)).toBeUndefined()
    // Un drapeau en fin de tableau n'a pas de valeur : ne pas rendre `undefined` casserait le lookup.
    expect(sessionIdFromArgv(['--resume'])).toBeUndefined()
  })
})

describe('récupération des tokens auprès du CLI', () => {
  it('additionne les requêtes de la fenêtre, chacune UNE fois', () => {
    const root = transcriptRoot()
    const recupere = recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [root] })
    const usage = recupere.get('call-tue') as RecoveredCallUsage

    expect(usage).toBeDefined()
    expect(usage.requests).toBe(2)
    // input TOTAL, cache inclus (invariant de `Usage`) : (4+1000+200) + (2+500+0)
    expect(usage.inputTokens).toBe(1706)
    expect(usage.outputTokens).toBe(160)
    expect(usage.cacheReadTokens).toBe(1500)
    expect(usage.cacheCreationTokens).toBe(200)
    expect(usage.model).toBe('claude-opus-5')
    // Tarif public opus : 6 frais + 200 écrits (1,25x) + 1500 relus (0,1x) + 160 sortis.
    expect(usage.estimatedUsd).toBeCloseTo(
      (6 * 5 + 200 * 5 * 1.25 + 1500 * 5 * 0.1 + 160 * 25) / 1_000_000,
      9
    )
  })

  it('tarife à 2x la part écrite pour 1 h que le transcript détaille', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cli-usage-1h-'))
    const projet = join(root, 'C--Sources-AutoWinOS')
    mkdirSync(projet, { recursive: true })
    // Forme relue sur un transcript réel du 2026-09-26 : `cache_creation` détaille la durée de vie.
    writeFileSync(
      join(projet, 'sess-1.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-02T12:00:00.000Z',
        requestId: 'req-1h',
        message: {
          model: 'claude-opus-5',
          usage: {
            input_tokens: 4,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 200,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
            output_tokens: 100
          }
        }
      }) + '\n',
      'utf8'
    )
    const usage = recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [root] }).get(
      'call-tue'
    ) as RecoveredCallUsage
    expect(usage.cacheCreationTokens).toBe(200)
    // 4 frais + 200 écrits pour 1 h (2x) + 1000 relus (0,1x) + 100 sortis.
    expect(usage.estimatedUsd).toBeCloseTo(
      (4 * 5 + 200 * 5 * 2 + 1000 * 5 * 0.1 + 100 * 25) / 1_000_000,
      9
    )
  })

  it("borne la fenêtre à l'appel PRÉCÉDENT quand la durée mesurée est absurde", () => {
    const root = transcriptRoot()
    // Vécu : le watchdog a écrit `durationMs` = 32 940 076 ms (9 h). Sans borne, la
    // fenêtre remonte avant un appel DÉJÀ tarifé et récupère ses tokens une seconde fois.
    const precedent = appelTue({
      id: 'call-tarife',
      ts: '2026-09-02T11:00:00.000Z',
      status: 'completed',
      usage: { inputTokens: 1204, outputTokens: 999999, costUsd: 1.5 }
    })
    const recupere = recoverUnpricedCallsUsage([precedent, appelTue({ durationMs: 32_940_076 })], {
      projectsRoots: [root]
    })

    expect(recupere.has('call-tarife')).toBe(false)
    // `req-avant` (10:00) est AVANT la fin de l'appel tarifé (11:00) : il reste hors fenêtre.
    expect(recupere.get('call-tue')?.outputTokens).toBe(160)
  })

  it('ne rend rien quand le transcript est absent — jamais un montant inventé', () => {
    const vide = mkdtempSync(join(tmpdir(), 'autowin-cli-usage-vide-'))
    expect(recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [vide] }).size).toBe(0)
  })

  it("ignore l'appel qui porte DÉJÀ un coût du provider", () => {
    const root = transcriptRoot()
    const tarife = appelTue({
      id: 'call-ok',
      status: 'completed',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.42 }
    })
    expect(recoverUnpricedCallsUsage([tarife], { projectsRoots: [root] }).size).toBe(0)
  })
})

describe('le total ne dit plus « non exposé » quand la valeur est récupérable', () => {
  it("porte les tokens récupérés et leur estimation sur la ligne de l'acteur", () => {
    const root = transcriptRoot()
    const appels = [appelTue()]
    const recupere = recoverUnpricedCallsUsage(appels, { projectsRoots: [root] })
    const rows = summarizeCostSamples(
      applyRecoveredUsage(costSamplesFrom(appels), recupere),
      'actor'
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'orchestrator',
      calls: 1,
      inputTokens: 1706,
      outputTokens: 160,
      unpricedCalls: 1,
      estimatedCalls: 1
    })
    expect(rows[0].estimatedUsd).toBeCloseTo(recupere.get('call-tue')!.estimatedUsd!, 9)
  })
})

/**
 * Ligne `result` RÉELLE du CLI Claude, copiée telle quelle de
 * `.autowin-data/autowin-os/run-stdout/c55319db-076c-4201-b8b7-bd8b98515a11.stdout.jsonl` (05/11).
 * Le CLI y facture lui-même chaque modèle : `modelUsage["claude-haiku-5-5"].costUSD` = 0,00093225 $,
 * `costBasis` « list ». En tokens pondérés (multiples d'un token d'entrée) : 2 frais + 2 923 écrits
 * pour 1 h (2×) + 13 095 relus (0,1×) + 433 sortis (5×) = 9 322,5, soit 0,10 $ le million.
 */
const RESULTAT_REEL =
  '{"duration_api_ms":4531,"stop_reason":"end_turn","session_id":"359a9232-e4c1-41d9-b6d0-a7511872587a","total_cost_usd":0.00093225,"usage":{"input_tokens":2,"cache_creation_input_tokens":2923,"cache_read_input_tokens":13095,"output_tokens":433,"output_tokens_details":{"thinking_tokens":420},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":2923,"ephemeral_5m_input_tokens":0},"inference_geo":"global","iterations":[{"input_tokens":2,"output_tokens":433,"cache_read_input_tokens":13095,"cache_creation_input_tokens":2923,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":2923},"type":"message"}],"speed":"standard","fallback_credit":null},"modelUsage":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":433,"cacheReadInputTokens":13095,"cacheCreationInputTokens":2923,"webSearchRequests":0,"costUSD":0.00093225,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":420,"cacheCreationEphemeral5mInputTokens":0,"cacheCreationEphemeral1hInputTokens":2923,"canonicalModel":"claude-haiku-5-5","provider":"firstParty","costBasis":"list"}},"permission_denials":[],"terminal_reason":"completed","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"safety_stops":0,"is_error":false,"num_turns":1,"subtype":"success","api_error_status":null,"result":"WORKFLOW: exploration","ttft_ms":4747,"type":"result","duration_ms":4776,"uuid":"cca20699-d8ed-4877-9f42-ad7173ad2d79","ttft_stream_ms":1407,"time_to_request_ms":247,"first_content_frame_ms":1408,"queued_turn_count":0,"result_index":0,"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":433,"cacheReadInputTokens":13095,"cacheCreationInputTokens":2923,"webSearchRequests":0,"costUSD":0.00093225,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":420,"cacheCreationEphemeral5mInputTokens":0,"cacheCreationEphemeral1hInputTokens":2923,"canonicalModel":"claude-haiku-5-5","provider":"firstParty","costBasis":"list"}},"credential_expires_at":"2026-11-10T07:39:36.560Z"}'

/**
 * Entrée RÉELLE `claude-haiku-5-5` de run-stdout/1fbc33e9-7b7e-482c-b083-7eca63aee289.stdout.jsonl.
 * Son `costUSD` (0,0119632 $) = 0,0019632 $ de tokens + 1 recherche web à 0,01 $ : appris tel quel,
 * il gonflerait le prix de Haiku 5.5 d'un facteur 6. Ni `costBasis` ni `provider`.
 */
const HAIKU_AVEC_RECHERCHE = {
  inputTokens: 14407,
  outputTokens: 1045,
  thinkingTokens: 498,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreationEphemeral5mInputTokens: 0,
  cacheCreationEphemeral1hInputTokens: 0,
  webSearchRequests: 1,
  costUSD: 0.0119632,
  contextWindow: 1000000,
  maxOutputTokens: 128000
}

/**
 * Entrée RÉELLE `claude-opus-5-5` SANS `costBasis` ni `provider`, de
 * run-stdout/2cd73fa5-4633-427b-8de8-cc7f79e06291.stdout.jsonl : 22 entrées sur 565 le 05/11 ont
 * cette forme, et leur `costUSD` tombe au centime sur le prix public (4 $ / 20 $, cache relu 0,05×).
 */
const OPUS_SANS_BASE = {
  inputTokens: 130,
  outputTokens: 58723,
  thinkingTokens: 25443,
  cacheReadInputTokens: 8029895,
  cacheCreationInputTokens: 276946,
  cacheCreationEphemeral5mInputTokens: 0,
  cacheCreationEphemeral1hInputTokens: 276946,
  webSearchRequests: 0,
  costUSD: 4.996527,
  contextWindow: 1000000,
  maxOutputTokens: 128000
}

const resultatAvec = (
  modele: string,
  entree: Record<string, unknown>
): Record<string, unknown> => ({
  type: 'result',
  modelUsage: { [modele]: entree }
})

/** Transcript d'UNE requête du modèle donné, aux tokens de la ligne réelle sauf surcharge. */
function transcriptDUneRequete(modele: string, usage: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-cli-prix-appris-'))
  const projet = join(root, 'D--AutoWinOS')
  mkdirSync(projet, { recursive: true })
  writeFileSync(
    join(projet, 'sess-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-09-02T12:00:00.000Z',
      requestId: 'req-1',
      message: {
        model: modele,
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 13095,
          cache_creation_input_tokens: 2923,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2923 },
          output_tokens: 433,
          ...usage
        }
      }
    }) + '\n',
    'utf8'
  )
  return root
}

describe('prix appris de ce que le CLI facture déjà (conv-1602)', () => {
  it('lit le prix par token pondéré dans une ligne réelle du CLI', () => {
    const tarifs = lireTarifsDuResultat(JSON.parse(RESULTAT_REEL))
    expect([...tarifs.keys()]).toEqual(['claude-haiku-5-5'])
    expect(tarifs.get('claude-haiku-5-5')! * 1_000_000).toBeCloseTo(0.1, 12)
  })

  /**
   * L'entrée qui doit faire ÉCHOUER ce test si l'estimation lisait la grille d'abord : la MÊME ligne
   * réelle, seul le nom du modèle changé en `claude-haiku-6` — un modèle sorti avant que la grille
   * soit relue. La grille le range dans la famille `haiku` (1 $ / 5 $), 10× le prix que le CLI a
   * facturé. C'est l'erreur vécue le 05/11 avec Haiku 5.5 : 0,0093225 $ estimés pour 0,00093225 $.
   */
  it("estime l'appel coupé au prix appris du CLI, et garde la grille en secours", () => {
    const tarifs: TarifsAppris = new Map()
    enregistrerTarifsCli(
      JSON.parse(RESULTAT_REEL.replaceAll('claude-haiku-5-5', 'claude-haiku-6')),
      tarifs
    )
    const root = transcriptDUneRequete('claude-haiku-6')

    const appris = recoverUnpricedCallsUsage([appelTue()], {
      projectsRoots: [root],
      tarifsAppris: tarifs
    })
    // Mêmes tokens que l'appel réellement facturé : l'estimation retombe sur sa facture.
    expect(appris.get('call-tue')!.estimatedUsd).toBeCloseTo(0.00093225, 12)

    // Jumeau : sans prix appris pour ce modèle, la grille tarife toujours (famille `haiku`).
    const grille = recoverUnpricedCallsUsage([appelTue()], {
      projectsRoots: [root],
      tarifsAppris: new Map()
    })
    expect(grille.get('call-tue')!.estimatedUsd).toBeCloseTo(0.0093225, 12)
  })

  it("le prix enregistré à la fin d'une réponse sert, sans option, à la récupération suivante", () => {
    // Nom propre à ce test : le magasin du processus est partagé entre les tests du fichier.
    enregistrerTarifsCli(
      JSON.parse(RESULTAT_REEL.replaceAll('claude-haiku-5-5', 'claude-haiku-6-defaut'))
    )
    const root = transcriptDUneRequete('claude-haiku-6-defaut')
    const usage = recoverUnpricedCallsUsage([appelTue()], { projectsRoots: [root] })
    expect(usage.get('call-tue')!.estimatedUsd).toBeCloseTo(0.00093225, 12)
  })

  it("n'apprend rien d'un coût qui contient une recherche web", () => {
    expect(lireTarifsDuResultat(resultatAvec('claude-haiku-5-5', HAIKU_AVEC_RECHERCHE)).size).toBe(
      0
    )
    // Jumeau : la même entrée sans la recherche (0,01 $ retirés) rend le prix de Haiku 5.5.
    const sansRecherche = { ...HAIKU_AVEC_RECHERCHE, webSearchRequests: 0, costUSD: 0.0019632 }
    const tarifs = lireTarifsDuResultat(resultatAvec('claude-haiku-5-5', sansRecherche))
    expect(tarifs.get('claude-haiku-5-5')! * 1_000_000).toBeCloseTo(0.1, 12)
  })

  it('accepte une entrée sans costBasis, refuse une autre base ou un autre fournisseur', () => {
    const tarifs = lireTarifsDuResultat(resultatAvec('claude-opus-5-5', OPUS_SANS_BASE))
    expect(tarifs.get('claude-opus-5-5')! * 1_000_000).toBeCloseTo(4, 9)
    const avecListe = { ...OPUS_SANS_BASE, costBasis: 'list', provider: 'firstParty' }
    expect(lireTarifsDuResultat(resultatAvec('claude-opus-5-5', avecListe)).size).toBe(1)
    const autreBase = { ...avecListe, costBasis: 'contract' }
    expect(lireTarifsDuResultat(resultatAvec('claude-opus-5-5', autreBase)).size).toBe(0)
    const autreFournisseur = { ...avecListe, provider: 'bedrock' }
    expect(lireTarifsDuResultat(resultatAvec('claude-opus-5-5', autreFournisseur)).size).toBe(0)
  })

  it('palier long : rien appris au-delà du seuil, une requête longue garde le prix de la grille', () => {
    const entree = JSON.parse(RESULTAT_REEL).modelUsage['claude-haiku-5-5'] as Record<
      string,
      number
    >
    // 100 000 tokens d'entrée au total : aucune requête n'a pu dépasser le seuil de Haiku 5.5.
    const auSeuil = { ...entree, inputTokens: 100_000 - 13095 - 2923 }
    expect(lireTarifsDuResultat(resultatAvec('claude-haiku-5-5', auSeuil)).size).toBe(1)
    // Un token de plus : une requête a peut-être été facturée au prix long, le rapport serait faux.
    const auDela = { ...auSeuil, inputTokens: auSeuil.inputTokens + 1 }
    expect(lireTarifsDuResultat(resultatAvec('claude-haiku-5-5', auDela)).size).toBe(0)

    // UNE requête de 150 000 frais : prix long de la grille (0,50 $ / 2,50 $), pas le prix court appris.
    const tarifs = lireTarifsDuResultat(JSON.parse(RESULTAT_REEL))
    const root = transcriptDUneRequete('claude-haiku-5-5', {
      input_tokens: 150_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 1000
    })
    const usage = recoverUnpricedCallsUsage([appelTue()], {
      projectsRoots: [root],
      tarifsAppris: tarifs
    })
    expect(usage.get('call-tue')!.estimatedUsd).toBeCloseTo(
      (150_000 * 0.5 + 1000 * 2.5) / 1_000_000,
      12
    )
  })
})
