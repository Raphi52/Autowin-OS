export const withDeviceMetricsOverride = async (send, metrics, run, restore = async () => {}) => {
  await send('Emulation.setDeviceMetricsOverride', metrics)
  try {
    return await run()
  } finally {
    try {
      await send('Emulation.clearDeviceMetricsOverride')
    } finally {
      try {
        await restore()
      } finally {
        await send('Page.reload', { ignoreCache: false })
      }
    }
  }
}
