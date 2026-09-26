// Test de clore-run.mjs : node --test .arena/arenagame/clore-run.test.mjs
// (`.arena/**` est exclu de vitest — vitest.config.ts —, d'où node:test.)
//
// Le script tourne dans un sous-processus avec un dossier personnel FACTICE (USERPROFILE/HOME),
// pour ne jamais toucher ~/.claude réel. Chaque cas reproduit la forme d'un vrai journal de session
// Claude : une ligne JSON `assistant` par appel d'outil, avec son horodatage.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'clore-run.mjs')
const racines = []
after(() => racines.forEach((r) => rmSync(r, { recursive: true, force: true })))

const ENTETE = 'session: bras\nregime: standard\n\n## Besoin\ntexte\n'
const passe = new Date(Date.now() - 60_000).toISOString()

/** Monte un faux dossier personnel, un journal fait des `appels`, et lance clore-run. */
function lancer(appels, { runs = [], critere = true, preparer = () => {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'clore-run-'))
  racines.push(home)
  const sid = '11111111-2222-3333-4444-555555555555'
  const runMd = (nom) => join(home, '.claude', 'runs', nom, 'RUN.md')
  for (const nom of runs) {
    mkdirSync(dirname(runMd(nom)), { recursive: true })
    writeFileSync(runMd(nom), ENTETE)
  }
  const lignes = appels({ home, runMd }).map(([name, input, timestamp = passe]) =>
    JSON.stringify({
      type: 'assistant',
      timestamp,
      sessionId: sid,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] }
    })
  )
  const projet = join(home, '.claude', 'projects', 'D--banc')
  mkdirSync(projet, { recursive: true })
  writeFileSync(join(projet, `${sid}.jsonl`), lignes.join('\n') + '\n')
  writeFileSync(join(home, 'note.json'), JSON.stringify({ critere }))
  writeFileSync(join(home, 'out.json'), JSON.stringify({ session_id: sid }))
  // Rangement : le dossier du RUN.md clos part dans <dossier du out.json>/runs/<même chemin relatif>.
  const range = (nom) => join(home, 'runs', nom, 'RUN.md')
  preparer({ runMd, range, home, sid })
  const jouer = (c) => {
    writeFileSync(join(home, 'note.json'), JSON.stringify({ critere: c }))
    return execFileSync(process.execPath, [SCRIPT, join(home, 'note.json'), join(home, 'out.json')], {
      env: { ...process.env, USERPROFILE: home, HOME: home },
      encoding: 'utf8'
    })
  }
  const sortie = jouer(critere)
  // Statut lu là où le RUN.md se trouve : rangé s'il a été clos, sinon à sa place d'origine.
  const statut = (nom) => {
    const f = existsSync(range(nom)) ? range(nom) : runMd(nom)
    return /^status: (\w+)$/m.exec(readFileSync(f, 'utf8'))?.[1] ?? null
  }
  return { statut, sortie, runMd, range, home, rejouer: jouer }
}

test('PowerShell Add-Content sur $env:USERPROFILE (forme réelle de t4 c-1) : clos', () => {
  const { statut } = lancer(
    () => [['PowerShell', { command: 'Add-Content "$env:USERPROFILE\\.claude\\runs\\t4-c-1\\w\\RUN.md" -Encoding utf8 -Value "`n## Essai 4"' }]],
    { runs: ['t4-c-1/w'] }
  )
  assert.equal(statut('t4-c-1/w'), 'green')
})

test('PowerShell via variable et here-string (forme réelle de t4 a-1) : clos', () => {
  const { statut } = lancer(
    ({ runMd }) => [['PowerShell', { command: `$p="${runMd('t4-a-1/w')}"; Add-Content -Encoding utf8 $p @'\n\n## Construction\n- 31/31 vertes ; banc > 49 %\n'@` }]],
    { runs: ['t4-a-1/w'] }
  )
  assert.equal(statut('t4-a-1/w'), 'green')
})

test('Bash heredoc vers ~/.claude/runs : clos, statut red si le critère manque', () => {
  const { statut } = lancer(
    () => [['Bash', { command: "mkdir -p ~/.claude/runs/r-bash && cat > ~/.claude/runs/r-bash/RUN.md <<'EOF'\nsession: bras\nregime: standard\n\n## Besoin\nEOF" }]],
    { runs: ['r-bash'], critere: false }
  )
  assert.equal(statut('r-bash'), 'red')
})

test('Bash echo >> "$HOME/…" : clos', () => {
  const { statut } = lancer(() => [['Bash', { command: 'echo "- fini" >> "$HOME/.claude/runs/r-ajout/RUN.md"' }]], {
    runs: ['r-ajout']
  })
  assert.equal(statut('r-ajout'), 'green')
})

test('outil Write : toujours clos (comportement d’avant conservé)', () => {
  const { statut } = lancer(({ runMd }) => [['Write', { file_path: runMd('r-write'), content: ENTETE }]], { runs: ['r-write'] })
  assert.equal(statut('r-write'), 'green')
})

test('RUN.md seulement LU (Read, Get-Content, cat) ou cité dans un contenu écrit : jamais clos', () => {
  const { statut } = lancer(
    ({ runMd }) => [
      ['Read', { file_path: runMd('autre-read') }],
      ['PowerShell', { command: 'Get-Content "$env:USERPROFILE\\.claude\\runs\\autre-ps\\RUN.md" | Select-Object -First 20' }],
      ['Bash', { command: 'cat ~/.claude/runs/autre-cat/RUN.md; sed -n 1,5p ~/.claude/runs/autre-cat/RUN.md > /tmp/x.txt' }],
      ['PowerShell', { command: `Add-Content -Path C:\\journal.txt @'\necho x > ${runMd('autre-piege')}\n'@` }]
    ],
    { runs: ['autre-read', 'autre-ps', 'autre-cat', 'autre-piege'] }
  )
  for (const nom of ['autre-read', 'autre-ps', 'autre-cat', 'autre-piege']) assert.equal(statut(nom), null, nom)
})

test('écriture visée mais fichier non modifié depuis l’appel : pas écrit pendant la session, pas clos', () => {
  // Le fichier date de 2 h, l'appel d'il y a 1 min : l'appel ne l'a donc pas écrit.
  const avant = new Date(Date.now() - 7_200_000)
  const { statut } = lancer(() => [['Bash', { command: 'echo x >> ~/.claude/runs/r-vieux/RUN.md' }]], {
    runs: ['r-vieux'],
    preparer: ({ runMd }) => utimesSync(runMd('r-vieux'), avant, avant)
  })
  assert.equal(statut('r-vieux'), null)
})

test('hors de ~/.claude/runs : jamais touché', () => {
  const { sortie } = lancer(() => [['Bash', { command: 'echo x > D:/depot/RUN.md' }]])
  assert.match(sortie, /aucun RUN\.md écrit/)
})

// Voie 3 (choix de l'utilisateur, 2026-09-25) : un bras noté sort de ~/.claude/runs.
test('clos puis RANGÉ : le dossier quitte ~/.claude/runs pour <série>/runs, parent vide retiré', () => {
  const { statut, runMd, range, home } = lancer(({ runMd }) => [['Write', { file_path: runMd('t4-a-1/w'), content: ENTETE }]], {
    runs: ['t4-a-1/w']
  })
  assert.equal(existsSync(runMd('t4-a-1/w')), false, 'source encore sous ~/.claude/runs')
  assert.equal(existsSync(join(home, '.claude', 'runs', 't4-a-1')), false, 'dossier de session vide laissé')
  assert.equal(existsSync(join(home, '.claude', 'runs')), true, 'racine des runs supprimée')
  assert.equal(existsSync(range('t4-a-1/w')), true)
  assert.equal(statut('t4-a-1/w'), 'green')
})

test('second appel (lance-bras.sh puis nuit.sh) : retrouve le RUN.md déjà rangé et y repose le statut', () => {
  const { statut, rejouer } = lancer(({ runMd }) => [['Write', { file_path: runMd('r-deux/w'), content: ENTETE }]], {
    runs: ['r-deux/w']
  })
  const sortie = rejouer(false)
  assert.doesNotMatch(sortie, /aucun RUN\.md/)
  assert.equal(statut('r-deux/w'), 'red')
})

test('destination déjà présente : rien n’est écrasé, la source reste en place', () => {
  const { runMd, range } = lancer(({ runMd }) => [['Write', { file_path: runMd('r-pris/w'), content: ENTETE }]], {
    runs: ['r-pris/w'],
    preparer: ({ range }) => {
      mkdirSync(dirname(range('r-pris/w')), { recursive: true })
      writeFileSync(range('r-pris/w'), 'autre essai\n')
    }
  })
  assert.equal(readFileSync(range('r-pris/w'), 'utf8'), 'autre essai\n')
  assert.equal(existsSync(runMd('r-pris/w')), true)
})

test('dossier de session partagé : seul le sujet écrit part, le voisin et le parent restent', () => {
  const { runMd, range } = lancer(({ runMd }) => [['Write', { file_path: runMd('sess/w1'), content: ENTETE }]], {
    runs: ['sess/w1', 'sess/w2']
  })
  assert.equal(existsSync(range('sess/w1')), true)
  assert.equal(existsSync(runMd('sess/w2')), true)
  assert.equal(existsSync(range('sess/w2')), false)
})

test('RUN.md posé à la racine des runs : clos mais jamais déplacé (la racine ne part pas)', () => {
  const { runMd, sortie } = lancer(({ runMd }) => [['Write', { file_path: runMd(''), content: ENTETE }]], {
    preparer: ({ runMd }) => {
      mkdirSync(dirname(runMd('')), { recursive: true })
      writeFileSync(runMd(''), ENTETE)
    }
  })
  assert.equal(existsSync(runMd('')), true, sortie)
  assert.match(readFileSync(runMd(''), 'utf8'), /^status: green$/m)
})

// VERDICT DU BRAS (conv-826, 2026-09-26). Forme réelle : nuit-2026-09-26 m2 a-1 a remplacé `status: open` par
// `status: red` dans son en-tête (PowerShell Replace, 09:05:21) ; clore-run l'a réécrit `green` et le verdict
// déclaré par le bras — que la note AUTOWIN « preuve honnête » compare à check.mjs — était perdu.
const lireEntete = (f) => readFileSync(f, 'utf8').split('## ')[0]

test('verdict du bras gardé : status = check.mjs, status_bras = ce que le bras avait posé', () => {
  const { statut, range, sortie } = lancer(({ runMd }) => [['Edit', { file_path: runMd('r-verdict'), old_string: 'open', new_string: 'red' }]], {
    runs: ['r-verdict'],
    preparer: ({ runMd }) => writeFileSync(runMd('r-verdict'), 'session: bras\nregime: standard\nstatus: red\n\n## Besoin\ntexte\n')
  })
  assert.equal(statut('r-verdict'), 'green', sortie)
  const entete = lireEntete(range('r-verdict'))
  assert.match(entete, /^status_bras: red$/m)
  // Autowin lit le PREMIER `status:` de l'en-tête (src/main/dashboards/runs.ts) : ce doit rester celui de check.mjs.
  assert.equal(/^\s*status:\s*(\S+)/im.exec(entete)?.[1], 'green')
})

test('second passage (lance-bras.sh puis nuit.sh) : status_bras n’est pas remplacé par le statut de clore-run', () => {
  const { range, rejouer } = lancer(({ runMd }) => [['Edit', { file_path: runMd('r-deux'), old_string: 'open', new_string: 'red' }]], {
    runs: ['r-deux'],
    preparer: ({ runMd }) => writeFileSync(runMd('r-deux'), 'session: bras\nstatus: red\n\n## Besoin\n')
  })
  rejouer(true)
  const entete = lireEntete(range('r-deux'))
  assert.equal(entete.match(/^status_bras:/gm)?.length, 1)
  assert.match(entete, /^status_bras: red$/m)
  assert.match(entete, /^status: green$/m)
})

test('RUN.md déjà rangé par un clore-run d’avant ce correctif : status_bras: inconnu, jamais notre propre statut', () => {
  const { range } = lancer(({ runMd }) => [['Edit', { file_path: runMd('r-ancien'), old_string: 'a', new_string: 'b' }]], {
    preparer: ({ range }) => {
      mkdirSync(dirname(range('r-ancien')), { recursive: true })
      writeFileSync(range('r-ancien'), 'session: bras\nstatus: green\n\n## Besoin\n')
    }
  })
  const entete = lireEntete(range('r-ancien'))
  assert.match(entete, /^status_bras: inconnu$/m)
  assert.match(entete, /^status: green$/m)
})

// BRAS ISOLÉ (conv-826, 2026-09-26) : lance-bras.sh fait tourner le bras hors du dépôt et lui ferme ~/.claude/runs ;
// son RUN.md vit sous une racine à lui, que lance-bras.sh écrit dans out.json (`runs_racine`).
test('bras ISOLÉ : RUN.md sous la racine de out.json (runs_racine) — clos puis rangé comme les autres', () => {
  const iso = (home) => join(home, 'isole', 'runs', 'r-iso', 'RUN.md')
  const { range, sortie, home } = lancer(({ home }) => [['Write', { file_path: iso(home), content: ENTETE }]], {
    preparer: ({ home, sid }) => {
      mkdirSync(dirname(iso(home)), { recursive: true })
      writeFileSync(iso(home), ENTETE)
      writeFileSync(join(home, 'out.json'), JSON.stringify({ session_id: sid, runs_racine: join(home, 'isole', 'runs') }))
    }
  })
  assert.equal(existsSync(range('r-iso')), true, sortie)
  assert.match(readFileSync(range('r-iso'), 'utf8'), /^status: green$/m)
  assert.equal(existsSync(iso(home)), false, 'la source isolée est partie après la copie vérifiée')
})

test('bras sans status dans son en-tête : status_bras: aucun', () => {
  const { range } = lancer(({ runMd }) => [['Write', { file_path: runMd('r-muet'), content: ENTETE }]], { runs: ['r-muet'] })
  assert.match(lireEntete(range('r-muet')), /^status_bras: aucun$/m)
})
