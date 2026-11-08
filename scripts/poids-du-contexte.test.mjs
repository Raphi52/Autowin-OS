import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  agreger,
  analyserSession,
  categorieOutil,
  familleCommande,
  lectureEntiereParCommande,
  rapport,
  SORTIE
} from './poids-du-contexte.mjs'

const OPUS = 'claude-opus-5-5'
// Prix d'Opus 5.5 en dollars par token (grille officielle du 2026-11-08) : écriture 5 min 5 $/M,
// relecture 0,20 $/M, sortie 20 $/M.
const ECRITURE5 = 5e-6
const RELECTURE = 0.2e-6
const SORTIE_PRIX = 20e-6

const usage = (ctx, { relu = ctx, ecrit5 = 0 } = {}) => ({
  input_tokens: ctx - relu - ecrit5,
  cache_creation_input_tokens: ecrit5,
  cache_read_input_tokens: relu,
  cache_creation: { ephemeral_5m_input_tokens: ecrit5, ephemeral_1h_input_tokens: 0 }
})
// Le CLI émet UN événement par bloc, tous sous le même identifiant de message et le même compteur.
const etape = (id, ctx, blocs, modele = OPUS, compte) =>
  (Array.isArray(blocs) ? blocs : [blocs]).map((bloc) =>
    JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id, model: modele, usage: compte || usage(ctx), content: [bloc] }
    })
  )
const resultat = (id, texte, enErreur = false) =>
  JSON.stringify({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, content: texte, is_error: enErreur }]
    }
  })
const init = JSON.stringify({ type: 'system', subtype: 'init', model: OPUS })
const lignes = (n) => Array.from({ length: n }, (_, i) => `ligne ${i}`).join('\n')

/**
 * Session de 4 étapes, aux chiffres calculables à la main :
 *  étape 0 : contexte 1 000 (le socle, déjà en mémoire), réfléchit PUIS appelle Read sur tout un
 *            fichier — deux événements, même message ;
 *  étape 1 : contexte 1 600 → +600 = réflexion, appel Read et ses 400 lignes ; appelle `sed -n` ;
 *  étape 2 : contexte 1 700 → +100 = l'appel et la sortie du terminal, écrit du texte ;
 *  étape 3 : contexte 1 750 → +50 = le texte.
 * Comme le CLI : ce qui est entré depuis l'étape d'avant s'ÉCRIT en mémoire, le reste s'y relit.
 */
const compteReel = (ctx, avant) => usage(ctx, { relu: avant, ecrit5: ctx - avant })
function session() {
  return [
    init,
    '{"type":"stream_event","event":{}}',
    ...etape(
      'm0',
      1000,
      [
        { type: 'thinking', thinking: 'je lis a.ts' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }
      ],
      OPUS,
      compteReel(1000, 1000)
    ),
    resultat('t1', lignes(400)),
    ...etape(
      'm1',
      1600,
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'sed -n 1,20p a.ts' } },
      OPUS,
      compteReel(1600, 1000)
    ),
    resultat('t2', 'x\ny'),
    ...etape('m2', 1700, { type: 'text', text: 'fini' }, OPUS, compteReel(1700, 1600)),
    ...etape('m3', 1750, { type: 'text', text: 'ok' }, OPUS, compteReel(1750, 1700))
  ]
}

describe('poids-du-contexte', () => {
  it('répartit chaque intervalle réel sur ses blocs et compte ses relectures', () => {
    const s = analyserSession(session())
    // Deux événements du même message ne font qu'UNE étape.
    expect(s.etapes).toBe(4)
    expect(s.contexteRelu).toBe(1000 + 1600 + 1700 + 1750)
    const par = (cat) => s.blocs.filter((b) => b.categorie === cat)
    expect(par('socle de départ')).toMatchObject([{ tokens: 1000, relectures: 4 }])
    // Les 600 tokens de l'intervalle 0→1 vont à la réflexion et à Read, relus par les étapes 1 à 3.
    const entres = [...par('Read'), ...par('réflexion')]
    expect(entres.reduce((t, b) => t + b.tokens, 0)).toBeCloseTo(600)
    expect(entres.every((b) => b.relectures === 3)).toBe(true)
    expect(par('réflexion')).toHaveLength(1)
    expect(par('Read').find((b) => b.sortie)).toMatchObject({
      lecture: 'Read',
      lignes: 400,
      entier: true
    })
    // La sortie du terminal est une lecture CIBLÉE : comptée comme lecture, jamais comme entière.
    expect(par('Bash / PowerShell').find((b) => b.sortie)).toMatchObject({
      lecture: 'terminal',
      entier: false
    })
    // Le dernier texte n'a été relu par aucune étape : il ne pèse rien.
    expect(par("texte de l'agent")).toHaveLength(1)
  })

  it('compte les dollars au prix du modèle : socle déjà en mémoire, bloc neuf écrit puis relu', () => {
    const s = analyserSession(session())
    const socle = s.blocs.find((b) => b.categorie === 'socle de départ')
    // Tout en relecture dès la 1re étape : 4 lectures à 0,20 $/M, jamais une écriture.
    expect(socle.usd).toBeCloseTo(4 * 1000 * RELECTURE, 12)
    // Un bloc neuf de l'intervalle 0→1 : écrit à 5 $/M à l'étape 1, relu aux étapes 2 et 3.
    const read = s.blocs.find((b) => b.categorie === 'Read' && b.sortie)
    expect(read.usd).toBeCloseTo(read.tokens * (ECRITURE5 + 2 * RELECTURE), 12)
    // Les étapes ont payé leurs compteurs exacts : 750 tokens écrits, 5 300 relus.
    expect(s.etapesUsd).toBeCloseTo(750 * ECRITURE5 + 5300 * RELECTURE, 12)
  })

  it('Haiku 5.5 paie ×5 toute étape dont le contexte dépasse 100 000 tokens', () => {
    const s = analyserSession([
      init,
      ...etape('m0', 90000, { type: 'text', text: 'a' }, 'claude-haiku-5-5'),
      ...etape('m1', 110000, { type: 'text', text: 'b' }, 'claude-haiku-5-5')
    ])
    // Relecture Haiku : 0,01 $/M ; ×5 sur la seconde étape seulement.
    expect(s.etapesUsd).toBeCloseTo(90000 * 0.01e-6 + 110000 * 0.01e-6 * 5, 12)
  })

  // Bilan de fin de tour du CLI : `local` = ce tour seul, `cumul` = toute la conversation.
  const bilanDe = ({ local, cumul = local, sortie = 300, annexes } = {}) =>
    JSON.stringify({
      type: 'result',
      total_cost_usd: 99,
      usage: { ...usage(1750), output_tokens: sortie },
      modelUsage: { [OPUS]: { costUSD: cumul } },
      model_usage_since_last_result: {
        [OPUS]: { costUSD: local },
        ...(annexes ? { 'claude-haiku-5-5': { costUSD: annexes } } : {})
      }
    })
  const finDeMessage = (id, sortie, reflexion) =>
    JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: null,
      api_message_id: id,
      event: {
        type: 'message_delta',
        usage: { output_tokens: sortie, output_tokens_details: { thinking_tokens: reflexion } }
      }
    })

  it('le total réparti égale les compteurs, et le coût local du bilan contrôle les dollars', () => {
    const s = analyserSession([...session(), bilanDe({ local: 0.0013, annexes: 0.0001 })])
    expect(s.sortieUsd).toBeCloseTo(300 * SORTIE_PRIX, 12)
    // Seul le modèle de la session est contrôlé ; un autre modèle du bilan est un appel annexe.
    expect(s.factureLocale).toBeCloseTo(0.0013, 12)
    expect(s.annexesUsd).toBeCloseTo(0.0001, 12)
    const a = agreger([s], 350)
    expect(a.relu).toBeCloseTo(a.mesureRelu)
    expect(a.controleUsd.blocs).toBeCloseTo(a.controleUsd.etapes, 9)
    expect(a.controleUsd.grille[OPUS]).toMatchObject({ sessions: 1 })
    // Sans fin de message lue, la sortie du bilan reste entière, non répartie.
    expect(a.types.find((t) => t.nom === `${SORTIE} — non attribuée`).usd).toBeCloseTo(
      300 * SORTIE_PRIX,
      12
    )
    expect(a.lectures.Read).toMatchObject({ total: 1, entieres: 1, grosses: 1 })
    expect(a.lectures.terminal).toMatchObject({ total: 1, entieres: 0, grosses: 0 })
    // Cumul = local : le fil n'a pas été repris, ses lectures sont toutes visibles.
    expect(s.reprise).toBe(false)
    expect(a.lecturesNonReprises).toMatchObject({ sessions: 1, Read: { grosses: 1 } })
    expect(rapport(a)).toMatch(/Entières de plus de 350 lignes : \*\*1\*\*/)
  })

  it('additionne les bilans de plusieurs tours dans un même fichier', () => {
    const s = analyserSession([
      ...session(),
      bilanDe({ local: 0.001, sortie: 100 }),
      bilanDe({ local: 0.002, cumul: 0.003, sortie: 200 })
    ])
    expect(s.factureLocale).toBeCloseTo(0.003, 12)
    expect(s.sortie).toBe(300)
    // La reprise se lit au PREMIER tour : le second a forcément un cumul plus grand que lui.
    expect(s.reprise).toBe(false)
  })

  it('compte la réflexion à ses tokens exacts, relue comme écrite', () => {
    const lignesSession = session()
    const apresM0 = lignesSession.findIndex((x) => x.includes('"t1"') && x.includes('tool_result'))
    // Fin de l'étape 0 : 100 tokens écrits, dont 60 de réflexion.
    lignesSession.splice(apresM0, 0, finDeMessage('m0', 100, 60))
    const s = analyserSession(lignesSession)
    expect(s.sortie).toBe(100)
    expect(s.etapesSansFin).toBe(3)
    expect(s.sortieUsd).toBeCloseTo(100 * SORTIE_PRIX, 12)
    // Écrit : les 60 de réflexion exactement ; les 40 autres vont au seul appel de l'étape.
    expect(s.sortieParType['réflexion']).toBeCloseTo(60 * SORTIE_PRIX, 12)
    expect(s.sortieParType["appels d'outils"]).toBeCloseTo(40 * SORTIE_PRIX, 12)
    // Relu : sur les 600 tokens entrés entre les étapes 0 et 1, la réflexion en pèse 60, pas le
    // prorata de son résumé ; l'appel et la sortie de Read se partagent les 540 autres.
    const reflexion = s.blocs.filter((b) => b.categorie === 'réflexion')
    expect(reflexion.reduce((t, b) => t + b.tokens, 0)).toBeCloseTo(60)
    const read = s.blocs.filter((b) => b.categorie === 'Read')
    expect(read.reduce((t, b) => t + b.tokens, 0)).toBeCloseTo(540)
  })

  it("une fin de message d'un autre message ne s'attribue à aucune étape", () => {
    const lignesSession = session()
    lignesSession.splice(3, 0, finDeMessage('autre', 5000, 0))
    const s = analyserSession(lignesSession)
    expect(s.finsOrphelines).toBe(1)
    expect(s.sortie).toBe(0)
  })

  it('un fil repris a un cumul plus grand que son tour : contrôlé, mais pas compté comme neuf', () => {
    const s = analyserSession([...session(), bilanDe({ local: 0.5, cumul: 26 })])
    expect(s.factureLocale).toBeCloseTo(0.5, 12)
    expect(s.reprise).toBe(true)
    expect(agreger([s]).lecturesNonReprises.sessions).toBe(0)
    // Sans bilan (session coupée), la reprise est inconnue : son socle peut cacher des lectures.
    const coupee = analyserSession(session())
    expect(coupee.reprise).toBeUndefined()
    expect(coupee.factureLocale).toBeUndefined()
    expect(agreger([coupee]).lecturesNonReprises.sessions).toBe(0)
  })

  it("chiffre ce que coûterait de repartir d'un fil neuf : gagnant à froid, perdant à chaud", () => {
    // Deux fils repris au même socle de 200 000 tokens, deux étapes chacun. Le premier revient après
    // l'expiration de la mémoire de relecture : 190 000 tokens réécrits à sa 1re étape. Le second
    // revient à temps : tout est relu.
    // Le CLI date chaque ligne et nomme sa session à l'ouverture : de quoi mesurer l'inactivité
    // entre deux passages d'une même session.
    const dater = (lignesSession, sid, iso) =>
      lignesSession.map((l) => {
        const o = JSON.parse(l)
        if (o.type === 'system') o.session_id = sid
        return JSON.stringify({ ...o, timestamp: iso })
      })
    const repris = (ecrit) => [
      init,
      ...etape('r0', 200_000, { type: 'text', text: 'je reprends' }, OPUS, {
        ...usage(200_000, { relu: 200_000 - ecrit, ecrit5: ecrit })
      }),
      ...etape('r1', 200_100, { type: 'text', text: 'fini' }, OPUS, compteReel(200_100, 200_000)),
      bilanDe({ local: 0.5, cumul: 26 })
    ]
    const neuf = (sid, iso) =>
      analyserSession(dater([...session(), bilanDe({ local: 0.5 })], sid, iso))
    // A : revenu après deux heures, la mémoire a expiré. B : revenu après 5 min, et pourtant tout
    // est réécrit — la mémoire a été CASSÉE. C : revenu après 2 min, tout est relu.
    const expire = analyserSession(dater(repris(190_000), 'A', '2026-11-08T12:00:00Z'))
    const casse = analyserSession(dater(repris(190_000), 'B', '2026-11-08T10:05:00Z'))
    const chaud = analyserSession(dater(repris(0), 'C', '2026-11-08T10:02:00Z'))
    const avant = ['A', 'B', 'C'].map((sid) => neuf(sid, '2026-11-08T10:00:00Z'))
    expect(expire).toMatchObject({ sessionId: 'A', socleCout: { froid: true } })
    expect(chaud.socleCout).toMatchObject({ froid: false })
    const toutes = [expire, casse, chaud, ...avant]
    const r = agreger(toutes).reprises
    expect(r).toMatchObject({ sessions: 3, froides: 2, expirees: 1, cassees: 1 })
    // Le socle payé par les fils repris : écritures de la 1re étape, relectures de la 1re, puis des suivantes.
    expect(r.ecritureFroideUsd).toBeCloseTo(2 * 190_000 * ECRITURE5, 12)
    expect(r.ecritureCasseeUsd).toBeCloseTo(190_000 * ECRITURE5, 12)
    expect(r.relecturePremiereUsd).toBeCloseTo((2 * 10_000 + 200_000) * RELECTURE, 12)
    expect(r.relecturesSuivantesUsd).toBeCloseTo(3 * 200_000 * RELECTURE, 12)
    // Un fil neuf repart du socle médian des sessions neuves (1 000) plus le fil renvoyé, au plus
    // 60 000 tokens (TOKENS_MAX_HISTORIQUE de src/main/chat/chat-turn-messages.ts).
    expect(r.socleApresCoupe).toBe(61_000)
    const apres = 61_000 * (ECRITURE5 + RELECTURE)
    // Seule la reprise EXPIRÉE se coupe : après une heure d'inactivité, l'app sait que la mémoire est
    // perdue ; la mémoire cassée, elle, se répare à sa cause.
    expect(r.coupeAFroid.sessions).toBe(1)
    expect(r.coupeAFroid.usd).toBeCloseTo(
      190_000 * ECRITURE5 + 10_000 * RELECTURE + 200_000 * RELECTURE - apres,
      12
    )
    // À chaud, repartir réécrit 61 000 tokens au lieu d'en relire 200 000 : c'est une perte.
    expect(r.coupeAChaud.sessions).toBe(1)
    expect(r.coupeAChaud.usd).toBeCloseTo(apres - 2 * 200_000 * RELECTURE, 12)
    expect(rapport(agreger(toutes))).toMatch(/## Fils repris[\s\S]*plus d’une heure[\s\S]*cassée/)
  })

  it('signale ce qui échappe au calcul au lieu de le deviner', () => {
    // Bilan sans coût local pour le modèle de la session : aucune facture, plutôt qu'une facture à 0.
    const sansLocal = JSON.stringify({
      type: 'result',
      usage: { ...usage(1750), output_tokens: 300 },
      modelUsage: { [OPUS]: { costUSD: 1 } },
      model_usage_since_last_result: {}
    })
    expect(analyserSession([...session(), sansLocal]).factureLocale).toBeUndefined()
    // Tours d'avant joués sur un autre modèle : c'est quand même un fil repris.
    const autreModele = JSON.stringify({
      type: 'result',
      usage: { ...usage(1750), output_tokens: 300 },
      modelUsage: { [OPUS]: { costUSD: 0.5 }, 'claude-haiku-5-5': { costUSD: 2 } },
      model_usage_since_last_result: { [OPUS]: { costUSD: 0.5 } }
    })
    expect(analyserSession([...session(), autreModele]).reprise).toBe(true)
    // Réflexion annoncée plus grosse que l'écart réel (900 pour 600) : plafonnée, et comptée.
    const lignesSession = session()
    const apresM0 = lignesSession.findIndex((x) => x.includes('"t1"') && x.includes('tool_result'))
    lignesSession.splice(apresM0, 0, finDeMessage('m0', 1000, 900), '{"type":"user","mess')
    const s = analyserSession(lignesSession)
    expect(s.reflexionsPlafonnees).toBe(1)
    expect(s.lignesIllisibles).toBe(1)
    const reflexion = s.blocs.filter((b) => b.categorie === 'réflexion')
    expect(reflexion.reduce((t, b) => t + b.tokens, 0)).toBeCloseTo(600)
    expect(rapport(agreger([s]))).toMatch(/réflexions plus grosses que l'écart réel : 1/)
  })

  it('une lecture ciblée ou en erreur ne compte pas comme lecture entière', () => {
    const s = analyserSession([
      init,
      ...etape('m0', 1000, [
        {
          type: 'tool_use',
          id: 'a',
          name: 'Read',
          input: { file_path: 'x', offset: 10, limit: 500 }
        },
        { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: 'y' } }
      ]),
      resultat('a', lignes(500)),
      resultat('b', 'File content exceeds maximum allowed tokens', true),
      ...etape('m1', 3000, { type: 'text', text: 'fin' })
    ])
    const a = agreger([s], 350)
    expect(a.lectures.Read).toMatchObject({ total: 1, entieres: 0, grosses: 0 })
  })

  it('une compaction arrête les relectures des anciens blocs', () => {
    const s = analyserSession([
      init,
      ...etape('m0', 1000, { type: 'text', text: 'abc' }),
      ...etape('m1', 5000, { type: 'text', text: 'def' }),
      ...etape('m2', 1200, { type: 'text', text: 'ghi' }),
      ...etape('m3', 1300, { type: 'text', text: 'jkl' })
    ])
    expect(s.compactions).toBe(1)
    expect(s.blocs.find((b) => b.categorie === 'socle de départ')).toMatchObject({
      relectures: 2
    })
    expect(s.blocs.find((b) => b.categorie === 'résumé de compaction')).toMatchObject({
      tokens: 1200,
      relectures: 2
    })
    expect(agreger([s]).relu).toBeCloseTo(s.contexteRelu)
  })

  it("ignore ce qui n'est pas une session Claude et la chaîne d'un sous-agent", () => {
    expect(analyserSession(['{"type":"autowin.survivable-exit","exit_code":0}'])).toBeUndefined()
    expect(analyserSession(['Tu es un juge outillé.'])).toBeUndefined()
    const s = analyserSession([
      init,
      ...etape('m0', 100, { type: 'text', text: 'a' }),
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: 'x',
        message: { id: 'sous', usage: usage(9999), content: [] }
      }),
      ...etape('m1', 150, { type: 'text', text: 'b' })
    ])
    expect(s.etapes).toBe(2)
    // Un modèle sans prix connu reste compté en tokens, sans dollars.
    const inconnu = analyserSession([init, ...etape('m0', 100, { type: 'text', text: 'a' }, 'x')])
    expect(inconnu.etapesUsd).toBeUndefined()
  })

  it('range les outils et les commandes', () => {
    expect(categorieOutil('mcp__autowin__verify')).toBe('outils Autowin')
    expect(categorieOutil('mcp__blender__look')).toBe('autres outils MCP')
    expect(categorieOutil('PowerShell')).toBe('Bash / PowerShell')
    expect(familleCommande('cd "D:/x" && cat a.ts')).toBe('lecture de fichier')
    expect(familleCommande('timeout 60 npx vitest run a.test.ts')).toBe('tests et build')
    expect(familleCommande('grep -n foo src')).toBe('recherche')
    expect(familleCommande('git status --short')).toBe('git')
    expect(familleCommande('echo ok')).toBe('autres')
    expect(lectureEntiereParCommande('cd /d/x && cat a.ts')).toBe(true)
    expect(lectureEntiereParCommande('timeout 5 cat a.ts')).toBe(true)
    expect(lectureEntiereParCommande('cat a.ts | head -20')).toBe(false)
    expect(lectureEntiereParCommande('Get-Content a.ts -TotalCount 50')).toBe(false)
    expect(lectureEntiereParCommande('Get-Content a.ts -Tail 20')).toBe(false)
    expect(lectureEntiereParCommande('sed -n 1,20p a.ts')).toBe(false)
  })

  it('rend un rapport depuis la ligne de commande, en lecture seule', () => {
    const data = mkdtempSync(join(tmpdir(), 'poids-'))
    mkdirSync(join(data, 'run-stdout'))
    writeFileSync(join(data, 'run-stdout', 'a.stdout.jsonl'), session().join('\n'))
    writeFileSync(
      join(data, 'run-stdout', 'a.stdout.jsonl.exit.json'),
      '{"type":"autowin.survivable-exit"}'
    )
    const sortie = execFileSync(
      process.execPath,
      [join(__dirname, 'poids-du-contexte.mjs'), '--data', data, '--tous'],
      { encoding: 'utf8' }
    )
    expect(sortie).toMatch(/1 sessions, 4 étapes/)
    expect(sortie).toMatch(/\| Read \|/)
  })
})
