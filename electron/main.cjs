const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const entryDirName = 'entries'
const dateFilePattern = /^\d{4}-\d{2}-\d{2}$/
const flushTimeoutMs = 800

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
// 打包后窗口图标来自 exe 内嵌资源，开发时手动指向 build/icon.ico
const windowIcon = isDev ? path.join(__dirname, '../build/icon.ico') : undefined

let mainWindow = null
let allowClose = false
let pendingFlush = null

const ensureEntryDir = async () => {
  const dir = path.join(app.getPath('userData'), entryDirName)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const toFilePath = async (date) => {
  if (typeof date !== 'string' || !dateFilePattern.test(date)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD')
  }

  const dir = await ensureEntryDir()
  return path.join(dir, `${date}.md`)
}

// 单篇读取失败只跳过这一篇，不影响整表；失败清单回传给界面提示
ipcMain.handle('entries:list', async () => {
  const dir = await ensureEntryDir()
  const fileNames = await fs.readdir(dir)
  const entries = {}
  const failed = []

  await Promise.all(
    fileNames
      .filter((name) => name.endsWith('.md'))
      .map(async (name) => {
        const date = name.slice(0, -3)
        if (!dateFilePattern.test(date)) {
          return
        }

        try {
          entries[date] = await fs.readFile(path.join(dir, name), 'utf8')
        } catch (error) {
          failed.push(date)
        }
      }),
  )

  return { entries, failed }
})

ipcMain.handle('entries:write', async (_event, payload) => {
  const { date, content } = payload || {}
  if (typeof date !== 'string' || typeof content !== 'string') {
    throw new Error('Invalid payload for entries:write')
  }

  const filePath = await toFilePath(date)

  if (!content.trim()) {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    return { saved: false }
  }

  // 先写临时文件再替换，避免断电或崩溃留下半截日记
  const tempPath = `${filePath}.tmp`
  await fs.writeFile(tempPath, content, 'utf8')
  await fs.rename(tempPath, filePath)
  return { saved: true }
})

ipcMain.handle('entries:getDirectory', async () => {
  return ensureEntryDir()
})

ipcMain.handle('entries:openDirectory', async () => {
  const dir = await ensureEntryDir()
  const error = await shell.openPath(dir)

  if (error) {
    throw new Error(error)
  }

  return dir
})

// 渲染层完成最后一次落盘后回报，主进程再真正关窗
ipcMain.on('app:flush-done', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }

  finishClose(win)
})

const finishClose = (win) => {
  if (pendingFlush) {
    clearTimeout(pendingFlush.timer)
    pendingFlush = null
  }

  allowClose = true

  if (win && !win.isDestroyed()) {
    win.destroy()
  }
}

const buildMenu = () => {
  const template = [
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev
          ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }]
          : []),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 620,
    title: '日记日历',
    backgroundColor: '#fbfbf9',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow = win

  // 外链一律交给系统浏览器，应用本身不被导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const isAppUrl =
      url.startsWith('file://') || (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL))
    if (isAppUrl) {
      return
    }

    event.preventDefault()
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
  })

  // 关窗前先让渲染层把未落盘的输入写完
  win.on('close', (event) => {
    if (allowClose || win.webContents.isDestroyed()) {
      return
    }

    event.preventDefault()
    win.webContents.send('app:flush')

    const timer = setTimeout(() => {
      finishClose(win)
    }, flushTimeoutMs)

    pendingFlush = { win, timer }
  })

  win.on('closed', () => {
    mainWindow = null
    pendingFlush = null
    allowClose = false
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已有实例在运行，直接退出，避免两个进程写同一批文件
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })

  app.setAppUserModelId('com.diary.calendar')

  app.whenReady().then(() => {
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
