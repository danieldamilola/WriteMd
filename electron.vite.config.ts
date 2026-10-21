import { defineConfig } from 'electron-vite'

/*
 * `ELECTRON_RUN_AS_NODE=1` turns the Electron binary into plain Node, so the
 * main bundle loads without `electron.app` and dies inside
 * @electron-toolkit/utils with "Cannot read properties of undefined (reading
 * 'isPackaged')" before any of our code runs. The variable lingers in some
 * terminal sessions, so `pnpm start` and `pnpm dev` failed with a stack trace
 * that never mentions the cause.
 *
 * electron-vite spawns Electron as a child and hands it this process's
 * environment, so clearing it here covers both commands without a wrapper
 * script. A deliberate `node out/main/index.js` is unaffected.
 */
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {},
  preload: {},
  renderer: {}
})
