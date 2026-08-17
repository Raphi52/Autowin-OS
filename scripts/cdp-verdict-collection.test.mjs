import { expect, it } from 'vitest'

it('peut etre collecte sans terminer le worker Vitest', async () => {
  await expect(import('./cdp-verdict.test.mjs')).resolves.toBeDefined()
})
