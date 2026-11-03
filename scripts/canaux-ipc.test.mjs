import { describe, expect, it } from 'vitest'
import { canauxDuTexte, comparerCanaux } from './canaux-ipc.mjs'

describe('canaux-ipc — le comparatif du compte de security-critical-fixes (conv-1451)', () => {
  it('lit un appel écrit sur plusieurs lignes, que le grep ligne à ligne ratait', () => {
    const texte = [
      "ipcMain.handle('os:un', (event) => {})",
      'ipcMain.handle(',
      "  'os:deux',",
      '  async (event) => {}',
      ')',
      "ipcRenderer.invoke('os:pas-un-canal')"
    ].join('\r\n')
    expect(canauxDuTexte(texte, 'x.ts').map((c) => c.canal)).toEqual(['os:un', 'os:deux'])
  })

  it('nomme les ajoutés et les retirés par leur nom, pas par leur fichier', () => {
    const avant = [
      { canal: 'a', fichier: 'index.ts' },
      { canal: 'b', fichier: 'index.ts' }
    ]
    const apres = [
      { canal: 'a', fichier: 'ipc/deplace.ts' },
      { canal: 'c', fichier: 'ipc/neuf.ts' }
    ]
    expect(comparerCanaux(avant, apres)).toEqual({
      avant: 2,
      apres: 2,
      ajoutes: [{ canal: 'c', fichier: 'ipc/neuf.ts' }],
      retires: [{ canal: 'b', fichier: 'index.ts' }]
    })
  })
})
