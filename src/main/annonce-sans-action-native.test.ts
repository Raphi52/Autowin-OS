import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusEstUneAction, statutComplet } from './chat-turn-messages'

/**
 * FAUSSE ALERTE « tu as ANNONCÉ ce que tu allais faire, sans rien faire ».
 *
 * Mesuré le 2026-09-22 (conv-782) : le tour avait créé `.arena/arenagame/lance-bras.sh` (Write),
 * modifié `skills/arenagame/SKILL.md` (Edit) et joué deux tests (Bash) — et le garde a répondu
 * « aucune commande n'a été exécutée ». Cause : `anyActionExecuted` n'est levé que par un `<cmd>`
 * Autowin ; les outils NATIFS du modèle passent par `chunk.status`, où seule la LECTURE était
 * reconnue (`statusEstUneLecture`). Le garde a donc exigé de refaire un travail déjà fait.
 */
describe('statusEstUneAction — un outil natif qui agit compte comme une action', () => {
  it('Write, Edit, MultiEdit et NotebookEdit sont des actions', () => {
    expect(statusEstUneAction('Write · D:/AutoWinOS/.arena/arenagame/lance-bras.sh')).toBe(true)
    expect(statusEstUneAction('Edit · skills/arenagame/SKILL.md')).toBe(true)
    expect(statusEstUneAction('MultiEdit · a.ts')).toBe(true)
    expect(statusEstUneAction('NotebookEdit · n.ipynb')).toBe(true)
  })

  it('un Bash qui n’est pas une simple lecture est une action', () => {
    expect(statusEstUneAction('Bash · npx vitest run src/main/x.test.ts')).toBe(true)
    expect(statusEstUneAction('Bash · tar -cf a.tar b && rm -rf b')).toBe(true)
  })

  it('CONTRE-EXEMPLE — une lecture n’est pas une action', () => {
    expect(statusEstUneAction('Read · src/main/agent-pilot.ts')).toBe(false)
    expect(statusEstUneAction('Grep · motif')).toBe(false)
    expect(statusEstUneAction('Bash · cat fichier.txt')).toBe(false)
    expect(statusEstUneAction('')).toBe(false)
    expect(statusEstUneAction(undefined)).toBe(false)
  })

  it('le garde « annonce sans action » voit les actions natives', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    expect(source).toMatch(/statusEstUneAction\(statutEntier\)\)\s*actionNativeCeTour = true/)
    expect(source).toMatch(
      /exigeAgirPasAnnoncer\(\s*latestUserMessage,\s*visibleTextThisTurn,\s*anyActionExecuted \|\| actionNativeCeTour\s*\)/
    )
  })
})

/**
 * LECTURE COMPOSÉE — conv-861 (2026-09-25). « A agi » n'est plus « le 1er mot n'est pas un
 * lecteur » : c'est « AU MOINS UN segment n'est ni une lecture ni neutre, ou écrit dans un fichier ».
 * Sans cela, reconnaître `date; …; cat y` comme lecture aurait fait passer `date; rm -rf x; cat y`
 * pour un tour sans action.
 */
describe('statusEstUneAction sur une commande composée (conv-861)', () => {
  it('une lecture composée pure n’est pas une action', () => {
    expect(
      statusEstUneAction(
        'Bash · cd /d/AutoWinOS; date \'+%H:%M\'; tail -2 j.txt; ls x | grep -E "^m3|fin"'
      )
    ).toBe(false)
    expect(statusEstUneAction('Bash · N=/d/x; tail -12 $N/journal.txt 2>/dev/null')).toBe(false)
  })

  it('un seul segment qui agit suffit, où qu’il soit', () => {
    expect(statusEstUneAction('Bash · date; rm -rf x; cat y')).toBe(true)
    expect(statusEstUneAction('Bash · cat a > b')).toBe(true)
    expect(statusEstUneAction("Bash · sed -i 's/a/b/' f.ts")).toBe(true)
    expect(statusEstUneAction('Bash · T=$(mktemp -d); cat x')).toBe(true)
  })
})

/**
 * LA COMMANDE ENTIÈRE, PAS SON MOIGNON — rejeu des 134 commandes Bash de conv-861 (2026-09-25).
 * Le libellé est coupé à 120 caractères ; `R=...; DEST=...; for d in ...` y ressemblait à une
 * lecture pure alors que son `cp` / `rm -r` venait après la coupure.
 */
describe('statutComplet : la commande entière est jugée (conv-861)', () => {
  const longue =
    'R=/c/Users/x/.claude/runs; DEST=/d/AutoWinOS/.arena/arenagame/essais/t4-2026-09-24/runs; ' +
    'for d in t4-a-2 t4-b-1; do cp -rp "$R/$d" "$DEST/$d" && rm -r "$R/$d"; done'
  const coupe = `Bash · ${longue.slice(0, 120)}`

  it('reconstruit `Outil · cible` depuis statusTarget, et seulement cette forme', () => {
    expect(statutComplet(coupe, longue)).toBe(`Bash · ${longue}`)
    expect(statutComplet('Read · a.ts')).toBe('Read · a.ts')
    expect(statutComplet('Bash en cours - 2 min - banc', 'banc')).toBe(
      'Bash en cours - 2 min - banc'
    )
    expect(statutComplet(undefined)).toBe('')
  })

  it('le cp / rm après la coupure est une ACTION', () => {
    expect(statusEstUneAction(statutComplet(coupe, longue))).toBe(true)
  })

  it('un caractère échappé n’est ni une substitution ni un séparateur', () => {
    // Chaînes JS : `\\` donne UNE barre oblique dans la commande (grep -rn "subtitle: \`\${" src).
    expect(statusEstUneAction('Bash · grep -rn "subtitle: \\`\\${" src')).toBe(false)
    expect(statusEstUneAction('Bash · grep -n a\\;b f.ts')).toBe(false)
  })
})
