const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApp', {
  entries: {
    list: () => ipcRenderer.invoke('entries:list'),
    write: (date, content) => ipcRenderer.invoke('entries:write', { date, content }),
    getDirectory: () => ipcRenderer.invoke('entries:getDirectory'),
    openDirectory: () => ipcRenderer.invoke('entries:openDirectory'),
  },
  // 主进程准备关窗时通知渲染层把防抖中的内容立刻落盘
  onFlush: (handler) => {
    if (typeof handler !== 'function') {
      return () => {}
    }

    const listener = () => {
      handler()
    }

    ipcRenderer.on('app:flush', listener)
    return () => ipcRenderer.removeListener('app:flush', listener)
  },
  flushDone: () => ipcRenderer.send('app:flush-done'),
})
