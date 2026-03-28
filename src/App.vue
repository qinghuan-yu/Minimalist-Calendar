<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

dayjs.locale('zh-cn')

const storageKey = 'diary-calendar-entries'
const today = dayjs()
const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

const safeParseEntries = () => {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || '{}')
  } catch {
    return {}
  }
}

const currentMonth = ref(today.startOf('month'))
const selectedDate = ref(today.format('YYYY-MM-DD'))
const entries = ref(safeParseEntries())
const isEditing = ref(false)
const editorRef = ref(null)

watch(
  entries,
  (value) => {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  },
  { deep: true },
)

watch(selectedDate, (value) => {
  if (value) {
    currentMonth.value = dayjs(value).startOf('month')
  }
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

    return {
      iso,
      label: date.date(),
      inMonth: date.month() === currentMonth.value.month(),
      isToday: iso === today.format('YYYY-MM-DD'),
      isSelected: iso === selectedDate.value,
      hasEntry: Boolean(entries.value[iso]?.trim()),
    }
  })
})

const selectedDay = computed(() => dayjs(selectedDate.value))

const currentEntry = computed({
  get: () => entries.value[selectedDate.value] || '',
  set: (value) => {
    entries.value = {
      ...entries.value,
      [selectedDate.value]: value,
    }
  },
})

const renderedMarkdown = computed(() => {
  return DOMPurify.sanitize(markdown.render(currentEntry.value || ''))
})

const wordCount = computed(() => {
  return currentEntry.value.replace(/\s+/g, '').length
})

const filledDays = computed(() => {
  return Object.values(entries.value).filter((value) => value.trim()).length
})

const selectDate = (iso) => {
  selectedDate.value = iso
  currentMonth.value = dayjs(iso).startOf('month')
}

const shiftMonth = (amount) => {
  currentMonth.value = currentMonth.value.add(amount, 'month').startOf('month')
}

const jumpToToday = () => {
  selectedDate.value = today.format('YYYY-MM-DD')
  currentMonth.value = today.startOf('month')
}

const enterEditing = async () => {
  isEditing.value = true
  await nextTick()
  editorRef.value?.focus()
}

const leaveEditing = () => {
  isEditing.value = false
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand-card glass-panel">
        <p class="eyebrow">Diary Calendar</p>
        <h1>日记日历</h1>
      
      </div>

      <div class="calendar-card glass-panel">
        <div class="calendar-toolbar">
          <button type="button" class="ghost-btn" @click="shiftMonth(-1)">上个月</button>
          <strong>{{ monthLabel }}</strong>
          <button type="button" class="ghost-btn" @click="shiftMonth(1)">下个月</button>
        </div>

        <div class="weekday-row">
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
            @click="selectDate(day.iso)"
          >
            <span>{{ day.label }}</span>
          </button>
        </div>

        <button type="button" class="today-btn" @click="jumpToToday">回到今天</button>
      </div>

      <div class="stats-card glass-panel">
        <div>
          <span class="stats-label">已写日期</span>
          <strong>{{ filledDays }}</strong>
        </div>
        <div>
          <span class="stats-label">当前字数</span>
          <strong>{{ wordCount }}</strong>
        </div>
      </div>
    </aside>

    <main class="workspace">
      <section class="compose-panel glass-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Selected Day</p>
            <h2>{{ selectedDay.format('M 月 D 日 dddd') }}</h2>
          </div>
          <input v-model="selectedDate" class="date-input" type="date" />
        </div>

        <div class="compose-body" @click="!isEditing && enterEditing()">
          <textarea
            v-if="isEditing"
            ref="editorRef"
            v-model="currentEntry"
            class="editor"
            @blur="leaveEditing"
          />

          <article
            v-else-if="currentEntry.trim()"
            class="markdown-body"
            v-html="renderedMarkdown"
          />

          <div v-else class="empty-state" />
        </div>
      </section>
    </main>
  </div>
</template>