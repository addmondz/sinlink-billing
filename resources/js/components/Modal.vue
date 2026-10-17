<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
const emit = defineEmits(["close"]);
const dialog = ref<HTMLDialogElement>();
let previous: Element | null = null;
onMounted(() => {
    previous = document.activeElement;
    dialog.value?.showModal();
});
onUnmounted(() => {
    if (previous instanceof HTMLElement) previous.focus();
});
</script>
<template>
    <dialog
        ref="dialog"
        @cancel.prevent="emit('close')"
        @click="
            (e) => {
                if (e.target === dialog) emit('close');
            }
        "
    >
        <div class="modal-heading">
            <slot name="title" /><button
                class="icon-button"
                aria-label="Close dialog"
                @click="emit('close')"
            >
                ✕
            </button>
        </div>
        <slot />
    </dialog>
</template>
