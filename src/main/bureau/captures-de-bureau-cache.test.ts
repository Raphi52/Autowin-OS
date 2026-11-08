import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  JOURNAL_CAPTURES,
  cheminComparable,
  estCaptureDeBureauCache,
  imageDOutilMontreeDansLeFil
} from './captures-de-bureau-cache'
import {
  noterCapture,
  inscrireFiche,
  filDeLAgent
} from '../../../scripts/bureau-cache-registre.mjs'

const dossiers: string[] = []
const registreNeuf = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'captures-hdesk-'))
  dossiers.push(d)
  return d
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('captures de bureau caché hors du fil', () => {
  it("l'image de bureau_cache_observer ne va pas dans le fil, celle de desktop_observe si", () => {
    expect(imageDOutilMontreeDansLeFil('bureau_cache_observer')).toBe(false)
    expect(imageDOutilMontreeDansLeFil('desktop_observe')).toBe(true)
    expect(imageDOutilMontreeDansLeFil('navigateur_capture')).toBe(true)
  })

  it('reconnaît une capture notée par un script, quelle que soit la forme du chemin', () => {
    const registre = registreNeuf()
    expect(noterCapture('D:\\Proj\\artifacts\\studio.png', { id: 'ui-capture-12', registre })).toBe(
      true
    )
    expect(estCaptureDeBureauCache('D:\\Proj\\artifacts\\studio.png', registre)).toBe(true)
    expect(estCaptureDeBureauCache('d:/proj/ARTIFACTS/studio.png', registre)).toBe(true)
    expect(estCaptureDeBureauCache('/d/Proj/artifacts/studio.png', registre)).toBe(true)
  })

  it("une image que l'utilisateur a jointe ou que l'agent a générée reste dans le fil", () => {
    const registre = registreNeuf()
    noterCapture('D:\\Proj\\artifacts\\studio.png', { registre })
    expect(estCaptureDeBureauCache('D:\\Proj\\artifacts\\autre.png', registre)).toBe(false)
    expect(estCaptureDeBureauCache(undefined, registre)).toBe(false)
    expect(estCaptureDeBureauCache('D:\\x.png', registreNeuf())).toBe(false)
  })

  it('une ligne abîmée du journal ne cache pas les autres', () => {
    const registre = registreNeuf()
    writeFileSync(
      join(registre, JOURNAL_CAPTURES),
      `{"chemin":"C:\\\\a.png"}\n{abîmée\n{"chemin":"C:\\\\b.png"}\n`
    )
    expect(estCaptureDeBureauCache('C:\\b.png', registre)).toBe(true)
    expect(estCaptureDeBureauCache('C:\\a.png', registre)).toBe(true)
  })

  it('le chemin comparable est absolu, en minuscules, à barres obliques', () => {
    expect(cheminComparable('C:\\Dossier\\Image.PNG')).toBe('c:/dossier/image.png')
  })
})

describe('fiche du bureau ouvert par un script', () => {
  it('relie le bureau au fil du chat, pour que son onglet le montre et s’ouvre', () => {
    const registre = registreNeuf()
    const chemin = inscrireFiche({
      id: 'ui-capture-42',
      travail: 'Capture d’interface (ui-capture)',
      conversationId: filDeLAgent({ AUTOWIN_FIL_DU_CHAT: 'conv-1713' }),
      registre,
      maintenant: () => new Date('2026-11-08T10:00:00Z')
    })
    expect(JSON.parse(readFileSync(chemin, 'utf8'))).toEqual({
      id: 'ui-capture-42',
      travail: 'Capture d’interface (ui-capture)',
      conversationId: 'conv-1713',
      lanceLe: '2026-11-08T10:00:00.000Z'
    })
  })

  it("le fil d'un run passe avant celui du chat ; un identifiant douteux n'est pas un fil", () => {
    expect(filDeLAgent({ AUTOWIN_CONVERSATION_ID: 'conv-1', AUTOWIN_FIL_DU_CHAT: 'conv-2' })).toBe(
      'conv-1'
    )
    expect(filDeLAgent({ AUTOWIN_FIL_DU_CHAT: '../x' })).toBeUndefined()
    expect(filDeLAgent({})).toBeUndefined()
    expect(inscrireFiche({ id: '../x', registre: registreNeuf() })).toBeNull()
  })
})
