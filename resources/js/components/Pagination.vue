<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
    pageCount: number;
    pageSize: number;
    total: number;
    label: string;
    busy?: boolean;
}>();
const page = defineModel<number>({ required: true });
const firstResult = computed(() =>
    props.total ? (page.value - 1) * props.pageSize + 1 : 0,
);
const lastResult = computed(() =>
    Math.min(page.value * props.pageSize, props.total),
);
</script>
<template>
    <nav class="pagination" :aria-label="label + ' pagination'">
        <span aria-live="polite"
            >Showing {{ firstResult }} to {{ lastResult }} of
            {{ total }} results</span
        >
        <div class="pagination-controls">
            <button
                type="button"
                class="button secondary"
                aria-label="First page"
                title="First page"
                :disabled="busy || page <= 1"
                @click="page = 1"
            >
                &lt;
            </button>
            <button
                type="button"
                class="button secondary"
                aria-label="Previous page"
                :disabled="busy || page <= 1"
                @click="page--"
            >
                Prev
            </button>
            <span aria-live="polite">{{ page }} of {{ pageCount }}</span>
            <button
                type="button"
                class="button secondary"
                aria-label="Next page"
                :disabled="busy || page >= pageCount"
                @click="page++"
            >
                Next
            </button>
            <button
                type="button"
                class="button secondary"
                aria-label="Last page"
                title="Last page"
                :disabled="busy || page >= pageCount"
                @click="page = pageCount"
            >
                &gt;
            </button>
        </div>
    </nav>
</template>
