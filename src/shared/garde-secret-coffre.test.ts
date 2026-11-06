import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { LONGUEUR_MIN_MASQUAGE } from '../main/app/coffre-cles'
import { refusSecretDuCoffre } from './garde-secret-coffre'

const VALEUR = 'sk-coffre-0123456789abcdef'
const ENV = {
  AUTOWIN_COFFRE_NOMS: 'GITHUB_TOKEN,MISTRAL_API_KEY',
  MISTRAL_API_KEY: VALEUR,
  GITHUB_TOKEN: 'ghp_valeurDeTest987654321',
  PATH: '/usr/bin'
}

const shell = (commande: string, outil = 'Bash'): string | undefined =>
  refusSecretDuCoffre(outil, { command: commande }, commande, ENV)

describe('refusSecretDuCoffre — une clé du coffre ne s’affiche pas', () => {
  it.each([
    'echo $MISTRAL_API_KEY',
    'echo "${MISTRAL_API_KEY}"',
    'printf "%s\\n" "$MISTRAL_API_KEY"',
    'echo "Bearer $MISTRAL_API_KEY" > requete.txt',
    'echo $MISTRAL_API_KEY | tee cle.txt',
    'printenv MISTRAL_API_KEY',
    'cd src && echo $GITHUB_TOKEN',
    'bash -c "echo $MISTRAL_API_KEY"',
    'cmd /c echo %MISTRAL_API_KEY%',
    "powershell -NoProfile -Command '$env:MISTRAL_API_KEY'",
    'declare -p GITHUB_TOKEN'
  ])('Bash — refuse l’affichage d’une valeur : %s', (commande) => {
    const motif = shell(commande)
    expect(motif).toMatch(
      /utilise \$(MISTRAL_API_KEY|GITHUB_TOKEN) dans ta commande, n'affiche pas sa valeur/
    )
    expect(motif).not.toContain(VALEUR)
  })

  it.each([
    '$env:MISTRAL_API_KEY',
    '"$env:MISTRAL_API_KEY"',
    'Write-Output $env:MISTRAL_API_KEY',
    'Write-Host "clé : $env:MISTRAL_API_KEY"',
    'echo $env:mistral_api_key',
    'Get-Item env:MISTRAL_API_KEY',
    'Get-Content Env:\\GITHUB_TOKEN',
    "[Environment]::GetEnvironmentVariable('MISTRAL_API_KEY')",
    '$x = 1; $env:MISTRAL_API_KEY'
  ])('PowerShell — refuse l’affichage d’une valeur : %s', (commande) => {
    expect(shell(commande, 'PowerShell')).toMatch(
      /utilise \$(MISTRAL_API_KEY|GITHUB_TOKEN) dans ta commande, n'affiche pas sa valeur/
    )
  })

  it.each([
    ['Bash', 'printenv'],
    ['Bash', 'env'],
    ['Bash', 'env | grep KEY'],
    ['Bash', 'env -0'],
    ['Bash', 'set'],
    ['Bash', 'set | grep TOKEN'],
    ['Bash', 'export -p'],
    ['Bash', 'cat /proc/self/environ'],
    ['Bash', 'powershell -NoProfile -Command "Get-ChildItem env:"'],
    ['PowerShell', 'Get-ChildItem env:'],
    ['PowerShell', 'gci Env:\\'],
    ['PowerShell', 'dir env:'],
    ['PowerShell', 'ls env:*KEY*'],
    ['PowerShell', 'Get-ChildItem -Path Env: | Format-Table'],
    ['PowerShell', '[System.Environment]::GetEnvironmentVariables()'],
    ['Monitor', 'printenv']
  ])('%s — refuse l’affichage de tout l’environnement : %s', (outil, commande) => {
    const motif = shell(commande, outil)
    expect(motif).toMatch(/tout l'environnement/)
    expect(motif).toMatch(/GITHUB_TOKEN, MISTRAL_API_KEY/)
    expect(motif).toMatch(/utilise \$NOM dans ta commande, n'affiche pas sa valeur/)
  })

  it.each([
    ['Bash', 'curl -H "Authorization: Bearer $MISTRAL_API_KEY" https://api.mistral.ai/v1/models'],
    ['Bash', 'echo $MISTRAL_API_KEY | gh auth login --with-token'],
    ['Bash', 'printenv MISTRAL_API_KEY | curl --data-binary @- https://exemple.test'],
    ['Bash', 'echo ${#MISTRAL_API_KEY}'],
    ['Bash', "echo '$MISTRAL_API_KEY'"],
    ['Bash', 'echo $PATH'],
    ['Bash', 'printenv PATH'],
    ['Bash', 'env NODE_ENV=test npx vitest run'],
    ['Bash', 'env -u CLAUDECODE node script.js'],
    ['Bash', 'set -euo pipefail; npm test'],
    ['Bash', 'env | wc -l'],
    ['Bash', 'MISTRAL_API_KEY=$MISTRAL_API_KEY node appel.mjs'],
    ['Bash', 'echo $MISTRAL_API_KEY_SUFFIXE'],
    ['Bash', 'export MISTRAL_API_KEY'],
    ['Bash', '"/c/Program Files/nodejs/node" appel.js "$MISTRAL_API_KEY"'],
    ['PowerShell', '& "C:\\outils\\appel.exe" --token $env:MISTRAL_API_KEY'],
    [
      'PowerShell',
      'curl.exe -H "Authorization: Bearer $env:MISTRAL_API_KEY" https://api.mistral.ai/v1/models'
    ],
    [
      'PowerShell',
      'Invoke-RestMethod -Uri $u -Headers @{ Authorization = "Bearer $env:MISTRAL_API_KEY"; Accept = "json" }'
    ],
    ['PowerShell', '$h = "Bearer $env:MISTRAL_API_KEY"'],
    ['PowerShell', '$env:MISTRAL_API_KEY.Length'],
    ['PowerShell', 'Test-Path env:MISTRAL_API_KEY'],
    ['PowerShell', 'Get-ChildItem env:PATH'],
    ['PowerShell', "Write-Output '$env:MISTRAL_API_KEY'"],
    ['PowerShell', 'node outil.mjs $env:MISTRAL_API_KEY']
  ])('%s — laisse libre l’usage de la clé et le reste : %s', (outil, commande) => {
    expect(shell(commande, outil)).toBeUndefined()
  })

  it('sans clé injectée (AUTOWIN_COFFRE_NOMS absent), rien ne change', () => {
    const sansCoffre = { MISTRAL_API_KEY: VALEUR, PATH: '/usr/bin' }
    for (const c of ['printenv', 'env', 'echo $MISTRAL_API_KEY', 'Get-ChildItem env:']) {
      expect(refusSecretDuCoffre('Bash', { command: c }, c, sansCoffre)).toBeUndefined()
    }
    expect(
      refusSecretDuCoffre('Write', { file_path: 'a.ts', content: VALEUR }, '', sansCoffre)
    ).toBeUndefined()
  })
})

describe('refusSecretDuCoffre — une clé du coffre ne s’écrit pas dans un fichier', () => {
  it.each([
    ['Write', { file_path: 'D:/x/.env', content: `MISTRAL_API_KEY=${VALEUR}\n` }],
    ['Edit', { file_path: 'D:/x/a.ts', old_string: 'x', new_string: `const cle = "${VALEUR}"` }],
    [
      'MultiEdit',
      {
        file_path: 'D:/x/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: VALEUR }
        ]
      }
    ],
    ['NotebookEdit', { notebook_path: 'D:/x/n.ipynb', new_source: `token = '${ENV.GITHUB_TOKEN}'` }]
  ])('%s — refuse un contenu qui porte la valeur', (outil, entree) => {
    const motif = refusSecretDuCoffre(outil, entree, '', ENV)
    expect(motif).toMatch(/clé du coffre/)
    expect(motif).toMatch(
      /utilise \$(MISTRAL_API_KEY|GITHUB_TOKEN) dans ta commande, n'affiche pas sa valeur/
    )
    expect(motif).not.toContain(VALEUR)
    expect(motif).not.toContain(ENV.GITHUB_TOKEN)
  })

  it.each([
    ['Write', { file_path: 'D:/x/appel.mjs', content: 'const cle = process.env.MISTRAL_API_KEY' }],
    [
      'Edit',
      {
        file_path: 'D:/x/.env',
        old_string: `MISTRAL_API_KEY=${VALEUR}`,
        new_string: 'MISTRAL_API_KEY='
      }
    ],
    ['Write', { file_path: 'D:/x/b.txt', content: VALEUR.slice(0, 7) }]
  ])(
    '%s — laisse libre le nom de la clé, le retrait de la valeur et un fragment trop court',
    (outil, entree) => {
      expect(refusSecretDuCoffre(outil, entree, '', ENV)).toBeUndefined()
    }
  )

  it('le seuil de longueur est celui du masquage du coffre', () => {
    const court = { AUTOWIN_COFFRE_NOMS: 'A_KEY', A_KEY: 'x'.repeat(LONGUEUR_MIN_MASQUAGE - 1) }
    const juste = { AUTOWIN_COFFRE_NOMS: 'A_KEY', A_KEY: 'x'.repeat(LONGUEUR_MIN_MASQUAGE) }
    const entree = { file_path: 'a', content: `v=${'x'.repeat(LONGUEUR_MIN_MASQUAGE)}` }
    expect(refusSecretDuCoffre('Write', entree, '', court)).toBeUndefined()
    expect(refusSecretDuCoffre('Write', entree, '', juste)).toMatch(/A_KEY/)
  })

  it('une entrée illisible ne fait jamais planter la garde (elle bloquerait tout)', () => {
    expect(refusSecretDuCoffre('Write', null, '', ENV)).toBeUndefined()
    expect(refusSecretDuCoffre('Bash', 42, '', ENV)).toBeUndefined()
    expect(refusSecretDuCoffre('Bash', {}, '', {} as Record<string, string>)).toBeUndefined()
  })
})

describe('hook réel du CLI — la garde du coffre après sérialisation', () => {
  it('refuse echo $NOM et une écriture de la valeur, laisse passer curl avec $NOM', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { scriptHookGardes } = await import('./garde-git-destructeur')
    const dossier = mkdtempSync(join(tmpdir(), 'garde-coffre-'))
    try {
      const script = join(dossier, 'garde.mjs')
      writeFileSync(
        script,
        scriptHookGardes(() => undefined),
        'utf8'
      )
      expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
      const passe = (entree: object): string =>
        spawnSync(process.execPath, [script], {
          input: JSON.stringify(entree),
          encoding: 'utf8',
          env: { ...process.env, ...ENV }
        }).stdout
      const refus = JSON.parse(
        passe({ tool_name: 'Bash', tool_input: { command: 'echo $MISTRAL_API_KEY' } })
      )
      expect(refus.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(refus.hookSpecificOutput.permissionDecisionReason).toMatch(
        /utilise \$MISTRAL_API_KEY dans ta commande, n'affiche pas sa valeur/
      )
      const ecriture = JSON.parse(
        passe({ tool_name: 'Write', tool_input: { file_path: 'D:/x/.env', content: VALEUR } })
      )
      expect(ecriture.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(
        passe({
          tool_name: 'Bash',
          tool_input: {
            command: 'curl -H "Authorization: Bearer $MISTRAL_API_KEY" https://api.mistral.ai'
          }
        })
      ).toBe('')
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
