import { computed, ref, watch, type Ref } from "vue";

export const pageSizeOptions = [5, 10, 20, 50, 100] as const;

export function usePagination<T>(
    records: Readonly<Ref<T[]>>,
    initialPageSize = 5,
) {
    const page = ref(1);
    const pageSize = ref(initialPageSize);
    const pageCount = computed(() =>
        Math.max(1, Math.ceil(records.value.length / pageSize.value)),
    );
    const pagedRecords = computed(() =>
        records.value.slice(
            (page.value - 1) * pageSize.value,
            page.value * pageSize.value,
        ),
    );
    watch(
        pageCount,
        (lastPage) => {
            page.value = Math.min(page.value, lastPage);
        },
        { flush: "sync" },
    );
    function resetPage() {
        page.value = 1;
    }
    watch(pageSize, resetPage, { flush: "sync" });
    return { page, pageSize, pageCount, pagedRecords, resetPage };
}
