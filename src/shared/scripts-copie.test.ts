import { describe, expect, it } from 'vitest'
import {
  adresseLocale,
  blocSuivant,
  cheminACopierValide,
  developperVariables,
  lancementDetecte,
  lireConfigAutowin,
  lireConfigConductor,
  portDeBase,
  variablesDeCopie
} from './scripts-copie'

describe('lireConfigAutowin', () => {
  it('lit préparation, lancement et fichiers à copier', () => {
    const lu = lireConfigAutowin(
      JSON.stringify({
        preparation: ' npm ci ',
        lancement: 'npm run dev',
        copier: ['.env', 'config\\local.json']
      })
    )
    expect(lu).toEqual({
      ok: true,
      scripts: {
        source: 'autowin',
        preparation: 'npm ci',
        lancement: 'npm run dev',
        copier: ['.env', 'config/local.json']
      }
    })
  })

  it('une commande vide compte comme absente', () => {
    const lu = lireConfigAutowin('{"preparation":"  "}')
    expect(lu.ok && lu.scripts.preparation).toBeUndefined()
  })

  it('NOMME l’erreur au lieu d’ignorer la configuration', () => {
    expect(lireConfigAutowin('{pas du json')).toMatchObject({ ok: false })
    expect(lireConfigAutowin('[]')).toMatchObject({
      ok: false,
      erreur: expect.stringContaining('objet')
    })
    expect(lireConfigAutowin('{"preparation": 3}')).toMatchObject({
      ok: false,
      erreur: expect.stringContaining('preparation')
    })
    expect(lireConfigAutowin('{"copier": ".env"}')).toMatchObject({
      ok: false,
      erreur: expect.stringContaining('copier')
    })
  })

  it('refuse de copier hors du dépôt', () => {
    const lu = lireConfigAutowin('{"copier": ["../secret", "C:/x", "/etc/passwd", "a/../../b"]}')
    expect(lu).toMatchObject({ ok: false, erreur: expect.stringContaining('../secret') })
  })
})

describe('cheminACopierValide', () => {
  it('accepte un relatif simple, refuse absolu, lecteur, remontée et vide', () => {
    expect(cheminACopierValide('.env')).toBe(true)
    expect(cheminACopierValide('apps/web/.env.local')).toBe(true)
    for (const mauvais of ['', '/x', 'C:\\x', 'd:x', '..', 'a/../b', 'a//b']) {
      expect(cheminACopierValide(mauvais), mauvais).toBe(false)
    }
  })
})

describe('lireConfigConductor', () => {
  it('lit [scripts] setup et run', () => {
    const toml = [
      '# réglages',
      '[scripts]',
      'setup = "pnpm install && cp \\"$CONDUCTOR_ROOT_PATH/.env\\" ."',
      "run = 'pnpm dev --port $CONDUCTOR_PORT'",
      'run_mode = "concurrent"',
      '[autre]',
      'setup = "à ignorer"'
    ].join('\n')
    expect(lireConfigConductor(toml)).toEqual({
      source: 'conductor',
      preparation: 'pnpm install && cp "$CONDUCTOR_ROOT_PATH/.env" .',
      lancement: 'pnpm dev --port $CONDUCTOR_PORT',
      copier: []
    })
  })

  it('scripts nommés : prend celui marqué par défaut', () => {
    const toml = [
      '[scripts.run.tests]',
      'command = "pnpm test"',
      '[scripts.run.web]',
      'command = "pnpm dev"',
      'default = true'
    ].join('\n')
    expect(lireConfigConductor(toml)?.lancement).toBe('pnpm dev')
  })

  it('rien de déclaré → null', () => {
    expect(lireConfigConductor('[scripts]\nrun_mode = "concurrent"')).toBeNull()
    expect(lireConfigConductor('')).toBeNull()
  })
})

describe('lancementDetecte', () => {
  it('dev en priorité, puis start, jamais de préparation', () => {
    expect(lancementDetecte('{"scripts":{"start":"x","dev":"y"}}')).toEqual({
      source: 'package.json',
      lancement: 'npm run dev',
      copier: []
    })
    expect(lancementDetecte('{"scripts":{"start":"x"}}')?.lancement).toBe('npm start')
    expect(lancementDetecte('{"scripts":{"test":"x"}}')).toBeNull()
    expect(lancementDetecte('pas du json')).toBeNull()
  })
})

describe('ports', () => {
  it('stable pour un même nom, aligné sur des blocs de 10, dans la plage', () => {
    const p = portDeBase('conv-877')
    expect(portDeBase('conv-877')).toBe(p)
    expect(p % 10).toBe(0)
    expect(p).toBeGreaterThanOrEqual(20_000)
    expect(p).toBeLessThan(50_000)
    expect(portDeBase('conv-878')).not.toBe(p)
  })

  it('le bloc suivant reboucle au début de la plage', () => {
    expect(blocSuivant(20_000)).toBe(20_010)
    expect(blocSuivant(49_990)).toBe(20_000)
  })
})

describe('variables', () => {
  const vars = variablesDeCopie({
    depot: 'D:/depot',
    copie: 'D:/copie',
    nom: 'run-1',
    port: 20_010
  })

  it('fournit les noms Autowin ET Conductor', () => {
    expect(vars).toMatchObject({
      AUTOWIN_PORT: '20010',
      AUTOWIN_DEPOT: 'D:/depot',
      CONDUCTOR_PORT: '20010',
      CONDUCTOR_ROOT_PATH: 'D:/depot',
      CONDUCTOR_WORKSPACE_PATH: 'D:/copie',
      CONDUCTOR_WORKSPACE_NAME: 'run-1'
    })
  })

  it('développe $NOM et ${NOM} connus, laisse le reste au shell', () => {
    expect(
      developperVariables('vite --port $AUTOWIN_PORT --x ${CONDUCTOR_PORT} $HOME %PATH%', vars)
    ).toBe('vite --port 20010 --x 20010 $HOME %PATH%')
  })
})

describe('adresseLocale', () => {
  it('repère l’adresse d’un serveur de dev, codes couleur compris', () => {
    expect(adresseLocale('\u001b[32m  ➜  Local:   \u001b[1mhttp://localhost:5173/\u001b[22m')).toBe(
      'http://localhost:5173/'
    )
    expect(adresseLocale('Listening on http://0.0.0.0:3000.')).toBe('http://localhost:3000')
    expect(adresseLocale('ready at http://127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app')
  })

  it('ignore une adresse distante', () => {
    expect(adresseLocale('voir https://example.com:443')).toBeUndefined()
  })
})
