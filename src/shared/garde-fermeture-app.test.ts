import { describe, expect, it } from 'vitest'
import { refusFermetureApplication } from './garde-fermeture-app'

describe('refusFermetureApplication', () => {
  it('refuse la fermeture par NOM (conv-660, turnId 726f9797-7e65-44c7-97ee-c5a1b5d4478b)', () => {
    for (const cmd of [
      'taskkill /F /IM RigV3Desktop.exe',
      'Stop-Process -Name RigV3Desktop -Force',
      'pkill RigV3Desktop'
    ]) {
      const motif = refusFermetureApplication(cmd)
      expect(motif, cmd).toBeTruthy()
      expect(motif).toContain('hdesk-lancer.ps1')
      expect(motif).toContain('dotnet msbuild -t:Compile')
    }
  })

  it("laisse passer un pid connu, une lecture, et tout le reste", () => {
    for (const cmd of [
      'taskkill /PID 4321 /F',
      'Stop-Process -Id 4321',
      'dotnet msbuild -t:Compile',
      'git log -S "taskkill /IM app.exe"',
      ''
    ]) {
      expect(refusFermetureApplication(cmd), cmd).toBeUndefined()
    }
  })
})
