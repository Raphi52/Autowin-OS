import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ecrireAUnFil, type ContexteFils } from './messages-entre-fils-app'

// Un fil peut travailler dans une COPIE SÉPARÉE du dépôt (copie liée git, rangée sous
// `<dépôt>/.autowin-data/…/retours-de-tour/essai__<fil>-…`). C'est le même dépôt : ses messages
// doivent atteindre les fils restés dans le dossier principal, et inversement. Un AUTRE dépôt
// reste refusé. Vraies copies créées par `git worktree add`, comme celles de l'app.
let racine: string
let depot: string
let copie: string
let autre: string
let journal: string

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore'
  })
}

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'msg-fils-copie-'))
  depot = join(racine, 'depot')
  autre = join(racine, 'autre')
  for (const d of [depot, autre]) {
    mkdirSync(d)
    git(d, 'init', '-q')
    git(d, 'commit', '-q', '--allow-empty', '-m', 'init')
  }
  copie = join(depot, '.autowin-data', 'retours-de-tour', 'essai__conv-C-1-1')
  git(depot, 'worktree', 'add', '-q', '--detach', copie)
  journal = join(racine, 'messages-entre-fils.jsonl')
})
afterAll(() => rmSync(racine, { recursive: true, force: true }))

const contexte = (): ContexteFils => {
  const fils: Record<string, string> = { 'conv-P': depot, 'conv-C': copie, 'conv-X': autre }
  return {
    dossierDe: (f) => fils[f],
    estActif: (f) => f in fils,
    filsActifs: () => Object.keys(fils)
  }
}
const envoyer = (de: string, a: string): ReturnType<typeof ecrireAUnFil> =>
  ecrireAUnFil({ destinataire: a, texte: `de ${de} à ${a}` }, { fil: de }, contexte(), {
    journal,
    maintenant: 1_000_000
  })

describe('ecrire_a_un_fil depuis une copie séparée du dépôt', () => {
  it('le fil de la copie écrit au fil du dossier principal', () => {
    expect(envoyer('conv-C', 'conv-P')).toMatchObject({ ok: true, a: 'conv-P' })
  })

  it('le fil du dossier principal écrit au fil de la copie', () => {
    expect(envoyer('conv-P', 'conv-C')).toMatchObject({ ok: true, a: 'conv-C' })
  })

  it('un autre dépôt reste refusé, depuis la copie comme depuis le dossier principal', () => {
    expect(() => envoyer('conv-C', 'conv-X')).toThrow(/autre dossier/)
    expect(() => envoyer('conv-P', 'conv-X')).toThrow(/autre dossier/)
  })

  it('un destinataire inconnu : le refus nomme les fils du même dépôt, copie comprise', () => {
    expect(() => envoyer('conv-C', 'conv-inconnu')).toThrow(/même dépôt : conv-P\./)
  })
})
