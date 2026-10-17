<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{ message: string }>();
const alert = ref<HTMLParagraphElement>();

watch(
    () => props.message,
    async (message) => {
        if (!message) return;
        await nextTick();
        alert.value?.focus({ preventScroll: true });
        alert.value?.scrollIntoView({ block: "center" });
    },
    { immediate: true },
);
</script>
<template>
    <p v-if="message" ref="alert" class="error" role="alert" tabindex="-1">
        {{ message }}
    </p>
</template>
