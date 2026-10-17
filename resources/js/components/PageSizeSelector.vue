<script setup lang="ts">
import { pageSizeOptions } from "../lib/pagination";
defineProps<{ busy?: boolean }>();
const pageSize = defineModel<number>({ required: true });
</script>
<template>
    <label class="pagination-size">
        Show
        <select
            v-model.number="pageSize"
            aria-label="Records per page"
            :disabled="busy"
        >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">
                {{ size }}
            </option>
        </select>
        per page
    </label>
</template>
