const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApp', {
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  entries: {
    list: () => ipcRenderer.invoke('entries:list'),
    write: (date, content) => ipcRenderer.invoke('entries:write', { date, content }),
    getDirectory: () => ipcRenderer.invoke('entries:getDirectory'),
  },
})