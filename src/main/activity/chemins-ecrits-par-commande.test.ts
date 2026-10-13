import { describe, expect, it } from 'vitest'
import { cheminsEcritsParCommande } from './chemins-ecrits-par-commande'
import { COMMANDE_CONV_932, COMMANDE_CONV_933 } from './commandes-ecriture-2026-10-13.fixture'

const DEPOT = 'D:\\AutoWinOS'
const ecrits = (commande: string, dossier = DEPOT): string[] =>
  cheminsEcritsParCommande(commande, dossier, 'win32')

describe('cheminsEcritsParCommande — les deux commandes réelles du 2026-10-13', () => {
  it('conv-932 : `prettier --write` nomme le test ; eslint sans --fix, tsc et /dev/null ne nomment rien', () => {
    expect(ecrits(COMMANDE_CONV_932, 'C:\\ailleurs')).toEqual([
      'D:\\AutoWinOS\\src\\main\\githooks-pre-push.test.ts'
    ])
  })

  it('conv-933 : `cat >>` et `sed -i` nomment le test une fois ; le corps du here-document n’est pas lu', () => {
    // Le corps contient `=>`, `|`, des guillemets et des chemins : aucun n'est une redirection.
    expect(ecrits(COMMANDE_CONV_933)).toEqual([
      'D:\\AutoWinOS\\src\\main\\relance-auto-moteur.test.ts'
    ])
  })
})

describe('cheminsEcritsParCommande — formes d’écriture reconnues', () => {
  it.each([
    ['echo a > notes.md', ['notes.md']],
    ['echo a >> notes.md', ['notes.md']],
    ['echo a 2> erreurs.log', ['erreurs.log']],
    ['npm test &> sortie.log', ['sortie.log']],
    ['printf x >| force.txt', ['force.txt']],
    ['echo a | tee -a journal.txt copie.txt', ['journal.txt', 'copie.txt']],
    ["sed -i.bak -e 's/a/b/' src/a.ts src/b.ts", ['src/a.ts', 'src/b.ts']],
    ["sed --in-place 's/a/b/' src/a.ts", ['src/a.ts']],
    ['npx prettier -w src/a.ts', ['src/a.ts']],
    ['npx prettier --config .prettierrc --write src/a.ts', ['src/a.ts']],
    ['node node_modules/prettier/bin/prettier.cjs --write src/a.ts', ['src/a.ts']],
    ['npx eslint --fix --max-warnings 0 src/a.ts', ['src/a.ts']],
    ['npx eslint src/a.ts -o rapport.json', ['rapport.json']],
    ['FORCE_COLOR=0 timeout 60 npx prettier --write src/a.ts', ['src/a.ts']],
    ['cat > "dossier avec espace/a.ts" <<EOF\nx > y\nEOF', ['dossier avec espace/a.ts']],
    ['cd src && echo a > a.ts', ['src/a.ts']]
  ])('%s', (commande, attendus) => {
    expect(ecrits(commande)).toEqual(
      attendus.map((chemin) => `${DEPOT}\\${chemin.replaceAll('/', '\\')}`)
    )
  })
})

describe('cheminsEcritsParCommande — ce qui n’est PAS une écriture nommée', () => {
  it.each([
    ['lecture et tests', 'cat src/a.ts; npx vitest run src/a.test.ts 2>&1 | tail -5'],
    ['prettier sans --write', 'npx prettier --check src/a.ts'],
    ['eslint sans --fix', 'npx eslint src/a.ts'],
    ['sed sans -i', 'sed -n 5,13p src/a.ts'],
    ['redirection vers un descripteur', 'npm test 2>&1 >&2'],
    ['opérateurs entre guillemets', `echo "a > b.ts" 'c >> d.ts'`],
    ['cible issue d’une expansion', 'echo a > "$FICHIER"; echo b > $(mktemp); echo c > ~/x.ts'],
    ['glob', 'npx prettier --write "src/**/*.ts"'],
    ['périphériques', 'npm test >/dev/null 2>NUL'],
    ['commentaire', 'ls # echo a > a.ts'],
    ['here-document sans redirection', "node - <<'EOF'\nconsole.log(a > b)\nEOF"]
  ])('%s', (_cas, commande) => {
    expect(ecrits(commande)).toEqual([])
  })

  it('Git Bash : `/c/...` et un chemin absolu Windows sont rendus tels quels, hors du dépôt compris', () => {
    expect(ecrits('echo a > /c/temp/x.txt; echo b > D:/AutoWinOS/y.ts')).toEqual([
      'C:\\temp\\x.txt',
      'D:\\AutoWinOS\\y.ts'
    ])
  })

  it('sous un système POSIX, `/d/...` reste un chemin POSIX', () => {
    expect(cheminsEcritsParCommande('echo a > /d/x.ts; echo b > y.ts', '/depot', 'linux')).toEqual([
      '/d/x.ts',
      '/depot/y.ts'
    ])
  })
})
