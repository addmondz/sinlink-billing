<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import {
    Printer,
    Download,
    Share2,
    ArrowLeft,
    PenLine,
    Copy,
    Eye,
} from "@lucide/vue";
import { useApp } from "../store";
import { api } from "../lib/api";
import { formatPhone, type Invoice } from "../lib/types";
import { money } from "../lib/money";
import { downloadPdf, invoicePdfFile } from "../lib/document";
import InvoiceDocument from "../components/InvoiceDocument.vue";
import Modal from "../components/Modal.vue";
const app = useApp(),
    route = useRoute(),
    error = ref(""),
    cancelModal = ref(false),
    reason = ref(""),
    busy = ref(false),
    pdfBusy = ref(false),
    shareFile = shallowRef<File>(),
    preparingShare = ref(false),
    sharing = ref(false),
    shareError = ref(""),
    showWhatsApp = ref(false),
    sharingSupported = ref(
        typeof navigator.share === "function" &&
            typeof navigator.canShare === "function",
    );
const invoice = computed(() =>
    app.invoices.find((i) => i.id === route.params.id),
);
const whatsAppUrl = computed(() => {
    const record = invoice.value;
    if (!record) return "https://wa.me/";
    const phone =
        formatPhone(record.customer_snapshot.phone ?? "")?.replace(/\D/g, "") ??
        "";
    const reference = record.invoice_number
        ? "invoice " + record.invoice_number
        : "draft invoice";
    const message =
        "Hello " +
        (record.customer_snapshot.name || "") +
        ", here is your " +
        reference +
        " from " +
        record.company_snapshot.company_name +
        ".";
    return (
        "https://wa.me/" + phone + "?" + new URLSearchParams({ text: message })
    );
});
const ops = computed(() =>
    app.operations.filter(
        (o) => o.entity_id === invoice.value?.id && o.state !== "archived",
    ),
);
let preparation = 0;
async function prepareShare(record: Invoice | undefined) {
    const version = ++preparation;
    shareFile.value = undefined;
    shareError.value = "";
    preparingShare.value = false;
    if (!record || !sharingSupported.value) return;
    preparingShare.value = true;
    try {
        const file = await invoicePdfFile(record);
        if (version !== preparation) return;
        if (navigator.canShare({ files: [file] })) {
            shareFile.value = file;
        } else {
            sharingSupported.value = false;
        }
    } catch {
        if (version === preparation) {
            shareError.value =
                "Could not prepare the PDF for sharing. Try again or use Download PDF.";
        }
    } finally {
        if (version === preparation) preparingShare.value = false;
    }
}
watch(invoice, prepareShare, { immediate: true });
async function share() {
    if (!sharingSupported.value) {
        showWhatsApp.value = true;
        return;
    }
    if (!shareFile.value || sharing.value) return;
    sharing.value = true;
    shareError.value = "";
    try {
        await navigator.share({
            files: [shareFile.value],
            title: shareFile.value.name,
        });
    } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
            shareError.value =
                "Could not open sharing. Try again or download the PDF and attach it in WhatsApp.";
        }
    } finally {
        sharing.value = false;
    }
}
onMounted(async () => {
    if (!invoice.value) {
        try {
            const row = await api<Invoice>("/invoices/" + route.params.id);
            await app.vault!.put("invoice", row.id, row);
            await app.refresh();
        } catch {
            error.value =
                "Invoice is unavailable on this device. Connect and sync to download it.";
        }
    }
});
async function cancel() {
    busy.value = true;
    try {
        await app.cancel(invoice.value!.id, reason.value);
        cancelModal.value = false;
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
async function pdf() {
    pdfBusy.value = true;
    try {
        await downloadPdf(invoice.value!);
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        pdfBusy.value = false;
    }
}
function print() {
    const c = invoice.value!.company_snapshot;
    const style =
        document.getElementById("paper-rule") ??
        document.head.appendChild(
            Object.assign(document.createElement("style"), {
                id: "paper-rule",
            }),
        );
    style.textContent = `@page{size:${c.paper_size} portrait;margin:0}`;
    window.print();
}
</script>
<template>
    <div class="page-heading compact no-print">
        <div>
            <RouterLink to="/" class="back-link"
                ><ArrowLeft :size="15" />Invoices</RouterLink
            >
            <h1>{{ invoice?.invoice_number || "Draft invoice" }}</h1>
            <p class="muted">
                {{ invoice?.customer_snapshot.name }}
                <span v-if="invoice">· {{ invoice.invoice_date }}</span>
            </p>
        </div>
        <div class="heading-actions">
            <RouterLink
                v-if="
                    invoice?.status === 'draft' &&
                    (invoice.created_by === app.user?.id ||
                        app.user?.role === 'admin')
                "
                class="button primary"
                :to="'/invoices/' + invoice.id + '/edit'"
                ><PenLine :size="17" />Edit Draft</RouterLink
            ><button
                class="button secondary"
                :disabled="
                    !invoice ||
                    preparingShare ||
                    sharing ||
                    (sharingSupported && !shareFile)
                "
                aria-describedby="invoice-sharing-help"
                @click="share"
            >
                <Share2 :size="17" />{{
                    preparingShare ? "Preparing share…" : "Share to WhatsApp"
                }}
            </button>
            <button
                class="button secondary"
                :disabled="!invoice"
                @click="print"
            >
                <Printer :size="17" />Print</button
            ><button
                class="button primary"
                :disabled="!invoice || pdfBusy"
                @click="pdf"
            >
                <Download :size="17" />{{
                    pdfBusy ? "Preparing…" : "Download PDF"
                }}
            </button>
        </div>
    </div>
    <p v-if="invoice" id="invoice-sharing-help" class="hint no-print">
        {{
            sharingSupported
                ? "Share the PDF and choose WhatsApp from your phone’s share menu."
                : "Download the PDF and open the customer’s WhatsApp chat."
        }}
    </p>
    <p v-if="shareError" class="error no-print" role="alert">
        {{ shareError }}
        <button
            v-if="!shareFile"
            class="text-button"
            :disabled="preparingShare"
            @click="prepareShare(invoice)"
        >
            Try again
        </button>
    </p>
    <p v-if="error" class="error no-print" role="alert">{{ error }}</p>
    <Modal v-if="showWhatsApp && invoice" @close="showWhatsApp = false">
        <template #title><h2>Send invoice in WhatsApp</h2></template>
        <p>
            Download the PDF, open WhatsApp, then attach the file in your chat.
        </p>
        <div class="form-actions">
            <button class="button secondary" :disabled="pdfBusy" @click="pdf">
                <Download :size="17" />{{
                    pdfBusy ? "Preparing…" : "Download PDF"
                }}
            </button>
            <a
                :href="whatsAppUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="button primary"
            >
                Open WhatsApp
            </a>
        </div>
    </Modal>
    <template v-if="invoice"
        ><div class="detail-strip no-print">
            <span :class="['status', invoice.status]">{{ invoice.status }}</span
            ><span>{{ money(invoice.total_cents) }}</span
            ><span>By {{ invoice.creator?.name || app.user?.name }}</span
            ><span>{{
                new Date(invoice.created_at).toLocaleString("en-MY")
            }}</span
            ><RouterLink
                to="/sync"
                :class="{
                    attention: ops.some(
                        (o) => o.state === 'conflict' || o.state === 'failed',
                    ),
                }"
                >{{
                    ops.length
                        ? ops.length + " pending operations"
                        : invoice.local_only || invoice.local_dirty
                          ? "Saved on device"
                          : "Synced"
                }}</RouterLink
            >
        </div>
        <div
            v-if="invoice.status === 'cancelled'"
            class="cancel-banner no-print"
        >
            <b>Cancelled</b> on
            {{ new Date(invoice.cancelled_at!).toLocaleString("en-MY") }} ·
            {{ invoice.cancellation_reason || "No reason supplied"
            }}<RouterLink
                class="button secondary"
                :to="'/invoices/new?replace=' + invoice.id"
                ><Copy :size="16" />Create replacement</RouterLink
            >
        </div>
        <div v-if="invoice.replacement_for" class="banner no-print">
            Replacement for
            <RouterLink :to="'/invoices/' + invoice.replacement_for"
                >original invoice →</RouterLink
            >
        </div>
        <div
            v-for="r in invoice.replacements"
            :key="r.id"
            class="banner no-print"
        >
            Replaced by
            <RouterLink :to="'/invoices/' + r.id"
                >{{ r.invoice_number || "Draft" }} →</RouterLink
            >
        </div>
        <div class="document-preview" id="print-area">
            <InvoiceDocument :invoice="invoice" />
        </div>
        <p class="hint no-print">
            Matches the supplied Sinlink cash sales layout.
        </p>
        <section class="card audit-card no-print">
            <div class="section-title">
                <h2>Invoice history</h2>
                <button
                    v-if="invoice.status === 'issued'"
                    class="button danger-outline"
                    @click="cancelModal = true"
                >
                    Cancel invoice
                </button>
            </div>
            <p v-if="!invoice.events?.length" class="muted">
                Local draft. Server audit history appears after synchronization.
            </p>
            <ol class="audit-list">
                <li
                    v-for="(event, index) in invoice.events"
                    :key="event.id ?? index"
                >
                    <span class="audit-dot" />
                    <div>
                        <b>{{ event.type.replaceAll("_", " ") }}</b
                        ><span
                            >{{ event.actor?.name || "Staff" }} ·
                            {{
                                new Date(event.created_at).toLocaleString(
                                    "en-MY",
                                )
                            }}</span
                        >
                        <p v-if="event.reason">{{ event.reason }}</p>
                    </div>
                </li>
            </ol>
        </section></template
    >
    <Modal v-if="cancelModal" @close="cancelModal = false"
        ><template #title
            ><h2>Cancel {{ invoice?.invoice_number }}?</h2></template
        >
        <p>
            This is permanent. The original items, customer details, invoice
            number, and audit history will be retained.
        </p>
        <form @submit.prevent="cancel" class="stack">
            <label
                >Reason <span class="muted">· optional</span
                ><textarea
                    v-model="reason"
                    rows="3"
                    maxlength="4000"
                    placeholder="Why is this invoice being cancelled?"
                />
            </label>
            <div class="form-actions">
                <button
                    type="button"
                    class="button secondary"
                    @click="cancelModal = false"
                >
                    Keep invoice</button
                ><button class="button danger" :disabled="busy">
                    {{ busy ? "Cancelling…" : "Confirm cancellation" }}
                </button>
            </div>
        </form></Modal
    >
</template>
