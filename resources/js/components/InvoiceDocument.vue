<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { formatInvoiceNumber, type Invoice } from "../lib/types";
import { invoiceLayout, documentHeight, documentWidth } from "../lib/document";
const props = defineProps<{ invoice: Invoice }>();
const fontsReady = ref(false);
onMounted(async () => {
    await document.fonts.load('8px "Invoice Sans"');
    await document.fonts.load('bold 8px "Invoice Sans"');
    fontsReady.value = true;
});
const pages = computed(() => {
    const context = document.createElement("canvas").getContext("2d");
    return invoiceLayout(props.invoice, (value, size, bold) => {
        if (!context) return value.length * size * 0.55;
        context.font =
            (bold ? "bold " : "") +
            size +
            (/[^\x20-\x7e]/.test(value)
                ? "px Noto, sans-serif"
                : 'px "Invoice Sans", Noto, sans-serif');
        void fontsReady.value;
        return context.measureText(value).width;
    });
});
</script>
<template>
    <article
        class="invoice-paper reference-invoice"
        :class="{ 'paper-a5': invoice.company_snapshot.paper_size === 'A5' }"
    >
        <svg
            v-for="(page, index) in pages"
            :key="index"
            :viewBox="'0 0 ' + documentWidth + ' ' + documentHeight"
            class="invoice-sheet"
            role="document"
            :aria-label="
                'Cash sales ' +
                (formatInvoiceNumber(invoice.invoice_number) || 'draft') +
                ', page ' +
                (index + 1)
            "
        >
            <template v-for="(element, position) in page" :key="position">
                <line
                    v-if="element.kind === 'line'"
                    :x1="element.x"
                    :y1="element.y"
                    :x2="element.end"
                    :y2="element.y"
                    stroke="black"
                    stroke-width="0.4"
                />
                <text
                    v-else
                    :class="{
                        'document-stamp':
                            element.text === 'DRAFT' ||
                            element.text === 'CANCELLED',
                    }"
                    :x="element.x"
                    :y="element.y"
                    :font-size="element.size"
                    :font-weight="element.bold ? 700 : 400"
                    :text-anchor="
                        element.align === 'center'
                            ? 'middle'
                            : element.align === 'right'
                              ? 'end'
                              : 'start'
                    "
                    :fill="element.color || 'black'"
                    xml:space="preserve"
                >
                    {{ element.text }}
                </text>
            </template>
        </svg>
    </article>
</template>
