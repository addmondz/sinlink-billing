import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { pageSizeOptions, usePagination } from "./pagination";

describe("listing pagination", () => {
    it("defaults to 5 records per page without skipping the last record", () => {
        const records = ref(
            Array.from({ length: 26 }, (_, index) => index + 1),
        );
        const pagination = usePagination(records);

        expect(pagination.pageSize.value).toBe(5);
        expect(pagination.pageCount.value).toBe(6);
        expect(pagination.pagedRecords.value).toEqual(
            records.value.slice(0, 5),
        );
        pagination.page.value = 6;
        expect(pagination.pagedRecords.value).toEqual(records.value.slice(25));
    });
    it.each(pageSizeOptions)(
        "uses %i records per page and resets to the first page when the size changes",
        (pageSize) => {
            const records = ref(
                Array.from({ length: 101 }, (_, index) => index + 1),
            );
            const pagination = usePagination(
                records,
                pageSize === 20 ? 10 : 20,
            );
            pagination.page.value = 2;

            pagination.pageSize.value = pageSize;

            expect(pagination.page.value).toBe(1);
            expect(pagination.pageCount.value).toBe(Math.ceil(101 / pageSize));
            expect(pagination.pagedRecords.value).toEqual(
                records.value.slice(0, pageSize),
            );
        },
    );
    it("returns to the last available page when records are removed", () => {
        const records = ref(
            Array.from({ length: 26 }, (_, index) => index + 1),
        );
        const pagination = usePagination(records);
        pagination.page.value = 2;

        records.value = [1, 2];

        expect(pagination.page.value).toBe(1);
        expect(pagination.pagedRecords.value).toEqual([1, 2]);
    });
    it("keeps an empty listing on the first page", () => {
        const pagination = usePagination(ref<number[]>([]));

        expect(pagination.page.value).toBe(1);
        expect(pagination.pageCount.value).toBe(1);
        expect(pagination.pagedRecords.value).toEqual([]);
    });
});
