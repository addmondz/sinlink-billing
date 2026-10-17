<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, provide, ref, useId } from "vue";
const emit = defineEmits(["close"]);
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
const changed = ref(false),
    confirmDiscard = ref(false),
    keepEditing = ref<HTMLButtonElement>();
let previous: Element | null = null;
let previousFocus: Element | null = null;

async function requestClose() {
    if (
        confirmDiscard.value ||
        dialog.value?.querySelector('form[aria-busy="true"]')
    )
        return;
    if (changed.value) {
        previousFocus = document.activeElement;
        confirmDiscard.value = true;
        await nextTick();
        keepEditing.value?.focus();
        keepEditing.value?.scrollIntoView({ block: "center" });
        return;
    }
    emit("close");
}
async function continueEditing() {
    confirmDiscard.value = false;
    await nextTick();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
}
function markChanged(event: Event) {
    if (event.target instanceof Element && event.target.closest("form")) {
        changed.value = true;
    }
}
provide("requestModalClose", requestClose);
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
        :aria-labelledby="titleId"
        @input.capture="markChanged"
        @change.capture="markChanged"
        @cancel.prevent="confirmDiscard ? continueEditing() : requestClose()"
        @click="
            (e) => {
                if (e.target === dialog) requestClose();
            }
        "
    >
        <div class="modal-heading">
            <div :id="titleId"><slot name="title" /></div>
            <button
                type="button"
                class="icon-button"
                aria-label="Close dialog"
                @click="requestClose"
            >
                ✕
            </button>
        </div>
        <section v-if="confirmDiscard" class="discard-confirmation">
            <p role="alert">
                Discard your changes? These details have not been saved.
            </p>
            <div class="form-actions">
                <button
                    ref="keepEditing"
                    type="button"
                    class="button secondary"
                    @click="continueEditing"
                >
                    Keep editing
                </button>
                <button
                    type="button"
                    class="button danger"
                    @click="emit('close')"
                >
                    Discard changes
                </button>
            </div>
        </section>
        <slot />
    </dialog>
</template>
