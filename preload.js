// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lynechat', {
  call: (method, ...args) => ipcRenderer.invoke('lynechat:call', method, args),
  saveFile: (name, content, filters) => ipcRenderer.invoke('lynechat:saveFile', { name, content, filters }),
  openExternal: (url) => ipcRenderer.invoke('lynechat:openExternal', url),
  on: (cb) => {
    const h = (e, msg) => cb(msg);
    ipcRenderer.on('lynechat:event', h);
    return () => ipcRenderer.removeListener('lynechat:event', h);
  },
});
