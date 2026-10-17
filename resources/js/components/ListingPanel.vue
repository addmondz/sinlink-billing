<script setup lang="ts" generic="T extends { id: string | number }">
import { Search, ArrowUpRight } from "@lucide/vue";
import PageSizeSelector from "./PageSizeSelector.vue";
import Pagination from "./Pagination.vue";

defineProps<{
    records: T[];
    total: number;
    pageCount: number;
    label: string;
    searchPlaceholder: string;
    recordLabel: (record: T) => string;
    emptyTitle: string;
    emptyMessage: string;
    rowClass?: string;
}>();
const search = defineModel<string>("search", { required: true });
const page = defineModel<number>("page", { required: true });
const pageSize = defineModel<number>("pageSize", { required: true });
const emit = defineEmits<{ view: [record: T] }>();
</script>
<template>
    <section class="list-panel">
        <div class="filters">
            <label class="search-field">
                <Search :size="18" />
                <input
                    v-model="search"
                    type="search"
                    :placeholder="searchPlaceholder"
                    :aria-label="'Search ' + label.toLowerCase()"
                />
            </label>
            <slot name="filters" />
            <PageSizeSelector v-model="pageSize" />
        </div>
        <div v-if="$slots.summary" class="dataset-note">
            <slot name="summary" />
        </div>
        <div v-if="!total" class="empty-state">
            <slot name="empty-icon" />
            <h2>
                {{
                    search.trim()
                        ? "No matching " + label.toLowerCase()
                        : emptyTitle
                }}
            </h2>
            <p>{{ search.trim() ? "Try a different search." : emptyMessage }}</p>
        </div>
        <article
            v-for="record in records"
            :key="record.id"
            :class="['customer-row', 'clickable-row', rowClass]"
            @click="emit('view', record)"
        >
            <slot :record="record" />
            <div class="customer-row-actions" @click.stop>
                <slot name="actions" :record="record" />
                <button
                    type="button"
                    class="icon-button"
                    :aria-label="'View ' + recordLabel(record)"
                    @click="emit('view', record)"
                >
                    <ArrowUpRight :size="18" />
                </button>
            </div>
        </article>
        <Pagination
            v-model="page"
            :page-size="pageSize"
            :page-count="pageCount"
            :total="total"
            :label="label"
        />
    </section>
</template>
