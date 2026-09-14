import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import {
  CapteurHdesk,
  fusionnerBureaux,
  interpreterCapture,
  lireRegistre,
  racineScriptsHorsArchive
} from './hdesk-tv'

const png = (): Buffer => Buffer.from('png')

describe('petite TV — application installée', () => {
  it('lit ses scripts hors de l’archive app.asar, que PowerShell ne sait pas ouvrir', () => {
    expect(racineScriptsHorsArchive('C:\\App\\resources\\app.asar')).toBe(
      join('C:', 'App', 'resources', 'app.asar.unpacked')
    )
    expect(racineScriptsHorsArchive('D:/depot')).toBe(join('D:', 'depot'))
  })

  it('les trois fichiers de capture sont extraits de l’archive au packaging', () => {
    const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    for (const f of ['scripts/hdesk-tv.ps1', 'scripts/hdesk-observe.ps1', 'scripts/hdesk-shot.cs'])
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
