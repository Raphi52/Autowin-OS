import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FICHIER_CONTROLES_DE_CONFIANCE,
  FICHIER_GARDE_NPM_GROK,
  commandeCodexGardeNpm,
  installerGardeNpmCodex,
  installerGardeNpmGrok,
  verifierControlesCodex
} from './hooks-des-cli'

/*
 * Un contrôle personnel au format qu'écrit l'installeur d'un poste : même mise en forme PowerShell
 * (4 espaces, fins de ligne CRLF). Le nom est fictif : le vrai n'est connu que de la donnée du poste
 * (`controles-codex-de-confiance.json`), jamais du code. L'installation ne doit jamais le réécrire.
 */
// fix-ok: nom d'entreprise et chemin personnel recopiés du poste dans ce test ; rouge mesuré : separation-entreprise.test.ts listait ce fichier (nom, puis « chemin et identifiant personnels »).
const COMMANDE_DU_POSTE =
  'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Outils\\CerveauFictif\\cerveau-fictif-hook.ps1"'
const GROUPE_DU_POSTE = {
  matcher: '',
  hooks: [{ type: 'command', command: COMMANDE_DU_POSTE, timeout: 15 }]
}
const HOOKS_DU_POSTE = JSON.stringify(
  { hooks: { UserPromptSubmit: [GROUPE_DU_POSTE] } },
  null,
  4
).replace(/\n/g, '\r\n')
const SCRIPT = 'D:\\AutoWinOS\\scripts\\garde-npm-modules.mjs'

let dossier: string
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'hooks-des-cli-'))
})
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true })
})

describe('installerGardeNpmGrok', () => {
  it('pose garde-npm.json : node + le chemin absolu du script en argument, sur l’outil shell', () => {
    const hooks = join(dossier, '.grok', 'hooks')
    expect(installerGardeNpmGrok(hooks, SCRIPT)).toBe('cree')
    const ecrit = JSON.parse(readFileSync(join(hooks, FICHIER_GARDE_NPM_GROK), 'utf8'))
    const groupe = ecrit.hooks.PreToolUse[0]
    expect(groupe.matcher).toBe('Bash|run_terminal_command')
    expect(groupe.hooks).toEqual([
      { type: 'command', command: 'node', args: [SCRIPT], timeout: 10 }
    ])
  })

  it('est idempotente, et ne touche aucun autre contrôle du dossier', () => {
    const hooks = join(dossier, 'hooks')
    mkdirSync(hooks)
    const voisin = join(hooks, 'brain.json')
    writeFileSync(voisin, '{"hooks":{}}')
    const avantVoisin = statSync(voisin).mtimeMs

    installerGardeNpmGrok(hooks, SCRIPT)
    const premier = readFileSync(join(hooks, FICHIER_GARDE_NPM_GROK), 'utf8')
    const datePremier = statSync(join(hooks, FICHIER_GARDE_NPM_GROK)).mtimeMs
    expect(installerGardeNpmGrok(hooks, SCRIPT)).toBe('inchange')

    expect(readFileSync(join(hooks, FICHIER_GARDE_NPM_GROK), 'utf8')).toBe(premier)
    expect(statSync(join(hooks, FICHIER_GARDE_NPM_GROK)).mtimeMs).toBe(datePremier)
    expect(readFileSync(voisin, 'utf8')).toBe('{"hooks":{}}')
    expect(statSync(voisin).mtimeMs).toBe(avantVoisin)
    expect(readdirSync(hooks).sort()).toEqual(['brain.json', FICHIER_GARDE_NPM_GROK])
  })
})

describe('installerGardeNpmCodex', () => {
  const fichier = (): string => join(dossier, 'hooks.json')

  it('ajoute la garde après une sauvegarde horodatée, sans réécrire le contrôle du poste', () => {
    writeFileSync(fichier(), HOOKS_DU_POSTE)
    const r = installerGardeNpmCodex(fichier(), SCRIPT, '2026-11-06T20-00-00-000Z')

    expect(r.issue).toBe('ajoute')
    expect(r.sauvegarde).toBe(join(dossier, 'hooks.json.2026-11-06T20-00-00-000Z.bak'))
    expect(readFileSync(r.sauvegarde!, 'utf8')).toBe(HOOKS_DU_POSTE)
    const apres = JSON.parse(readFileSync(fichier(), 'utf8'))
    expect(apres.hooks.UserPromptSubmit).toEqual([GROUPE_DU_POSTE])
    expect(apres.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: `node "${SCRIPT}"`, timeout: 10 }] }
    ])
  })

  it('est idempotente : un second passage n’écrit rien et ne sauvegarde rien', () => {
    writeFileSync(fichier(), HOOKS_DU_POSTE)
    installerGardeNpmCodex(fichier(), SCRIPT, 'premier')
    const apresPremier = readFileSync(fichier(), 'utf8')
    const date = statSync(fichier()).mtimeMs

    expect(installerGardeNpmCodex(fichier(), SCRIPT, 'second')).toEqual({ issue: 'inchange' })
    expect(readFileSync(fichier(), 'utf8')).toBe(apresPremier)
    expect(statSync(fichier()).mtimeMs).toBe(date)
    expect(readdirSync(dossier).sort()).toEqual(['hooks.json', 'hooks.json.premier.bak'])
  })

  it('crée le fichier quand le poste n’en a pas', () => {
    expect(installerGardeNpmCodex(fichier(), SCRIPT, 'x')).toEqual({ issue: 'cree' })
    expect(JSON.parse(readFileSync(fichier(), 'utf8')).hooks.PreToolUse[0].hooks[0].command).toBe(
      `node "${SCRIPT}"`
    )
  })

  it('refuse un fichier illisible, et le laisse tel quel', () => {
    writeFileSync(fichier(), '{ "hooks": ')
    expect(() => installerGardeNpmCodex(fichier(), SCRIPT, 'x')).toThrow()
    expect(readFileSync(fichier(), 'utf8')).toBe('{ "hooks": ')
    expect(readdirSync(dossier)).toEqual(['hooks.json'])
  })
})

describe('verifierControlesCodex', () => {
  // Le dossier du test est la racine d'un dépôt : la recherche des `.codex` de projet s'y arrête,
  // sans remonter jusqu'au vrai `~/.codex` du poste.
  beforeEach(() => {
    mkdirSync(join(dossier, '.git'))
  })
  const ecrire = (hooks: Record<string, unknown>): string => {
    const f = join(dossier, 'hooks.json')
    writeFileSync(f, JSON.stringify({ hooks }))
    return f
  }
  const garde = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: commandeCodexGardeNpm(SCRIPT), timeout: 10 }]
  }
  /** La liste du poste, rangée hors git dans le dossier de données de l'app. */
  const confiance = (contenu: unknown): string => {
    const f = join(dossier, FICHIER_CONTROLES_DE_CONFIANCE)
    writeFileSync(f, typeof contenu === 'string' ? contenu : JSON.stringify(contenu))
    return f
  }
  const listeDuPoste = (): string =>
    confiance({ controles: [{ evenement: 'UserPromptSubmit', command: COMMANDE_DU_POSTE }] })

  it('le contrôle listé par le poste et la garde npm, seuls : la relecture peut être levée', () => {
    const f = ecrire({ UserPromptSubmit: [GROUPE_DU_POSTE], PreToolUse: [garde] })
    expect(
      verifierControlesCodex({
        fichierHooks: f,
        script: SCRIPT,
        cwd: dossier,
        controlesDeConfiance: listeDuPoste()
      })
    ).toEqual({ contourner: true })
  })

  it('un contrôle absent de la liste du poste : non, et le contrôle est nommé', () => {
    const f = ecrire({ UserPromptSubmit: [GROUPE_DU_POSTE], PreToolUse: [garde] })
    for (const controlesDeConfiance of [
      undefined,
      join(dossier, 'aucune-liste.json'),
      confiance({ controles: [] })
    ]) {
      const v = verifierControlesCodex({
        fichierHooks: f,
        script: SCRIPT,
        cwd: dossier,
        controlesDeConfiance
      })
      expect(v.contourner).toBe(false)
      expect(v.avertissement).toContain(`UserPromptSubmit : ${COMMANDE_DU_POSTE}`)
    }
  })

  it('la comparaison avec la liste est exacte : voisin de chemin ou autre événement, non', () => {
    // Un motif (« tout script *-hook.ps1 », « même début de commande ») accepterait ces deux-là.
    const voisin = COMMANDE_DU_POSTE.replace('CerveauFictif', 'Ailleurs')
    const f = ecrire({
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: voisin }] }],
      PreToolUse: [garde]
    })
    const v = verifierControlesCodex({
      fichierHooks: f,
      script: SCRIPT,
      cwd: dossier,
      controlesDeConfiance: listeDuPoste()
    })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toContain(voisin)

    const autreEvenement = ecrire({
      PreToolUse: [garde, { matcher: '', hooks: [{ type: 'command', command: COMMANDE_DU_POSTE }] }]
    })
    expect(
      verifierControlesCodex({
        fichierHooks: autreEvenement,
        script: SCRIPT,
        cwd: dossier,
        controlesDeConfiance: listeDuPoste()
      }).contourner
    ).toBe(false)
  })

  it('une liste du poste illisible ou mal formée : non, avec la raison', () => {
    const f = ecrire({ UserPromptSubmit: [GROUPE_DU_POSTE], PreToolUse: [garde] })
    for (const contenu of [
      '{',
      { controles: 'tout' },
      { controles: [{ evenement: 'UserPromptSubmit' }] },
      { controles: [{ evenement: 'UserPromptSubmit', command: '' }] }
    ]) {
      const v = verifierControlesCodex({
        fichierHooks: f,
        script: SCRIPT,
        cwd: dossier,
        controlesDeConfiance: confiance(contenu)
      })
      expect(v.contourner).toBe(false)
      expect(v.avertissement).toMatch(/controles-codex-de-confiance\.json illisible/)
    }
  })

  it('la liste du poste ne remplace pas la garde : listée sans elle, non', () => {
    const f = ecrire({ UserPromptSubmit: [GROUPE_DU_POSTE] })
    const v = verifierControlesCodex({
      fichierHooks: f,
      script: SCRIPT,
      cwd: dossier,
      controlesDeConfiance: listeDuPoste()
    })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toMatch(/garde npm manque/)
  })

  it('un contrôle inconnu, même à côté des connus : non, et le contrôle est nommé', () => {
    const f = ecrire({
      UserPromptSubmit: [GROUPE_DU_POSTE],
      PreToolUse: [garde, { hooks: [{ type: 'command', command: 'curl https://exemple.test' }] }]
    })
    const v = verifierControlesCodex({
      fichierHooks: f,
      script: SCRIPT,
      cwd: dossier,
      controlesDeConfiance: listeDuPoste()
    })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toMatch(/curl https:\/\/exemple\.test/)
  })

  it('un champ qui change ce qui tourne (commandWindows) rend la garde inconnue', () => {
    const f = ecrire({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ ...garde.hooks[0], commandWindows: 'autre.exe' }] }]
    })
    expect(
      verifierControlesCodex({ fichierHooks: f, script: SCRIPT, cwd: dossier }).contourner
    ).toBe(false)
  })

  it('la garde d’un autre dossier n’est pas la nôtre', () => {
    const f = ecrire({
      PreToolUse: [
        { hooks: [{ type: 'command', command: 'node "C:\\ailleurs\\garde-npm-modules.mjs"' }] }
      ]
    })
    expect(
      verifierControlesCodex({ fichierHooks: f, script: SCRIPT, cwd: dossier }).contourner
    ).toBe(false)
  })

  it('fichier absent ou illisible : non, avec la raison', () => {
    const absent = verifierControlesCodex({
      fichierHooks: join(dossier, 'rien.json'),
      script: SCRIPT,
      cwd: dossier
    })
    expect(absent.contourner).toBe(false)
    expect(absent.avertissement).toMatch(/n’existe pas/)
    writeFileSync(join(dossier, 'casse.json'), '{')
    const casse = verifierControlesCodex({
      fichierHooks: join(dossier, 'casse.json'),
      script: SCRIPT,
      cwd: dossier
    })
    expect(casse.contourner).toBe(false)
    expect(casse.avertissement).toMatch(/illisible/)
  })

  it('des contrôles de projet (.codex du dépôt du tour) : non', () => {
    const personnel = join(dossier, 'maison', '.codex')
    mkdirSync(personnel, { recursive: true })
    const f = join(personnel, 'hooks.json')
    writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [garde] } }))
    const depot = join(dossier, 'depot')
    mkdirSync(join(depot, '.git'), { recursive: true })
    mkdirSync(join(depot, '.codex'))
    writeFileSync(join(depot, '.codex', 'hooks.json'), '{}')
    mkdirSync(join(depot, 'src'))

    const v = verifierControlesCodex({ fichierHooks: f, script: SCRIPT, cwd: join(depot, 'src') })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toMatch(/contrôles de projet/)
    // Le dossier personnel lui-même n'est pas un dossier de projet, même sous le dossier du tour.
    expect(
      verifierControlesCodex({ fichierHooks: f, script: SCRIPT, cwd: join(dossier, 'maison') })
    ).toEqual({
      contourner: true
    })
  })
})
