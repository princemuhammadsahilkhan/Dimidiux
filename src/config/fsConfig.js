let defaultDesktopRoot = '/home/kali/Desktop';
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  try {
    const os = typeof globalThis.require === 'function' ? globalThis.require('os') : null;
    if (os && typeof os.homedir === 'function') {
      defaultDesktopRoot = `${os.homedir()}/Desktop`.replace(/\\/g, '/');
    }
  } catch (e) {}
}

export const fsConfig = {
  workspaceRoot: '/home/kali/Desktop/Evo/workspace',
  desktopRoot: defaultDesktopRoot
};

export default fsConfig;
