# 日记日历

一个安静、克制的本地日记应用。左侧月历选日期，右侧用 Markdown 书写，内容实时排版成文。

数据不经过任何服务器：**一天一个纯文本 `.md` 文件**，写在你自己电脑上。

## 下载

Windows 安装包见 [Releases](https://github.com/qinghuan-yu/Minimalist-Calendar/releases/latest)。

安装包未做代码签名，Windows 可能提示「未知发布者」，选择「仍要运行」即可。

## 设计

沿用博客的纸白 + 衬线排版体系：

- 背景 `#fbfbf9`，纸面 `#ffffff`，全部结构靠 1px 细线分隔，不用阴影和卡片堆叠
- 正文与标题使用衬线字体（Georgia / Noto Serif SC / Songti SC），标签用无衬线体拉开字距
- 藏青 `#173765` 只用在当前选中、链接和主操作上
- 数字统一等宽（`tabular-nums`），日期、统计不会跳动

## 功能

- 月历视图，有日记的日子带一个小圆点
- 按日期写 Markdown，所见即所得的阅读态与编辑态切换
- 输入自动保存（防抖 400 ms），面板右上角显示保存状态
- `Esc` 结束编辑，`Ctrl + S` 立即保存
- Markdown 渲染经过 DOMPurify 清洗，正文外链交给系统浏览器打开
- 关闭窗口前会等待最后一次写入完成

## 数据在哪

```
Windows: %APPDATA%\diary-calendar-app\entries\YYYY-MM-DD.md
macOS:   ~/Library/Application Support/diary-calendar-app/entries/
Linux:   ~/.config/diary-calendar-app/entries/
```

应用内左下角「打开数据目录」可以直接跳转。

因为是明文，你可以用 git 版本管理、用 Obsidian 打开、或者直接 `grep`。删掉应用，日记还在。

浏览器里直接打开（不走 Electron）时会退化为 `localStorage`，仅供预览样式用。

## 开发

```bash
npm install
npm run dev        # 同时启动 Vite (5173) 与 Electron
```

## 构建

```bash
npm run build          # 只构建前端资源到 dist/
npm run build:desktop  # 构建并打包 Windows 安装包到 released/
```

安装包使用 `build/icon.ico` 作为图标，NSIS 为可选安装目录的常规安装器。

如果 `npm install` 时 Electron 二进制下载失败，通常是网络问题，可先尝试：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm rebuild electron
```

## 技术栈

Vue 3 · Vite · Electron · dayjs · markdown-it · DOMPurify
