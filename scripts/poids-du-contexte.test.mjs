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
  rapport
} from './poids-du-contexte.mjs'

const usage = (ctx) => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: ctx,
  cache_creation: { ephemeral_1h_input_tokens: 0 }
})
const etape = (id, ctx, bloc) =>
  JSON.stringify({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id, usage: usage(ctx), content: [bloc] }
  })
const resultat = (id, texte) =>
  JSON.stringify({
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: texte }] }
  })
const init = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-test' })

/**
 * Session de 4 étapes, aux chiffres calculables à la main :
 *  étape 0 : contexte 1 000 (le socle), appelle Read sur tout un fichier ;
 *  étape 1 : contexte 1 600 → +600 = l'appel Read et ses 400 lignes, appelle Bash `sed -n` ;
 *  étape 2 : contexte 1 700 → +100 = l'appel et la sortie du terminal, écrit du texte ;
 *  étape 3 : contexte 1 750 → +50 = le texte.
 */
function session() {
  const lignes400 = Array.from({ length: 400 }, (_, i) => `ligne ${i}`).join('\n')
  return [
    init,
    '{"type":"stream_event","event":{}}',
    etape('m0', 1000, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }),
    resultat('t1', lignes400),
    etape('m1', 1600, {
      type: 'tool_use',
      id: 't2',
      name: 'Bash',
      input: { command: 'sed -n 1,20p a.ts' }
    }),
    resultat('t2', 'x\ny'),
    etape('m2', 1700, { type: 'text', text: 'fini' }),
    etape('m3', 1750, { type: 'text', text: 'ok' })
  ]
}

describe('poids-du-contexte', () => {
  it('répartit chaque intervalle réel sur ses blocs et compte ses relectures', () => {
    const s = analyserSession(session())
    expect(s.etapes).toBe(4)
    expect(s.contexteRelu).toBe(1000 + 1600 + 1700 + 1750)
    const par = (cat) => s.blocs.filter((b) => b.categorie === cat)
    // Le socle est relu par les 4 étapes.
    expect(par('socle de départ')).toMatchObject([{ tokens: 1000, relectures: 4 }])
    // Déjà en mémoire de relecture dès la 1re étape (tout en cache_read) : 4 lectures à ×0,1,
    // et non une écriture à ×1,25 puis 3 relectures.
    expect(par('socle de départ')[0].cout).toBeCloseTo(400)
    // Les 600 tokens de l'intervalle 0→1 vont à Read (appel + sortie), relus par les étapes 1 à 3.
    const read = par('Read')
    expect(read.reduce((t, b) => t + b.tokens, 0)).toBeCloseTo(600)
    expect(read.every((b) => b.relectures === 3)).toBe(true)
    expect(read.find((b) => b.sortie)).toMatchObject({ lecture: 'Read', lignes: 400, entier: true })
    // La sortie du terminal est une lecture CIBLÉE : comptée comme lecture, jamais comme entière.
    expect(par('Bash / PowerShell').find((b) => b.sortie)).toMatchObject({
      lecture: 'terminal',
      entier: false
    })
    // Le dernier texte n'a été relu par aucune étape : il ne pèse rien.
    expect(par("texte de l'agent")).toHaveLength(1)
  })

  it('le total réparti égale la somme des contextes mesurés par le modèle', () => {
    const a = agreger([analyserSession(session())], 350)
    expect(a.relu).toBeCloseTo(a.mesureRelu)
    expect(a.lectures.Read).toMatchObject({ total: 1, entieres: 1, grosses: 1 })
    expect(a.lectures.terminal).toMatchObject({ total: 1, entieres: 0, grosses: 0 })
    // Read : 600 tokens × 3 relectures sur 6 050 relus.
    expect(a.lectures.Read.partReluGrosses).toBeCloseTo(1800 / 6050)
    expect(rapport(a)).toMatch(/Entières de plus de 350 lignes : \*\*1\*\*/)
  })

  it('une compaction arrête les relectures des anciens blocs', () => {
    const s = analyserSession([
      init,
      etape('m0', 1000, { type: 'text', text: 'abc' }),
      etape('m1', 5000, { type: 'text', text: 'def' }),
      etape('m2', 1200, { type: 'text', text: 'ghi' }),
      etape('m3', 1300, { type: 'text', text: 'jkl' })
    ])
    expect(s.compactions).toBe(1)
    expect(s.blocs.find((b) => b.categorie === 'socle de départ')).toMatchObject({ relectures: 2 })
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
      etape('m0', 100, { type: 'text', text: 'a' }),
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: 'x',
        message: { id: 'sous', usage: usage(9999), content: [] }
      }),
      etape('m1', 150, { type: 'text', text: 'b' })
    ])
    expect(s.etapes).toBe(2)
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
      {
        encoding: 'utf8'
      }
    )
    expect(sortie).toMatch(/1 sessions, 4 étapes/)
    expect(sortie).toMatch(/\| Read \|/)
  })
})
