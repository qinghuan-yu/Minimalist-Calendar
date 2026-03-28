# 日记日历

一个基于 Vue 3、Vite 和 Electron 的桌面日记应用。

## 功能

- 月历视图选择日期
- 按日期写 Markdown 日记
- 右侧实时预览 Markdown
- 本地 localStorage 自动保存
- 预留 Electron 打包配置，可直接生成 Windows 安装包

## 开发

```bash
npm install
npm run dev
```

开发模式会同时启动 Vite 和 Electron。

## 构建 Web 资源

```bash
npm run build
```

## 打包桌面应用

```bash
npm run build:desktop
```

打包产物会输出到 released 目录。

## 当前验证结果

- 已验证 `npm run build` 可以正常产出 Vite 前端资源。
- Electron 主进程和 electron-builder 配置已接入。
- 如果本机执行 `npm install` 时 Electron 二进制下载失败，通常是网络或证书链问题，不是项目代码问题。

在 PowerShell 下可以优先尝试：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm rebuild electron
```

如果仍然失败，需要切换到可以正常建立 TLS 连接的网络环境后再执行桌面打包。