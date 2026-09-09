<template>
  <!-- WK-002: unified Word/Markdown export entry for a single finished answer.
       Shared by the plain-answer toolbar (botmsg.vue) and the agent answer
       toolbar (AgentStreamDisplay.vue). The parent only supplies a snapshot of
       the message state; generation, download and error handling live here so
       both paths behave identically. -->
  <div
    ref="rootRef"
    class="answer-export-menu"
    @mouseenter="openMenu"
    @mouseleave="scheduleMenuClose"
  >
    <t-button
      ref="triggerButtonRef"
      size="small"
      variant="outline"
      shape="round"
      class="answer-export-menu__trigger"
      :disabled="disabled || exporting"
      :title="t('chat.answerExport.buttonTitle')"
      :aria-label="t('chat.answerExport.buttonTitle')"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      @click.stop="toggleMenu"
      @keydown.escape.stop.prevent="closeMenu(true)"
      @keydown.down.stop.prevent="openMenuAndFocusFirst"
    >
      <t-icon
        :name="exporting ? 'loading' : 'download'"
        :class="{ 'answer-export-menu__spinner': exporting }"
      />
    </t-button>
    <div
      v-if="menuOpen"
      class="answer-export-menu__popup"
      :class="popupUp ? 'is-up' : 'is-down'"
      role="menu"
      :aria-label="t('chat.answerExport.buttonTitle')"
      @keydown.escape.stop.prevent="closeMenu(true)"
    >
      <button
        v-for="option in formatOptions"
        :key="option.value"
        :ref="(el) => setItemRef(option.value, el)"
        type="button"
        role="menuitem"
        class="answer-export-menu__item"
        :disabled="exporting"
        @click.stop="selectFormat(option.value)"
        @mouseenter="cancelMenuClose"
        @keydown.down.stop.prevent="focusItem(1)"
        @keydown.up.stop.prevent="focusItem(-1)"
      >
        <t-icon :name="option.icon" />
        <span>{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import type { KnowledgeReferenceLike } from '@/utils/referenceSources'
import {
  buildAnswerExportModel,
  downloadBlob,
  generateAnswerMarkdown,
  type AnswerExportFormat,
  type AnswerExportLabels,
} from '@/utils/answerExport'
import { generateAnswerWordBlob } from '@/utils/answerWordExport'

const props = defineProps<{
  /** Question shown next to the answer in the exported document. */
  question?: string
  /** Final answer markdown (citation tags are converted during export). */
  answer?: string
  /** Aggregated knowledge references used to build the source list. */
  references?: KnowledgeReferenceLike[] | null
  /** Message id used for the export file name. */
  messageId?: string | null
  /** Disabled while the answer is still streaming. */
  disabled?: boolean
}>()

const { t } = useI18n()

const MENU_CLOSE_DELAY_MS = 180

const rootRef = ref<HTMLElement>()
const triggerButtonRef = ref<{ $el?: HTMLElement }>()
const itemRefs = new Map<AnswerExportFormat, HTMLElement>()

const menuOpen = ref(false)
const exporting = ref(false)
const popupUp = ref(true)
let closeTimer: ReturnType<typeof setTimeout> | null = null

// The toolbar sits at the bottom of a message, right above the chat input
// box — the default upward direction keeps the menu out from under it. When
// the toolbar is scrolled close to the viewport top there is no room above,
// so fall back to opening downward (into the remaining answer area).
const POPUP_MIN_SPACE_ABOVE_PX = 200

function updatePopupDirection() {
  const rect = rootRef.value?.getBoundingClientRect()
  popupUp.value = !rect || rect.top > POPUP_MIN_SPACE_ABOVE_PX
}

const formatOptions = computed(() => [
  { value: 'word' as AnswerExportFormat, icon: 'file-word', label: t('chat.answerExport.word') },
  {
    value: 'markdown' as AnswerExportFormat,
    icon: 'file-markdown',
    label: t('chat.answerExport.markdown'),
  },
])

const exportLabels = computed<AnswerExportLabels>(() => ({
  question: t('chat.answerExport.docLabels.question'),
  answer: t('chat.answerExport.docLabels.answer'),
  sources: t('chat.answerExport.docLabels.sources'),
  unresolvedCitation: t('chat.answerExport.docLabels.unresolvedCitation'),
  imageLabel: t('chat.answerExport.docLabels.imageLabel'),
}))

function setItemRef(format: AnswerExportFormat, el: unknown) {
  const element = el as HTMLElement | null
  if (element) itemRefs.set(format, element)
  else itemRefs.delete(format)
}

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openMenu() {
  clearCloseTimer()
  if (props.disabled || exporting.value) return
  updatePopupDirection()
  menuOpen.value = true
}

function toggleMenu() {
  if (props.disabled || exporting.value) return
  if (menuOpen.value) closeMenu(false)
  else {
    updatePopupDirection()
    menuOpen.value = true
  }
}

function scheduleMenuClose() {
  if (!menuOpen.value) return
  clearCloseTimer()
  closeTimer = setTimeout(() => {
    menuOpen.value = false
  }, MENU_CLOSE_DELAY_MS)
}

function cancelMenuClose() {
  clearCloseTimer()
}

function closeMenu(refocusTrigger: boolean) {
  clearCloseTimer()
  menuOpen.value = false
  if (refocusTrigger) {
    // Keyboard users land back on the trigger so tab order stays stable.
    const el = triggerButtonRef.value?.$el as HTMLElement | undefined
    const button =
      el?.tagName === 'BUTTON' ? el : (el?.querySelector('button') as HTMLElement | null)
    button?.focus()
  }
}

function focusItem(direction: 1 | -1) {
  const items = formatOptions.value
    .map((option) => itemRefs.get(option.value))
    .filter((el): el is HTMLElement => Boolean(el))
  if (!items.length) return
  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  const next =
    currentIndex < 0
      ? items[0]
      : items[(currentIndex + direction + items.length) % items.length]
  next.focus()
}

async function openMenuAndFocusFirst() {
  openMenu()
  await nextTick()
  focusItem(1)
}

function onPointerDownOutside(event: Event) {
  if (!menuOpen.value) return
  if (rootRef.value?.contains(event.target as Node)) return
  closeMenu(false)
}

onBeforeUnmount(() => {
  clearCloseTimer()
  document.removeEventListener('pointerdown', onPointerDownOutside)
})

// The outside-click listener only exists while the menu can be open.
watch(menuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onPointerDownOutside)
  else document.removeEventListener('pointerdown', onPointerDownOutside)
})

async function selectFormat(format: AnswerExportFormat) {
  closeMenu(false)
  if (exporting.value) return

  // Snapshot the message state synchronously: a session switch while the Word
  // library loads must not mix another message's question into this file.
  const model = buildAnswerExportModel({
    question: props.question,
    answerMarkdown: props.answer || '',
    references: props.references,
    messageId: props.messageId,
    labels: exportLabels.value,
  })

  if (!model.answerMarkdown) {
    MessagePlugin.warning(t('chat.answerExport.emptyContent'))
    return
  }

  exporting.value = true
  try {
    if (format === 'word') {
      const blob = await generateAnswerWordBlob(model)
      downloadBlob(blob, `${model.filenameBase}.docx`)
    } else {
      const blob = new Blob([generateAnswerMarkdown(model)], {
        type: 'text/markdown;charset=utf-8',
      })
      downloadBlob(blob, `${model.filenameBase}.md`)
    }
    MessagePlugin.success(t('chat.answerExport.success'))
  } catch (error) {
    console.error('[answerExport] failed to generate document', error)
    MessagePlugin.error(t('chat.answerExport.failed'))
  } finally {
    exporting.value = false
  }
}
</script>

<style lang="less" scoped>
.answer-export-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.answer-export-menu__spinner {
  animation: answer-export-menu-spin 0.8s linear infinite;
}

@keyframes answer-export-menu-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.answer-export-menu__popup {
  position: absolute;
  left: 0;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  min-width: 148px;
  padding: 4px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  box-shadow: var(--td-shadow-2);

  &.is-up {
    bottom: calc(100% + 4px);
  }

  &.is-down {
    top: calc(100% + 4px);
  }

  .answer-export-menu__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    border-radius: var(--td-radius-default);
    background: transparent;
    color: var(--td-text-color-primary);
    font-size: 13px;
    line-height: 20px;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;

    .t-icon {
      color: var(--td-text-color-secondary);
      flex-shrink: 0;
    }

    &:hover,
    &:focus-visible {
      background: var(--td-bg-color-container-hover);
      outline: none;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }
}
</style>
