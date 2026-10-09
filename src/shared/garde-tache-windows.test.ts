// fix-ok: cause mesurée — un filtre large /[a-z]+-scheduledtask/ refusait aussi la lecture et la suppression (Get-, Unregister-, New-ScheduledTaskAction : 3 tests rouges sur 13, réinjection du 2026-10-09) ; d'où la liste étroite register|set + schtasks /create|/change + COM RegisterTaskDefinition.
import { describe, expect, it } from 'vitest'
import { refusTacheWindows } from './garde-tache-windows'

describe('refusTacheWindows — rien de créé hors du Task Manager d’Autowin', () => {
  it.each([
    'schtasks /create /tn X /tr notepad.exe /sc daily',
    'SCHTASKS.EXE /Change /TN X /ENABLE',
    'cmd /c "schtasks -create /tn X /tr y /sc once /st 10:00"',
    'Register-ScheduledTask -TaskName X -Action $a -Trigger $t',
    'powershell -Command "Get-ScheduledTask X | Set-ScheduledTask -Trigger $t"',
    "$s=New-Object -ComObject Schedule.Service; $s.Connect(); $f=$s.GetFolder('root'); $f.RegisterTaskDefinition('X',$d,6,$null,$null,3)"
  ])('refuse la création ou la modification : %s', (commande) => {
    const motif = refusTacheWindows(commande)
    expect(motif).toMatch(/task_create/)
    expect(motif).toMatch(/Task Manager/)
  })

  it.each([
    'schtasks /query /fo list',
    'Get-ScheduledTask -TaskName X',
    'schtasks /delete /tn X /f',
    'Unregister-ScheduledTask -TaskName X -Confirm:$false',
    '$a = New-ScheduledTaskAction -Execute notepad.exe',
    'grep -n "createTask" src/main/task-manager/task-store.ts',
    ''
  ])('laisse passer la lecture, la suppression et le reste : %s', (commande) => {
    expect(refusTacheWindows(commande)).toBeUndefined()
  })
})
