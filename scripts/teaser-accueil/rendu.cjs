// Rend les images du teaser hors écran, au processeur seul : ni la carte graphique ni l'écran
// de l'utilisateur ne sont touchés, et le processus passe sous la priorité normale.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const fs = require('fs'),
  path = require('path'),
  os = require('os')
const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'))
for (const [k, v] of [
  ['use-gl', 'angle'],
  ['use-angle', 'swiftshader'],
  ['enable-unsafe-swiftshader'],
  ['ignore-gpu-blocklist'],
  ['in-process-gpu'],
  ['disable-gpu-watchdog'],
  ['disable-gpu-process-crash-limit']
])
  app.commandLine.appendSwitch(k, v)
// La priorité basse protège l'écran de l'utilisateur. Un long rendu peut s'en passer : `prioriteNormale`.
// Elle ne suffit pas à garder la vitesse : le 2026-10-31 (conv-1401, i5-14400), un moteur en priorité
// normale est retombé à 40 s par image sur les 4 fils lents ; seule l'affinité vers les fils rapides l'a
// ramené à 22 s. Voir film5.mjs.
if (!cfg.prioriteNormale) os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL)
fs.mkdirSync(cfg.sortie, { recursive: true })
ipcMain.handle('config', () => cfg)
ipcMain.handle('image', (_e, { nom, largeur, hauteur, pixels }) => {
  const bgra = Buffer.alloc(pixels.length)
  for (let y = 0; y < hauteur; y++) {
    const de = (hauteur - 1 - y) * largeur * 4,
      vers = y * largeur * 4
    for (let i = 0; i < largeur * 4; i += 4) {
      bgra[vers + i] = pixels[de + i + 2]
      bgra[vers + i + 1] = pixels[de + i + 1]
      bgra[vers + i + 2] = pixels[de + i]
      bgra[vers + i + 3] = 255
    }
  }
  fs.writeFileSync(
    path.join(cfg.sortie, nom + '.png'),
    nativeImage.createFromBitmap(bgra, { width: largeur, height: hauteur }).toPNG()
  )
})
ipcMain.handle('log', (_e, m) => {
  console.log(m)
})
ipcMain.handle('fin', (_e, code) => {
  app.exit(code)
})
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('page perdue', JSON.stringify(d))
    app.exit(4)
  })
  await win.loadFile(path.join(__dirname, 'rendu.html'))
})
