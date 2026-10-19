import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import {
  processusVivant,
  CapteurHdesk,
  fusionnerBureaux,
  interpreterCapture,
  lireRegistre,
  purgerBureauxFermes,
  purgerDossiersOrphelins,
  racineScriptsHorsArchive
} from './hdesk-tv'
import { existsSync, mkdirSync } from 'node:fs'

const png = (): Buffer => Buffer.from('png')

describe('bureau caché fermé — nettoyage disque', () => {
  it('efface la fiche et le dossier WebView2 des bureaux fermés, garde les vivants', () => {
    const d = mkdtempSync(join(tmpdir(), 'hdesk-purge-'))
    for (const id of ['vivant', 'mort']) {
      writeFileSync(join(d, `${id}.json`), JSON.stringify({ id }))
      mkdirSync(join(d, 'webview2', id, 'EBWebView'), { recursive: true })
      writeFileSync(join(d, 'webview2', id, 'EBWebView', 'x'), 'x')
    }
    expect(purgerBureauxFermes(d, ['vivant'])).toEqual(['mort'])
    expect(existsSync(join(d, 'mort.json'))).toBe(false)
    expect(existsSync(join(d, 'webview2', 'mort'))).toBe(false)
    expect(existsSync(join(d, 'vivant.json'))).toBe(true)
    expect(existsSync(join(d, 'webview2', 'vivant', 'EBWebView', 'x'))).toBe(true)
    rmSync(d, { recursive: true, force: true })
  })
})

describe('petite TV — application installée', () => {
  it('lit ses scripts hors de l’archive app.asar, que PowerShell ne sait pas ouvrir', () => {
    expect(racineScriptsHorsArchive('C:\\App\\resources\\app.asar')).toBe(
      join('C:', 'App', 'resources', 'app.asar.unpacked')
    )
    expect(racineScriptsHorsArchive('D:/depot')).toBe(join('D:', 'depot'))
  })

  it('les trois fichiers de capture sont extraits de l’archive au packaging', () => {
    const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    for (const f of [
      'scripts/hdesk-tv.ps1',
      'scripts/hdesk-observe.ps1',
      'scripts/hdesk-shot.cs',
      'scripts/hdesk-act.ps1',
      'scripts/hdesk-act.cs',
      'scripts/hdesk-basculer.ps1'
    ])
      expect(config).toContain(`- ${f}`)
  })
})

describe('petite TV du bureau caché — cas limites', () => {
  it('aucun bureau actif : liste vide, même si le registre garde des entrées périmées', () => {
    expect(
      fusionnerBureaux([], [{ id: 'vieux', travail: 'fini', conversationId: 'conv-1' }], 'conv-1')
    ).toEqual([])
  })

  it('plusieurs bureaux : chacun relié à son travail, ceux du fil seulement, plus récent d’abord', () => {
    const registre = [
      { id: 'a', travail: 'Roblox', conversationId: 'conv-1', lanceLe: '2026-09-13T10:00:00' },
      { id: 'b', travail: 'Excel', conversationId: 'conv-1', lanceLe: '2026-09-13T11:00:00' },
      { id: 'c', travail: 'Autre fil', conversationId: 'conv-2' }
    ]
    const r = fusionnerBureaux(['a', 'b', 'c', 'libre'], registre, 'conv-1')
    expect(r.map((b) => [b.id, b.travail])).toEqual([
      ['b', 'Excel'],
      ['a', 'Roblox']
    ])
  })

  it('bureaux non reliés à ce fil (restes de tests, autres fils) : aucun onglet', () => {
    expect(fusionnerBureaux(['libre'], [], 'conv-9')).toEqual([])
    expect(fusionnerBureaux(['c'], [{ id: 'c', conversationId: 'conv-2' }], 'conv-9')).toEqual([])
    expect(fusionnerBureaux(['libre'], [], undefined)).toEqual([])
  })

  it('le lanceur refuse un bureau sans travail ni conversation : il ne peut pas naître orphelin', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'), 'utf8')
    expect(src).toMatch(
      /\[Parameter\(Mandatory = \$true\)\]\[ValidateNotNullOrEmpty\(\)\]\[string\]\$Travail/
    )
    // Le fil vient de -Conversation OU de AUTOWIN_CONVERSATION_ID ; sans les deux, refus (prouvé
    // en exécution réelle dans orchestrator.fil-pour-agent.test.ts).
    expect(src).toMatch(/Fil absent/)
  })

  it('bureau fermé pendant qu’on regarde : « introuvable » devient l’état ferme', () => {
    const r = interpreterCapture(
      'a',
      { erreur: "Bureau 'AutowinTest_a' introuvable (Win32 2)." },
      png
    )
    expect(r).toEqual({ statut: 'ferme', id: 'a' })
  })

  it('capture unie : signalée comme telle, jamais comme une observation', () => {
    expect(interpreterCapture('a', { uni: true }, png).statut).toBe('uni')
    expect(interpreterCapture('a', { uni: false, width: 10, height: 5 }, png)).toMatchObject({
      statut: 'ok',
      width: 10
    })
  })

  it('le registre ignore les ids invalides et les fichiers illisibles', () => {
    const d = mkdtempSync(join(tmpdir(), 'reg-'))
    writeFileSync(join(d, 'ok.json'), '\uFEFF{"id":"ok","travail":"t"}')
    writeFileSync(join(d, 'mauvais.json'), '{"id":"../x"}')
    writeFileSync(join(d, 'casse.json'), '{')
    expect(lireRegistre(d).map((e) => e.id)).toEqual(['ok'])
  })
})

// Preuve réelle : processus ouvert, bureau lancé, capturé, fermé, puis constaté fermé.
describe.skipIf(process.platform !== 'win32' || !process.env.AUTOWIN_HDESK_REEL)(
  'TV — bureau réel',
  () => {
    it('liste, capture, fermeture observée', async () => {
      const racine = process.cwd()
      const reg = mkdtempSync(join(tmpdir(), 'reg-'))
      const id = `tvreel${Date.now()}`
      const sortie = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-File',
          'scripts/hdesk-lancer.ps1',
          '-Id',
          id,
          '-Executable',
          'C:/Windows/System32/charmap.exe',
          '-AttenteSecondes',
          '15',
          '-Travail',
          'preuve',
          '-Conversation',
          'conv-t'
        ],
        { encoding: 'utf8' }
      )
      const pid = JSON.parse(sortie).pid as number
      writeFileSync(
        join(reg, `${id}.json`),
        JSON.stringify({ id, travail: 'preuve', conversationId: 'conv-t' })
      )
      const c = new CapteurHdesk(racine, reg)
      try {
        expect((await c.bureaux('conv-t')).map((b) => b.travail)).toEqual(['preuve'])
        expect((await c.image(id)).statut).toBe('ok')
        process.kill(pid)
        await new Promise((r) => setTimeout(r, 1500))
        expect((await c.bureaux('conv-t')).some((b) => b.id === id)).toBe(false)
        expect((await c.image(id)).statut).toBe('ferme')
      } finally {
        c.detruire()
        // fix-ok: src/main/hdesk-tv.test.ts — hdesk-lancer.ps1 inscrit tvreel<id>.json dans %LOCALAPPDATA%/autowin-hdesk et rien ne l'effaçait (mesuré 2026-09-13 : 30+ restes).
        rmSync(join(process.env.LOCALAPPDATA ?? '', 'autowin-hdesk', `${id}.json`), { force: true })
      }
    }, 60000)
  }
)

/**
 * conv-344 (scout n°7) : la vue « Bureaux cachés » lançait un PowerShell NEUF à chaque tour de liste
 * (toutes les 4 s, 0,92 s mesurées par appel) alors que le processus de capture déjà ouvert sait
 * répondre `list`. Et seule la TV purgeait les fiches des bureaux fermés (scout n°13).
 * Faux hdesk-tv.ps1 : même protocole que le vrai, il compte ses démarrages dans un fichier.
 */
describe.skipIf(process.platform !== 'win32')(
  'processus de capture — liste brute pour la vue Bureaux cachés',
  () => {
    const fauxCapteur = (reponse: string): { racine: string; compteur: string } => {
      const racine = mkdtempSync(join(tmpdir(), 'tv-liste-'))
      mkdirSync(join(racine, 'scripts'))
      const compteur = join(racine, 'demarrages.txt')
      writeFileSync(
        join(racine, 'scripts', 'hdesk-tv.ps1'),
        [
          `Add-Content -LiteralPath '${compteur}' -Value 'demarrage'`,
          '[Console]::Out.WriteLine(\'{"pret":true}\'); [Console]::Out.Flush()',
          'while ($null -ne ($l = [Console]::In.ReadLine())) {',
          `  if ($l.Trim() -eq 'list') { [Console]::Out.WriteLine('${reponse}'); [Console]::Out.Flush() }`,
          '}'
        ].join('\n'),
        'utf8'
      )
      return { racine, compteur }
    }
    const fiches = (reg: string): void => {
      for (const id of ['vivant', 'mort'])
        writeFileSync(join(reg, `${id}.json`), JSON.stringify({ id, conversationId: 'conv-1' }))
      writeFileSync(join(reg, 'historique.jsonl'), '{"id":"mort"}\n')
    }

    it('trois tours de liste = UN seul PowerShell, et la fiche du bureau fermé est purgée', async () => {
      const { racine, compteur } = fauxCapteur('{"bureaux":["vivant","sans-fiche"]}')
      const reg = mkdtempSync(join(tmpdir(), 'tv-liste-reg-'))
      fiches(reg)
      const c = new CapteurHdesk(racine, reg)
      try {
        for (let i = 0; i < 3; i++)
          expect(await c.listeVivants()).toEqual({ ok: true, vivants: ['vivant', 'sans-fiche'] })
        expect(readFileSync(compteur, 'utf8').trim().split(/\r?\n/)).toEqual(['demarrage'])
        expect(existsSync(join(reg, 'mort.json'))).toBe(false)
        expect(existsSync(join(reg, 'vivant.json'))).toBe(true)
        // L'historique des lancements n'est pas une fiche : la purge n'y touche pas.
        expect(existsSync(join(reg, 'historique.jsonl'))).toBe(true)
      } finally {
        c.detruire()
        rmSync(racine, { recursive: true, force: true })
        rmSync(reg, { recursive: true, force: true })
      }
    }, 30000)

    it('liste en erreur : une ERREUR, jamais une liste vide, et rien n’est purgé', async () => {
      const { racine } = fauxCapteur('{"erreur":"EnumDesktops a echoue"}')
      const reg = mkdtempSync(join(tmpdir(), 'tv-liste-reg-'))
      fiches(reg)
      const c = new CapteurHdesk(racine, reg)
      try {
        expect(await c.listeVivants()).toEqual({ ok: false, message: 'EnumDesktops a echoue' })
        expect(existsSync(join(reg, 'mort.json'))).toBe(true)
        expect(existsSync(join(reg, 'vivant.json'))).toBe(true)
      } finally {
        c.detruire()
        rmSync(racine, { recursive: true, force: true })
        rmSync(reg, { recursive: true, force: true })
      }
    }, 30000)

    it('processus de capture mort : une erreur nommée, rien n’est purgé', async () => {
      const racine = mkdtempSync(join(tmpdir(), 'tv-liste-mort-'))
      mkdirSync(join(racine, 'scripts'))
      writeFileSync(join(racine, 'scripts', 'hdesk-tv.ps1'), 'exit 1\n')
      const reg = mkdtempSync(join(tmpdir(), 'tv-liste-reg-'))
      fiches(reg)
      const c = new CapteurHdesk(racine, reg)
      try {
        const r = await c.listeVivants()
        expect(r.ok).toBe(false)
        expect(existsSync(join(reg, 'mort.json'))).toBe(true)
      } finally {
        c.detruire()
        rmSync(racine, { recursive: true, force: true })
        rmSync(reg, { recursive: true, force: true })
      }
    }, 30000)
  }
)

describe.skipIf(process.platform !== 'win32')(
  'petite TV — repli quand le processus de capture meurt',
  () => {
    it('le processus ouvert plante : l’image vient de hdesk-observe.ps1', async () => {
      const racine = mkdtempSync(join(tmpdir(), 'tv-repli-'))
      const scripts = join(racine, 'scripts')
      execFileSync('cmd', ['/c', 'mkdir', scripts])
      // Processus ouvert qui meurt aussitôt, sans jamais répondre.
      writeFileSync(join(scripts, 'hdesk-tv.ps1'), 'exit 1\n')
      // Script de repli : écrit l’image demandée et rend le JSON réel de hdesk-observe.ps1.
      writeFileSync(
        join(scripts, 'hdesk-observe.ps1'),
        'param([string]$InstanceId, [string]$Output)\n' +
          "[IO.File]::WriteAllText($Output, 'png-repli')\n" +
          '@{ instanceId = $InstanceId; width = 640; height = 480; uni = $false } | ConvertTo-Json -Compress\n'
      )
      const capteur = new CapteurHdesk(racine, mkdtempSync(join(tmpdir(), 'tv-repli-reg-')))
      try {
        const img = await capteur.image('repli1')
        expect(img).toMatchObject({ statut: 'ok', id: 'repli1', width: 640, height: 480 })
        if (img.statut === 'ok')
          expect(Buffer.from(img.dataUrl.split(',')[1], 'base64').toString()).toBe('png-repli')
      } finally {
        capteur.detruire()
      }
    }, 30000)
  }
)

describe('petite TV — disque propre', () => {
  it('purge les dossiers de capture laissés par une app tuée, et seulement eux', () => {
    const racine = mkdtempSync(join(tmpdir(), 'tv-purge-'))
    mkdtempSync(join(racine, 'autowin-hdesk-tv-'))
    writeFileSync(join(racine, 'autre.txt'), 'x')
    expect(purgerDossiersOrphelins(racine)).toBe(1)
    expect(execFileSync('cmd', ['/c', 'dir', '/b', racine]).toString().trim()).toBe('autre.txt')
    rmSync(racine, { recursive: true, force: true })
  })
})

describe('fusionnerBureaux — application morte', () => {
  it('écarte un bureau dont le processus inscrit est mort, garde celui qui vit ou sans pid', () => {
    const registre = [
      { id: 'mort', travail: 'A', conversationId: 'c', pid: 11 },
      { id: 'vif', travail: 'B', conversationId: 'c', pid: 22 },
      { id: 'sanspid', travail: 'C', conversationId: 'c' }
    ]
    const ids = fusionnerBureaux(
      ['mort', 'vif', 'sanspid'],
      registre,
      'c',
      (pid) => pid === 22
    ).map((b) => b.id)
    expect(ids.sort()).toEqual(['sanspid', 'vif'])
  })

  it('processusVivant : vrai pour ce processus, faux pour un pid inexistant', () => {
    expect(processusVivant(process.pid)).toBe(true)
    expect(processusVivant(2 ** 30)).toBe(false)
  })
})

import { argumentsAct, agirHdesk, TOUCHES_TV } from './hdesk-tv'
describe('TV interactive — geste vers hdesk-act', () => {
  it('construit l’appel de hdesk-act.ps1 avec clic arrondi, texte et Entrée', () => {
    const a = argumentsAct('R', { id: 'run-1', x: 10.6, y: 4.2, texte: 'abc', entree: true })
    expect(a.slice(5)).toEqual([
      '-InstanceId',
      'run-1',
      '-X',
      '11',
      '-Y',
      '4',
      '-Texte',
      'abc',
      '-Entree'
    ])
    expect(a[4]).toBe(join('R', 'scripts', 'hdesk-act.ps1'))
  })
  it('refuse un identifiant hors ^[a-zA-Z0-9_-]+$ sans rien lancer', async () => {
    expect(() => argumentsAct('R', { id: 'a b;calc', x: 1, y: 1 })).toThrow(/invalide/)
    expect(await agirHdesk('R', { id: '../x', x: 1, y: 1 })).toEqual({
      ok: false,
      message: 'Identifiant de bureau invalide.'
    })
  })
  it('refuse des coordonnées non finies ou négatives', () => {
    expect(() => argumentsAct('R', { id: 'a', x: NaN, y: 1 })).toThrow()
    expect(() => argumentsAct('R', { id: 'a', x: -1, y: 1 })).toThrow()
  })
  // conv-344 : hdesk-act.cs range x et y sur 16 bits (lParam) — x = 70000 cliquait AILLEURS, sans erreur.
  it('refuse des coordonnées énormes (> 32767) ; jumeau accepté à 32767', () => {
    expect(() => argumentsAct('R', { id: 'a', x: 70000, y: 1 })).toThrow(/hors bornes/)
    expect(() => argumentsAct('R', { id: 'a', x: 1, y: 32768 })).toThrow(/hors bornes/)
    expect(argumentsAct('R', { id: 'a', x: 32767, y: 32767 })).toContain('32767')
  })
  it('refuse une frappe énorme (> 1000 caractères) ; jumeau accepté à 1000', () => {
    expect(() => argumentsAct('R', { id: 'a', x: 1, y: 1, texte: 'x'.repeat(1001) })).toThrow(
      /trop long/
    )
    expect(argumentsAct('R', { id: 'a', x: 1, y: 1, texte: 'x'.repeat(1000) })).toContain(
      'x'.repeat(1000)
    )
  })
  it('un registre donné (tests) part en -Registre ; sans lui, rien n’est ajouté', () => {
    expect(argumentsAct('R', { id: 'a', x: 1, y: 1 }, 'C:\\reg').slice(-2)).toEqual([
      '-Registre',
      'C:\\reg'
    ])
    expect(argumentsAct('R', { id: 'a', x: 1, y: 1 })).not.toContain('-Registre')
  })
})

/**
 * conv-344 (scout n°5) : chaque geste — de la TV, de la vue ou d'un agent — est noté dans
 * `<registre>/<id>.gestes.jsonl`, réussi ou refusé, SANS le texte tapé (seulement son nombre de
 * caractères). La carte du bureau montre les derniers. Vrai hdesk-act.ps1, registre temporaire.
 */
describe.skipIf(process.platform !== 'win32')('journal des gestes — vrai hdesk-act.ps1', () => {
  const lignes = (reg: string, id: string): Array<Record<string, unknown>> =>
    readFileSync(join(reg, `${id}.gestes.jsonl`), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

  it('geste refusé (aucun bureau) : noté ok=false, avec le nombre de caractères, jamais le texte', async () => {
    const reg = mkdtempSync(join(tmpdir(), 'hdesk-gestes-'))
    const id = `kzgeste${process.pid}`
    try {
      const r = await agirHdesk(
        process.cwd(),
        { id, x: 10, y: 20, texte: 'secret123', entree: true },
        reg
      )
      expect(r.ok).toBe(false)
      const brut = readFileSync(join(reg, `${id}.gestes.jsonl`), 'utf8')
      expect(brut).not.toContain('secret123')
      expect(lignes(reg, id)).toEqual([
        expect.objectContaining({
          ok: false,
          x: 10,
          y: 20,
          clic: true,
          caracteres: 9,
          entree: true,
          erreur: expect.any(String)
        })
      ])
      expect(typeof lignes(reg, id)[0].quand).toBe('string')
    } finally {
      rmSync(reg, { recursive: true, force: true })
    }
  }, 30000)

  it('geste réussi sur une vraie fenêtre : noté ok=true avec la cible', async () => {
    const reg = mkdtempSync(join(tmpdir(), 'hdesk-gestes-ok-'))
    const fixtures = mkdtempSync(join(tmpdir(), 'hdesk-gestes-app-'))
    const id = `kzgesteok${process.pid}`
    const ps = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const fenetre = join(fixtures, 'fenetre.ps1')
    writeFileSync(
      fenetre,
      "Add-Type -AssemblyName System.Windows.Forms\n$f = New-Object System.Windows.Forms.Form; $f.Text = 'gestes'; $f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(0, 0); $f.Size = New-Object System.Drawing.Size(400, 300)\n[void]$f.ShowDialog()\n"
    )
    const script = (nom: string, args: string[]): string =>
      execFileSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join('scripts', nom), ...args],
        { encoding: 'utf8' }
      )
    try {
      script('hdesk-lancer.ps1', [
        '-Id',
        id,
        '-Executable',
        ps,
        '-Arguments',
        `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${fenetre}"`,
        '-Travail',
        'test journal',
        '-Conversation',
        'conv-344',
        '-Registre',
        reg,
        '-SurvieSecondes',
        '1'
      ])
      const r = await agirHdesk(process.cwd(), { id, x: 120, y: 150 }, reg)
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect(lignes(reg, id).at(-1)).toMatchObject({ ok: true, x: 120, y: 150, clic: true })
    } finally {
      try {
        script('hdesk-fermer.ps1', [
          '-Id',
          id,
          '-Conversation',
          'conv-344',
          '-Registre',
          reg,
          '-DelaiDouxSecondes',
          '1'
        ])
      } catch {
        /* le filet ne doit pas masquer l'échec du test */
      }
      rmSync(reg, { recursive: true, force: true })
      rmSync(fixtures, { recursive: true, force: true })
    }
  }, 90000)

  it('journal borné aux 200 dernières lignes', async () => {
    const reg = mkdtempSync(join(tmpdir(), 'hdesk-gestes-'))
    const id = `kzgesteb${process.pid}`
    writeFileSync(
      join(reg, `${id}.gestes.jsonl`),
      Array.from({ length: 205 }, (_, i) => JSON.stringify({ n: i })).join('\n') + '\n'
    )
    try {
      await agirHdesk(process.cwd(), { id, x: 1, y: 2, touche: 'Tab', sansClic: true }, reg)
      const l = lignes(reg, id)
      expect(l).toHaveLength(200)
      expect(l.at(-1)).toMatchObject({ touche: 'Tab', clic: false, x: 1, y: 2 })
      expect(l[0]).toEqual({ n: 6 })
    } finally {
      rmSync(reg, { recursive: true, force: true })
    }
  }, 30000)
})

describe('bureau caché fermé — le journal des gestes part avec lui', () => {
  it('efface <id>.gestes.jsonl des bureaux fermés, fiche ou pas ; garde celui des vivants', () => {
    const d = mkdtempSync(join(tmpdir(), 'hdesk-purge-gestes-'))
    writeFileSync(join(d, 'mort.json'), JSON.stringify({ id: 'mort' }))
    for (const id of ['mort', 'vivant', 'ui-capture-1'])
      writeFileSync(join(d, `${id}.gestes.jsonl`), '{"ok":true}\n')
    purgerBureauxFermes(d, ['vivant'])
    expect(existsSync(join(d, 'mort.gestes.jsonl'))).toBe(false)
    expect(existsSync(join(d, 'ui-capture-1.gestes.jsonl'))).toBe(false)
    expect(existsSync(join(d, 'vivant.gestes.jsonl'))).toBe(true)
    rmSync(d, { recursive: true, force: true })
  })
})

import { resultatAct } from './hdesk-tv'
describe('TV interactive — retour de hdesk-act', () => {
  it('rend le JSON de hdesk-act (cible, messages) au lieu d’un simple ok', () => {
    const out = 'bruit\n{"instanceId":"a","x":1,"y":2,"cible":"RICHEDIT50W","messages":3}\n'
    expect(resultatAct(out)).toEqual({
      ok: true,
      action: { instanceId: 'a', x: 1, y: 2, cible: 'RICHEDIT50W', messages: 3 }
    })
  })
  it('reste ok sans JSON lisible', () => {
    expect(resultatAct('rien')).toEqual({ ok: true })
  })
})

import {
  argumentsBascule,
  argumentsLancementBascule,
  basculerHdesk,
  dependancesBascule,
  type DependancesBascule
} from './hdesk-tv'
describe('bascule de l’écran réel vers un bureau caché', () => {
  /** Faux système : la sortie de lancer-detache.ps1, puis la suite des lectures du fichier d'état. */
  const fauxSysteme = (
    sortie: string,
    lectures: Array<string | null>,
    code: number | null = 0
  ): DependancesBascule & { lances: string[][]; horloge: number } => {
    const f = {
      lances: [] as string[][],
      horloge: 0,
      executer: async (args: string[]) => {
        f.lances.push(args)
        return { code, sortie }
      },
      lire: () => (lectures.length > 1 ? lectures.shift()! : (lectures[0] ?? null)),
      supprimer: () => undefined,
      attendre: async (ms: number) => {
        f.horloge += ms
      },
      maintenant: () => f.horloge,
      fichierStatut: (id: string) => join('T', `statut-${id}.json`)
    }
    return f
  }
  const lance = '{"pid":4242,"horsJob":true,"commande":"x"}'
  const decoder = (args: string[]): string =>
    Buffer.from(args.at(-1)!, 'base64').toString('utf16le')

  it('appelle hdesk-basculer.ps1 avec l’id et une minuterie de retour bornée', () => {
    const a = argumentsBascule('R', 'run-1')
    expect(a[4]).toBe(join('R', 'scripts', 'hdesk-basculer.ps1'))
    expect(a.slice(5)).toEqual(['-InstanceId', 'run-1', '-MaxSecondes', '120'])
    expect(argumentsBascule('R', 'a', 99999).at(-1)).toBe('600')
    expect(argumentsBascule('R', 'a', 1).at(-1)).toBe('5')
  })
  it('refuse un identifiant invalide sans rien lancer', async () => {
    const f = fauxSysteme(lance, [])
    expect(await basculerHdesk('R', 'x;calc', f)).toEqual({
      ok: false,
      message: 'Identifiant de bureau invalide.'
    })
    expect(f.lances).toEqual([])
  })
  it('passe par lancer-detache.ps1 (WMI), jamais par un PowerShell détaché qui ne s’exécute pas', () => {
    const a = argumentsLancementBascule('D:\\Racine', 'run-1', "C:\\Temp dir\\o'k.json")
    expect(a.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    const ps = decoder(a)
    expect(ps).toContain(`& '${join('D:\\Racine', 'scripts', 'lancer-detache.ps1')}'`)
    expect(ps).toContain(
      `-File ${join('D:\\Racine', 'scripts', 'hdesk-basculer.ps1')} -InstanceId run-1`
    )
    // Le chemin d'état à espace est entre guillemets, l'apostrophe doublée pour la chaîne PowerShell.
    expect(ps).toContain(`-Statut "C:\\Temp dir\\o''k.json"`)
    expect(ps).toContain(`-Dossier 'D:\\Racine'`)
  })
  it('rend ok seulement quand le script annonce que l’écran a basculé', async () => {
    const f = fauxSysteme(lance, [null, null, '{"etat":"bascule"}'])
    expect(await basculerHdesk('R', 'run-1', f)).toEqual({ ok: true })
    expect(f.lances).toHaveLength(1)
  })
  it('remonte le message d’erreur écrit par le script', async () => {
    const f = fauxSysteme(lance, [
      null,
      '\uFEFF{"etat":"erreur","message":"Bureau cache introuvable : AutowinTest_run-1 (Win32 2)."}'
    ])
    expect(await basculerHdesk('R', 'run-1', f)).toEqual({
      ok: false,
      message: 'Bureau cache introuvable : AutowinTest_run-1 (Win32 2).'
    })
  })
  it('dit que le lancement a échoué quand lancer-detache.ps1 ne rend aucun processus', async () => {
    const f = fauxSysteme('{"erreur":"Win32_Process.Create a rendu 9","commande":"x"}', [], 1)
    const r = await basculerHdesk('R', 'run-1', f)
    expect(r).toEqual({
      ok: false,
      message: expect.stringContaining('Win32_Process.Create a rendu 9')
    })
  })
  it('ne prétend pas avoir basculé quand le script ne donne aucune nouvelle', async () => {
    const f = fauxSysteme(lance, [null])
    const r = await basculerHdesk('R', 'run-1', f, 1000)
    expect(r).toEqual({ ok: false, message: expect.stringContaining('aucune nouvelle') })
  })
  // VRAI lancement, sans toucher à l'écran : le bureau visé n'existe pas, donc le script échoue AVANT
  // de basculer. Avant la correction, le PowerShell détaché ne s'exécutait jamais et l'app rendait
  // { ok: true } : ce test prouve que le script tourne vraiment et que son erreur remonte.
  it.runIf(process.platform === 'win32')(
    'lance réellement le script et remonte son erreur (bureau inexistant, écran intact)',
    async () => {
      const racine = process.cwd()
      expect(existsSync(join(racine, 'scripts', 'hdesk-basculer.ps1'))).toBe(true)
      const dossier = mkdtempSync(join(tmpdir(), 'bascule avec espace-'))
      try {
        const id = `inexistant-${process.pid}-${Date.now()}`
        const r = await basculerHdesk(racine, id, {
          ...dependancesBascule(),
          fichierStatut: (i) => join(dossier, `statut-${i}.json`)
        })
        expect(r).toEqual({
          ok: false,
          message: expect.stringContaining(`Bureau cache introuvable : AutowinTest_${id}`)
        })
      } finally {
        rmSync(dossier, { recursive: true, force: true })
      }
    },
    60_000
  )
})

describe('TV interactive — touches et molette (conv-35)', () => {
  it('transmet une touche nommée, la molette et -SansClic', () => {
    expect(
      argumentsAct('R', { id: 'a', x: 1, y: 2, touche: 'CtrlV', sansClic: true }).slice(9)
    ).toEqual(['-Y', '2', '-Touche', 'CtrlV', '-SansClic'])
    expect(argumentsAct('R', { id: 'a', x: 1, y: 2, molette: -3 }).slice(-2)).toEqual([
      '-Molette',
      '-3'
    ])
  })
  it('refuse une touche hors liste et une molette hors bornes', () => {
    expect(() => argumentsAct('R', { id: 'a', x: 1, y: 1, touche: 'F13; calc' })).toThrow(/Touche/)
    expect(() => argumentsAct('R', { id: 'a', x: 1, y: 1, molette: 21 })).toThrow(/Molette/)
    expect(() => argumentsAct('R', { id: 'a', x: 1, y: 1, molette: 0.5 })).toThrow(/Molette/)
  })
  it('la liste des touches est alignée sur hdesk-act.cs', () => {
    const cs = readFileSync(join(process.cwd(), 'scripts', 'hdesk-act.cs'), 'utf8')
    const dansCs = [...cs.matchAll(/\{"(\w+)", new\[\]/g)].map((m) => m[1]).sort()
    expect(dansCs).toEqual([...TOUCHES_TV].sort())
  })
})

/**
 * CLIC DÉCALÉ DANS UNE IMAGE RECADRÉE (conv-1009, 2026-10-16) : « Action refusée : Aucune fenetre en
 * (362,144) dans ce bureau. dans la view bureaux virtuels les clicks marchent mal ». La TV et la vue
 * « Bureaux cachés » montrent une capture RECADRÉE autour des fenêtres (hdesk-shot.cs, recadrer=true),
 * mais le clic partait comme si l'image commençait au coin de l'écran. Mesure : boîte de dialogue en
 * (755,465) sur AutowinTest_ui-capture-38332, image recadrée depuis (747,457) ; le point (362,144) de
 * l'image est l'écran (1109,601), hdesk-act le cherchait en (362,144) où il n'y a rien.
 */
import { pointEcran } from './hdesk-tv'
describe('TV interactive — clic dans une image recadrée', () => {
  it('ramène le point de l’image au point de l’écran du bureau caché', () => {
    expect(pointEcran({ id: 'a', x: 362, y: 144 }, { x: 747, y: 457 })).toEqual({
      id: 'a',
      x: 1109,
      y: 601
    })
  })
  it('sans recadrage connu, le point reste celui de l’image (capture plein écran)', () => {
    expect(pointEcran({ id: 'a', x: 5, y: 6, texte: 't' }, undefined)).toEqual({
      id: 'a',
      x: 5,
      y: 6,
      texte: 't'
    })
  })
  it('laisse les coordonnées invalides au refus de argumentsAct, sans les maquiller', () => {
    const g = pointEcran({ id: 'a', x: NaN, y: 1 }, { x: 10, y: 10 })
    expect(() => argumentsAct('R', g)).toThrow(/Coordonnées/)
  })
})

describe.skipIf(process.platform !== 'win32')('TV interactive — origine de la capture', () => {
  it('garde l’origine du recadrage de CHAQUE bureau et l’applique à ses gestes', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'tv-origine-'))
    mkdirSync(join(racine, 'scripts'))
    // Faux processus de capture : même protocole que scripts/hdesk-tv.ps1 (pret, puis une ligne par demande).
    writeFileSync(
      join(racine, 'scripts', 'hdesk-tv.ps1'),
      [
        '[Console]::Out.WriteLine(\'{"pret":true}\'); [Console]::Out.Flush()',
        'while ($true) {',
        '  $l = [Console]::In.ReadLine(); if ($null -eq $l) { break }',
        "  $p = $l.Trim() -split '\\s+', 3",
        '  if ($p[1] -eq \'parti\') { $s = \'{"id":"parti","erreur":"Bureau introuvable (Win32 2)."}\' }',
        '  else { [IO.File]::WriteAllText($p[2], \'png\'); $s = \'{"id":"\' + $p[1] + \'","width":443,"height":182,"uni":false,"origineX":747,"origineY":457}\' }',
        '  [Console]::Out.WriteLine($s); [Console]::Out.Flush()',
        '}'
      ].join('\n')
    )
    const capteur = new CapteurHdesk(racine, mkdtempSync(join(tmpdir(), 'tv-origine-reg-')))
    try {
      expect((await capteur.image('dialogue')).statut).toBe('ok')
      expect(capteur.versEcran({ id: 'dialogue', x: 362, y: 144 })).toMatchObject({
        x: 1109,
        y: 601
      })
      // Un autre bureau jamais capturé : aucun décalage inventé.
      expect(capteur.versEcran({ id: 'autre', x: 362, y: 144 })).toMatchObject({ x: 362, y: 144 })
      // Bureau fermé : son origine est oubliée.
      expect((await capteur.image('parti')).statut).toBe('ferme')
      expect(capteur.versEcran({ id: 'parti', x: 1, y: 2 })).toMatchObject({ x: 1, y: 2 })
    } finally {
      capteur.detruire()
      rmSync(racine, { recursive: true, force: true })
    }
  }, 30000)
})

// Preuve réelle du scénario utilisateur : fenêtre loin du coin de l'écran, clic au CENTRE de l'image
// recadrée. Sans conversion, hdesk-act ne trouve aucune fenêtre (le message vu par l'utilisateur).
describe.skipIf(process.platform !== 'win32' || !process.env.AUTOWIN_HDESK_REEL)(
  'TV interactive — clic réel dans une image recadrée',
  () => {
    it('le centre de l’image atteint la fenêtre posée en (600,400)', async () => {
      const racine = process.cwd()
      const dossier = mkdtempSync(join(tmpdir(), 'tv-clic-reel-'))
      const formulaire = join(dossier, 'formulaire.ps1')
      writeFileSync(
        formulaire,
        'Add-Type -AssemblyName System.Windows.Forms\n' +
          '$f = New-Object System.Windows.Forms.Form\n' +
          "$f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(600, 400)\n" +
          '$f.Size = New-Object System.Drawing.Size(320, 220); $f.Text = "cible"\n' +
          '[System.Windows.Forms.Application]::Run($f)\n'
      )
      const id = `tvclic${Date.now()}`
      const reg = mkdtempSync(join(tmpdir(), 'reg-'))
      const sortie = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-File',
          'scripts/hdesk-lancer.ps1',
          '-Id',
          id,
          '-Executable',
          'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
          '-Arguments',
          `-NoProfile -ExecutionPolicy Bypass -File ${formulaire}`,
          '-AttenteSecondes',
          '30',
          '-Travail',
          'preuve clic recadre',
          '-Conversation',
          'conv-t',
          '-Registre',
          reg
        ],
        { encoding: 'utf8' }
      )
      const pid = JSON.parse(sortie.trim().split(/\r?\n/).pop() as string).pid as number
      const c = new CapteurHdesk(racine, reg)
      try {
        const img = await c.image(id)
        expect(img.statut).toBe('ok')
        if (img.statut !== 'ok') return
        expect(img.width).toBeLessThan(1000)
        const centre = {
          id,
          x: Math.round(img.width / 2),
          y: Math.round(img.height / 2),
          sansClic: true
        }
        const vise = await agirHdesk(racine, c.versEcran(centre))
        expect(vise).toMatchObject({
          ok: true,
          action: { cible: expect.stringMatching(/WindowsForms/) }
        })
        const brut = await agirHdesk(racine, centre)
        expect(brut).toMatchObject({ ok: false, message: expect.stringMatching(/Aucune fenetre/) })
      } finally {
        c.detruire()
        process.kill(pid)
        rmSync(dossier, { recursive: true, force: true })
      }
    }, 90000)
  }
)
