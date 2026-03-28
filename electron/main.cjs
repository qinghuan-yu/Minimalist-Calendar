const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const entryDirName = 'entries'
const dateFilePattern = /^\d{4}-\d{2}-\d{2}$/

const ensureEntryDir = async () => {
  const dir = path.join(app.getPath('userData'), entryDirName)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const toFilePath = async (date) => {
  if (!dateFilePattern.test(date)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD')
  }

  const dir = await ensureEntryDir()
  return path.join(dir, `${date}.md`)
}

ipcMain.handle('entries:list', async () => {
  const dir = await ensureEntryDir()
  const fileNames = await fs.readdir(dir)
  const mdFiles = fileNames.filter((name) => name.endsWith('.md'))
  const pairs = await Promise.all(
    mdFiles.map(async (name) => {
      const date = name.slice(0, -3)
      if (!dateFilePattern.test(date)) {
        return null
      }

      const filePath = path.join(dir, name)
      const content = await fs.readFile(filePath, 'utf8')
      return [date, content]
    }),
  )

  return Object.fromEntries(pairs.filter(Boolean))
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

  await fs.writeFile(filePath, content, 'utf8')
  return { saved: true }
})

ipcMain.handle('entries:getDirectory', async () => {
  return ensureEntryDir()
})

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f7f3eb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
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