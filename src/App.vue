<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

dayjs.locale('zh-cn')

const storageKey = 'diary-calendar-entries'
const saveDelay = 400

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// 正文里的链接一律走新窗口，再由主进程转交系统浏览器
const defaultLinkOpen =
  markdown.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const desktopApp = window.desktopApp
const desktopEntries = desktopApp?.entries

const now = () => dayjs()

const currentMonth = ref(now().startOf('month'))
const selectedDate = ref(now().format('YYYY-MM-DD'))
const todayIso = ref(now().format('YYYY-MM-DD'))
const entries = ref({})
const isEditing = ref(false)
const editorRef = ref(null)
const loadState = ref('loading')
const loadError = ref('')
const failedDates = ref([])
const saveTimer = ref(null)
const saveState = ref('idle')
const lastSavedAt = ref('')

let isDirty = false
let dayTimer = null
let disposeFlush = null

const normalizeEntries = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([date, text]) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date),
    ),
  )
}

const safeParseEntries = () => {
  try {
    return normalizeEntries(JSON.parse(window.localStorage.getItem(storageKey) || '{}'))
  } catch {
    return {}
  }
}

const persistFallbackEntries = (value) => {
  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

const writeEntry = async (date, content) => {
  if (loadState.value !== 'ready') {
    throw new Error('日记尚未加载完成，暂不写入')
  }

  saveState.value = 'saving'

  try {
    if (desktopEntries) {
      await desktopEntries.write(date, content)
    } else {
      persistFallbackEntries(entries.value)
    }

    lastSavedAt.value = now().format('HH:mm')
    saveState.value = 'saved'
  } catch (error) {
    saveState.value = 'error'
    throw error
  }
}

const loadEntries = async () => {
  if (!desktopEntries) {
    entries.value = safeParseEntries()
    return
  }

  const result = await desktopEntries.list()
  const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : {}

  entries.value = normalizeEntries(payload.entries)
  failedDates.value = Array.isArray(payload.failed) ? payload.failed : []
}

const loadAll = async () => {
  loadState.value = 'loading'
  loadError.value = ''

  try {
    await loadEntries()
    loadState.value = 'ready'
  } catch (error) {
    console.error(error)
    loadError.value = error?.message || '无法读取日记目录'
    loadState.value = 'error'
  }
}

const commit = async (date) => {
  const content = entries.value[date] || ''
  await writeEntry(date, content)
  isDirty = false
}

// 立刻把挂起的输入落盘；没有改动时直接返回
const persistNow = async (date) => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
    saveTimer.value = null
  }

  if (!isDirty) {
    return
  }

  await commit(date)
}

const scheduleSave = () => {
  isDirty = true
  const activeDate = selectedDate.value

  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  saveTimer.value = setTimeout(() => {
    saveTimer.value = null
    commit(activeDate).catch(console.error)
  }, saveDelay)
}

const flushPending = async () => {
  if (loadState.value !== 'ready') {
    return
  }

  try {
    await persistNow(selectedDate.value)
  } catch (error) {
    console.error(error)
  }
}

watch(selectedDate, (value) => {
  const parsed = dayjs(value)

  if (!parsed.isValid()) {
    selectedDate.value = todayIso.value
    return
  }

  currentMonth.value = parsed.startOf('month')
})

const monthLabel = computed(() => currentMonth.value.format('YYYY 年 M 月'))

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

const calendarDays = computed(() => {
  const firstDay = currentMonth.value.day()
  const offset = (firstDay + 6) % 7
  const gridStart = currentMonth.value.subtract(offset, 'day')

  return Array.from({ length: 42 }, (_, index) => {
    const date = gridStart.add(index, 'day')
    const iso = date.format('YYYY-MM-DD')
    const hasEntry = Boolean((entries.value[iso] || '').trim())

    return {
      iso,
      label: date.date(),
      inMonth: date.isSame(currentMonth.value, 'month'),
      isToday: iso === todayIso.value,
      isSelected: iso === selectedDate.value,
      hasEntry,
      ariaLabel: `${date.format('YYYY 年 M 月 D 日')}${hasEntry ? '，已有日记' : '，暂无日记'}`,
    }
  })
})

const selectedDay = computed(() => {
  const parsed = dayjs(selectedDate.value)
  return parsed.isValid() ? parsed : now()
})

const selectedDayLabel = computed(() => selectedDay.value.format('M 月 D 日 dddd'))

const currentEntry = computed({
  get: () => entries.value[selectedDate.value] || '',
  set: (value) => {
    if (!dayjs(selectedDate.value).isValid()) {
      return
    }

    entries.value = {
      ...entries.value,
      [selectedDate.value]: value,
    }

    // 在 setter 里同步标脏：watcher 要等到下个 tick，
    // 而失焦/切日期可能就在这一拍之前发生，会漏掉最后一次写入
    if (loadState.value === 'ready') {
      scheduleSave()
    }
  },
})

const renderedMarkdown = computed(() => {
  // DOMPurify 默认会去掉 target，这里显式放行（配合 rel=noopener noreferrer）
  return DOMPurify.sanitize(markdown.render(currentEntry.value || ''), { ADD_ATTR: ['target'] })
})

const stripMarkdown = (text) =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/\s+/g, '')

const wordCount = computed(() => stripMarkdown(currentEntry.value).length)

const filledDays = computed(() => {
  return Object.values(entries.value).filter((value) => value.trim()).length
})

const saveStateLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'error') return '保存失败'
  if (saveState.value === 'saved') return `已保存 ${lastSavedAt.value}`
  return ''
})

const switchDate = (iso) => {
  if (!iso || iso === selectedDate.value || !dayjs(iso).isValid()) {
    return
  }

  persistNow(selectedDate.value).catch(console.error)

  selectedDate.value = iso
  currentMonth.value = dayjs(iso).startOf('month')
}

const selectDate = (iso) => {
  switchDate(iso)
}

const shiftMonth = (amount) => {
  currentMonth.value = currentMonth.value.add(amount, 'month').startOf('month')
}

const jumpToToday = () => {
  const iso = todayIso.value

  if (selectedDate.value === iso) {
    currentMonth.value = now().startOf('month')
    return
  }

  switchDate(iso)
}

const enterEditing = async () => {
  if (loadState.value !== 'ready') {
    return
  }

  isEditing.value = true
  await nextTick()
  editorRef.value?.focus()
}

const leaveEditing = () => {
  if (!isEditing.value) {
    return
  }

  persistNow(selectedDate.value).catch(console.error)
  isEditing.value = false
}

const handleBodyClick = (event) => {
  if (isEditing.value) {
    return
  }

  if (event.target.closest('a')) {
    return
  }

  enterEditing()
}

const handleComposeKeydown = (event) => {
  if (isEditing.value) {
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    enterEditing()
  }
}

const handleEditorKeydown = (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    leaveEditing()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    persistNow(selectedDate.value).catch(console.error)
  }
}

const openDataDirectory = async () => {
  try {
    await desktopEntries?.openDirectory?.()
  } catch (error) {
    console.error(error)
  }
}

const handleFlushRequest = async () => {
  try {
    await flushPending()
  } finally {
    desktopApp?.flushDone?.()
  }
}

const handleBeforeUnload = () => {
  flushPending()
}

const handleWindowBlur = () => {
  flushPending()
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    flushPending()
  }
}

const scheduleDayTick = () => {
  const current = now()
  const ms = current.add(1, 'day').startOf('day').diff(current) + 1000

  dayTimer = setTimeout(() => {
    todayIso.value = now().format('YYYY-MM-DD')
    scheduleDayTick()
  }, ms)
}

onMounted(async () => {
  await loadAll()
  await nextTick()

  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('blur', handleWindowBlur)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  disposeFlush = desktopApp?.onFlush?.(handleFlushRequest) || null
  scheduleDayTick()
})

onBeforeUnmount(() => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
    saveTimer.value = null
  }

  if (dayTimer) {
    clearTimeout(dayTimer)
  }

  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('blur', handleWindowBlur)
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  disposeFlush?.()
  flushPending()
})
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <header class="brand">
        <p class="eyebrow">Diary Calendar</p>
        <h1 class="brand-title">日记</h1>
        <p class="brand-note">把日子写下来，它们就不会消失。</p>
      </header>

      <section class="calendar" aria-label="月历">
        <div class="calendar-toolbar">
          <button type="button" class="icon-btn" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
          <strong class="month-label">{{ monthLabel }}</strong>
          <button type="button" class="icon-btn" aria-label="下个月" @click="shiftMonth(1)">›</button>
        </div>

        <div class="weekday-row" aria-hidden="true">
          <span v-for="day in weekDays" :key="day">{{ day }}</span>
        </div>

        <div class="calendar-grid">
          <button
            v-for="day in calendarDays"
            :key="day.iso"
            type="button"
            class="day-cell"
            :class="{
              'is-muted': !day.inMonth,
              'is-selected': day.isSelected,
              'is-today': day.isToday,
              'has-entry': day.hasEntry,
            }"
            :aria-label="day.ariaLabel"
            :aria-pressed="day.isSelected"
            @click="selectDate(day.iso)"
          >
            <span class="day-num">{{ day.label }}</span>
            <span class="day-dot" aria-hidden="true" />
          </button>
        </div>

        <button type="button" class="today-btn" @click="jumpToToday">回到今天</button>
      </section>

      <footer class="sidebar-footer">
        <div class="stats">
          <div class="stat">
            <span class="stat-label">累计篇数</span>
            <strong class="stat-value">{{ filledDays }}</strong>
          </div>
          <div class="stat">
            <span class="stat-label">本篇字数</span>
            <strong class="stat-value">{{ wordCount }}</strong>
          </div>
        </div>

        <button v-if="desktopEntries" type="button" class="text-btn" @click="openDataDirectory">
          打开数据目录
        </button>
      </footer>
    </aside>

    <main class="workspace">
      <section class="compose">
        <header class="panel-header">
          <div class="panel-header-inner">
            <div class="panel-title">
              <p class="eyebrow">Selected Day</p>
              <h2>{{ selectedDayLabel }}</h2>
            </div>

            <div class="panel-tools">
              <p class="save-state" :class="`is-${saveState}`" aria-live="polite">
                {{ saveStateLabel }}
              </p>
              <input
                v-model="selectedDate"
                class="date-input"
                type="date"
                aria-label="选择日期"
              />
            </div>
          </div>
        </header>

        <p v-if="failedDates.length" class="notice">
          {{ failedDates.length }} 篇日记读取失败（{{ failedDates.slice(0, 3).join('、')
          }}{{ failedDates.length > 3 ? ' 等' : '' }}），已跳过，其余内容不受影响。
        </p>

        <div v-if="loadState === 'error'" class="state-panel" role="alert">
          <p class="state-title">没能读取日记目录</p>
          <p class="state-note">
            {{ loadError }}。为避免覆盖原文件，写入已暂停。
          </p>
          <button type="button" class="solid-btn" @click="loadAll">重新读取</button>
        </div>

        <div v-else-if="loadState === 'loading'" class="state-panel">
          <p class="state-note">正在读取日记…</p>
        </div>

        <div
          v-else
          class="compose-body"
          :tabindex="isEditing ? -1 : 0"
          :aria-label="isEditing ? '日记编辑区' : '日记正文，按回车开始编辑'"
          @click="handleBodyClick"
          @keydown="handleComposeKeydown"
        >
          <textarea
            v-if="isEditing"
            ref="editorRef"
            v-model="currentEntry"
            class="editor"
            placeholder="写下今天发生的事…"
            spellcheck="false"
            @keydown="handleEditorKeydown"
            @blur="leaveEditing"
          />

          <article v-else-if="currentEntry.trim()" class="markdown-body" v-html="renderedMarkdown" />

          <div v-else class="empty-state">
            <p class="empty-title">{{ selectedDay.format('M 月 D 日') }} 还没有内容</p>
            <p class="empty-hint">这一页是空的，正好可以从今天写起。</p>
            <button type="button" class="solid-btn" @click.stop="enterEditing">开始写</button>
          </div>
        </div>

        <p v-if="loadState === 'ready'" class="compose-hint">
          <template v-if="isEditing">Esc 结束编辑 · Ctrl + S 立即保存</template>
          <template v-else>点击正文进入编辑 · 内容自动保存</template>
        </p>
      </section>
    </main>
  </div>
</template>
