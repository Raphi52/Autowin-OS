import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scriptHookGardes } from './garde-git-destructeur'
import { NOM_JOURNAL_MESSAGES_FILS } from './messages-entre-fils'
import { BORNES_RAPPELS, rappelsDeLAppel } from './rappels-outils'

/*
 * conv-1457 : les règles d'AGENTS.md que rien ne bloque sont RAPPELÉES juste avant l'appel d'outil
 * qui les enfreint. Le fichier versionné `mods/autowin/rappels-outils.json` porte les règles ; le
 * script lancé avant chaque outil (scriptHookGardes) les lit à chaque appel.
 */
const FICHIER_DU_DEPOT = join(__dirname, '..', '..', 'mods', 'autowin', 'rappels-outils.json')

type Exemple = { outil: string; texte: string }
type Regle = {
  id: string
  outils: string
  motif: string
  sauf?: string
  texte: string
  source: string
  exemples: { oui: Exemple[]; non: Exemple[] }
}

const regle = (r: Partial<Regle> & { id: string }): Partial<Regle> => ({
  outils: 'Bash',
  motif: 'interdit',
  texte: `texte ${r.id}`,
  ...r
})
const appel = (
  regles: unknown,
  outil: string,
  champs: unknown[],
  deja: string[] = []
): { ids: string[]; texte: string } | undefined =>
  rappelsDeLAppel(
    typeof regles === 'string' ? regles : JSON.stringify(regles),
    outil,
    champs,
    deja,
    BORNES_RAPPELS
  )

describe('fichier de règles du dépôt', () => {
  const regles = JSON.parse(readFileSync(FICHIER_DU_DEPOT, 'utf8')) as Regle[]

  it('porte les trois règles d’AGENTS.md, chacune avec sa source', () => {
    expect(regles.map((r) => r.id)).toEqual([
      'conversations-json-direct',
      'tsc-p-a-la-main',
      'formatage-de-tout-le-depot'
    ])
    for (const r of regles) expect(r.source).toMatch(/AGENTS\.md/)
  })

  it.each(JSON.parse(readFileSync(FICHIER_DU_DEPOT, 'utf8')) as Regle[])(
    'règle $id : expressions valides et exemples tenus',
    (r) => {
      expect(() => new RegExp(r.outils)).not.toThrow()
      expect(() => new RegExp(r.motif, 'i')).not.toThrow()
      if (r.sauf) expect(() => new RegExp(r.sauf, 'i')).not.toThrow()
      expect(r.exemples.oui.length).toBeGreaterThan(0)
      expect(r.exemples.non.length).toBeGreaterThan(0)
      for (const e of r.exemples.oui)
        expect(appel([r], e.outil, [e.texte])?.ids, `oui : ${e.texte}`).toEqual([r.id])
      for (const e of r.exemples.non)
        expect(appel([r], e.outil, [e.texte]), `non : ${e.texte}`).toBeUndefined()
    }
  )
})

describe('rappelsDeLAppel — cas limites', () => {
  it('P1-2 : fichier vide, JSON cassé ou pas une liste → rien', () => {
    for (const brut of ['', '[{', '{}', 'null', '42'])
      expect(appel(brut, 'Bash', ['interdit'])).toBeUndefined()
  })
  it('P1-3 : liste vide → rien', () => {
    expect(appel([], 'Bash', ['interdit'])).toBeUndefined()
  })
  it('P1-4 : une règle mal typée est ignorée, les autres marchent', () => {
    const r = appel(
      [
        regle({ id: 'sans-motif', motif: undefined }),
        { ...regle({ id: 'motif-nombre' }), motif: 42 },
        regle({ id: 'texte-vide', texte: '   ' }),
        { ...regle({ id: 'outils-liste' }), outils: ['Bash'] },
        { ...regle({ id: 'sauf-nombre' }), sauf: 1 },
        null,
        'texte',
        regle({ id: 'bonne' })
      ],
      'Bash',
      ['interdit']
    )
    expect(r?.ids).toEqual(['bonne'])
  })
  it('P1-5 : une expression invalide n’emporte que sa règle', () => {
    const r = appel(
      [
        regle({ id: 'cassee', motif: '(' }),
        regle({ id: 'sauf-casse', sauf: '[' }),
        regle({ id: 'bonne' })
      ],
      'Bash',
      ['interdit']
    )
    expect(r?.ids).toEqual(['bonne'])
  })
  it('P1-6 : texte coupé par règle, total borné ; ce qui dépasse reste dû', () => {
    const long = 'x'.repeat(50_000)
    const r = appel(
      [
        regle({ id: 'a', texte: long }),
        regle({ id: 'b', texte: long }),
        regle({ id: 'c', texte: long }),
        regle({ id: 'd', texte: long })
      ],
      'Bash',
      ['interdit']
    )
    expect(r!.texte.length).toBeLessThanOrEqual(BORNES_RAPPELS.total)
    expect(r!.ids.length).toBeGreaterThan(0)
    expect(r!.ids.length).toBeLessThan(4)
    for (const morceau of r!.texte.split('\n\n'))
      expect(morceau.length).toBeLessThanOrEqual(BORNES_RAPPELS.parRegle + 40)
  })
  it('P1-7 : seuls les champs texte sont lus', () => {
    expect(
      appel([regle({ id: 'a' })], 'Bash', [42, null, undefined, { c: 'interdit' }, ['interdit']])
    ).toBeUndefined()
    expect(appel([regle({ id: 'a' })], 'Bash', [42, 'interdit'])?.ids).toEqual(['a'])
  })
  it('P1-8 : au-delà de la borne d’entrée, le texte n’est pas lu', () => {
    const loin = `${'a'.repeat(BORNES_RAPPELS.entree)} interdit`
    expect(appel([regle({ id: 'a' })], 'Bash', [loin])).toBeUndefined()
    expect(appel([regle({ id: 'a' })], 'Bash', [`interdit ${'a'.repeat(200_000)}`])?.ids).toEqual([
      'a'
    ])
  })
  it('P1-9 : une règle déjà donnée ne revient pas', () => {
    expect(appel([regle({ id: 'a' })], 'Bash', ['interdit'], ['a'])).toBeUndefined()
  })
  it('P1-10 : deux règles visées, dans l’ordre du fichier', () => {
    const r = appel([regle({ id: 'b', motif: 'deux' }), regle({ id: 'a', motif: 'un' })], 'Bash', [
      'un && deux'
    ])
    expect(r?.ids).toEqual(['b', 'a'])
    expect(r!.texte.indexOf('texte b')).toBeLessThan(r!.texte.indexOf('texte a'))
  })
  it('le nom d’outil est comparé en entier, pas en morceau', () => {
    expect(
      appel([regle({ id: 'a', outils: 'Read' })], 'ReadMcpResource', ['interdit'])
    ).toBeUndefined()
    expect(appel([regle({ id: 'a', outils: 'Read' })], 'Read', ['interdit'])?.ids).toEqual(['a'])
  })
})

describe('script réel lancé avant chaque outil', () => {
  let dir: string
  let script: string
  let regles: string
  const ecrireScript = (fichier: string | undefined): void =>
    writeFileSync(
      script,
      scriptHookGardes(() => undefined, undefined, [], undefined, fichier),
      'utf8'
    )
  const lancer = (entree: unknown): { status: number | null; stdout: string; stderr: string } => {
    const propre = { ...process.env }
    delete propre.AUTOWIN_CONVERSATION_ID
    const r = spawnSync(process.execPath, [script], {
      input: typeof entree === 'string' ? entree : JSON.stringify(entree),
      encoding: 'utf8',
      env: propre
    })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  const contexte = (stdout: string): string | undefined =>
    stdout ? JSON.parse(stdout).hookSpecificOutput.additionalContext : undefined
  const bash = (command: unknown): unknown => ({
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command }
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rappels-'))
    script = join(dir, 'garde.mjs')
    regles = join(dir, 'rappels-outils.json')
    writeFileSync(regles, readFileSync(FICHIER_DU_DEPOT, 'utf8'), 'utf8')
    ecrireScript(regles)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('le script reste du JavaScript valide', () => {
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
  })

  it('P1-14 + P1-9 : lecture directe → rappel, une seule fois par appel du CLI', () => {
    const r = lancer(bash('node -e "require(\'./.autowin-data/autowin-os/conversations.json\')"'))
    expect(r.status).toBe(0)
    expect(contexte(r.stdout)).toContain('conversation_read')
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(lancer(bash('cat conversations.json')).stdout).toBe('')
  })

  it('P1-14 : Read en majuscules → rappel ; tsc -p → rappel ; npm run typecheck → rien', () => {
    expect(
      contexte(
        lancer({ tool_name: 'Read', tool_input: { file_path: 'D:\\x\\Conversations.JSON' } }).stdout
      )
    ).toContain('conversation_read')
    expect(lancer(bash('npm run typecheck')).stdout).toBe('')
    expect(contexte(lancer(bash('npx tsc -p tsconfig.node.json')).stdout)).toContain(
      'npm run typecheck'
    )
  })

  it('P1-13 : mentions légitimes → rien', () => {
    for (const c of [
      'tail -n 3 conversations.json.journal.jsonl',
      'ls conversations.json.archive/',
      'npx prettier --write src/x.ts',
      'npm run typecheck'
    ])
      expect(lancer(bash(c)).stdout, c).toBe('')
  })

  it('P1-10 : deux règles dans un appel → deux rappels', () => {
    const t = contexte(lancer(bash('npx tsc -p x && npm run format')).stdout)!
    expect(t.indexOf('npm run typecheck')).toBeGreaterThan(-1)
    expect(t.indexOf('prettier')).toBeGreaterThan(t.indexOf('npm run typecheck'))
  })

  it('P1-12 : refus d’une garde → refus seul, et le rappel reste dû', () => {
    const r = lancer(bash('git reset --hard; cat conversations.json'))
    const sortie = JSON.parse(r.stdout).hookSpecificOutput
    expect(sortie.permissionDecision).toBe('deny')
    expect(sortie.additionalContext).toBeUndefined()
    expect(r.stdout).not.toContain('conversation_read')
    expect(contexte(lancer(bash('cat conversations.json')).stdout)).toContain('conversation_read')
  })

  it('P1-1 : fichier de règles absent → rien, code 0', () => {
    rmSync(regles)
    const r = lancer(bash('cat conversations.json'))
    expect(r).toMatchObject({ status: 0, stdout: '' })
  })

  it('P1-1 : aucun fichier passé au script → rien, code 0', () => {
    ecrireScript(undefined)
    expect(lancer(bash('cat conversations.json'))).toMatchObject({ status: 0, stdout: '' })
  })

  it('P1-2 / P1-5 : JSON cassé → rien ; expression invalide → les autres règles marchent', () => {
    writeFileSync(regles, '[{', 'utf8')
    expect(lancer(bash('cat conversations.json'))).toMatchObject({ status: 0, stdout: '' })
    writeFileSync(
      regles,
      JSON.stringify([
        { id: 'cassee', outils: 'Bash', motif: '(', texte: 'jamais' },
        { id: 'bonne', outils: 'Bash', motif: 'conversations', texte: 'rappel bon' }
      ]),
      'utf8'
    )
    const r = lancer(bash('cat conversations.json'))
    expect(r.status).toBe(0)
    expect(contexte(r.stdout)).toContain('rappel bon')
    expect(r.stdout).not.toContain('jamais')
  })

  it('P1-7 : entrée d’outil absente, pas un objet, ou champ non texte → code 0, aucun refus', () => {
    for (const e of [
      { tool_name: 'Bash' },
      { tool_name: 'Bash', tool_input: 'conversations.json' },
      { tool_name: 'Bash', tool_input: { command: 42 } },
      { tool_name: 'Read', tool_input: { file_path: ['conversations.json'] } },
      'pas du json'
    ]) {
      const r = lancer(e)
      expect(r.status, JSON.stringify(e)).toBe(0)
      expect(r.stdout, JSON.stringify(e)).toBe('')
    }
  })

  it('P1-8 : heredoc de données énorme → son texte n’est pas lu', () => {
    const corps = `${'ligne de donnees\n'.repeat(12_000)}conversations.json\n`
    const r = lancer(bash(`cat > notes.txt <<'EOF'\n${corps}EOF`))
    expect(r).toMatchObject({ status: 0, stdout: '' })
  })

  it('P1-11 : état corrompu ou impossible à écrire → le rappel est donné quand même', () => {
    writeFileSync(join(dir, 'rappels-donnes.json'), '{pas une liste', 'utf8')
    expect(contexte(lancer(bash('cat conversations.json')).stdout)).toContain('conversation_read')
    rmSync(join(dir, 'rappels-donnes.json'))
    mkdirSync(join(dir, 'rappels-donnes.json'))
    // Commande différente à chaque fois : trois appels identiques d'affilée seraient refusés par le
    // détecteur de boucle (conv-58), qui passe avant les rappels.
    for (let i = 0; i < 2; i++) {
      const r = lancer(bash(`cat conversations.json # essai ${i}`))
      expect(r.status).toBe(0)
      expect(contexte(r.stdout)).toContain('conversation_read')
    }
  })

  it('une règle ajoutée au fichier vaut dès l’appel suivant', () => {
    expect(lancer(bash('rm -rf build')).stdout).toBe('')
    writeFileSync(
      regles,
      JSON.stringify([{ id: 'neuve', outils: 'Bash', motif: 'rm -rf', texte: 'rappel neuf' }]),
      'utf8'
    )
    expect(contexte(lancer(bash('rm -rf build')).stdout)).toContain('rappel neuf')
  })

  it('les messages en attente partent toujours, les rappels à la suite', () => {
    writeFileSync(
      join(dir, 'reservation.json'),
      JSON.stringify({ fil: 'conv-B', registre: join(dir, 'reservations-fichiers.json') }),
      'utf8'
    )
    writeFileSync(
      join(dir, NOM_JOURNAL_MESSAGES_FILS),
      `${JSON.stringify({ type: 'message', id: 'msg-1', at: 1, de: { fil: 'conv-A' }, a: 'conv-B', nature: 'info', texte: 'texte msg-1' })}\n`,
      'utf8'
    )
    const t = contexte(
      lancer({ tool_name: 'Read', tool_input: { file_path: 'conversations.json' } }).stdout
    )!
    expect(t).toContain('texte msg-1')
    expect(t.indexOf('conversation_read')).toBeGreaterThan(t.indexOf('texte msg-1'))
  })
})
