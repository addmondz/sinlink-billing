<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RefreshCw, Download, Upload, Check, AlertCircle } from "@lucide/vue";
import { useApp } from "../store";
import { readBackupProposals } from "../lib/vault";
import { api, send } from "../lib/api";
import {
    uuid,
    formatInvoiceNumber,
    type Invoice,
    type Operation,
} from "../lib/types";
import Modal from "../components/Modal.vue";
import Pagination from "../components/Pagination.vue";
import PageSizeSelector from "../components/PageSizeSelector.vue";
import { usePagination } from "../lib/pagination";
const app = useApp(),
    error = ref(""),
    message = ref(""),
    selected = ref<Operation>(),
    reviews = ref<any[]>([]),
    showArchive = ref(false);
const reviewBackup = ref<any>(),
    reviewPass = ref(""),
    reviewBusy = ref(false);
const backupPassword = ref("");
const visibleOperations = computed(() =>
    app.operations.filter(
        (operation) => showArchive.value || operation.state !== "archived",
    ),
);
const {
    page: operationPage,
    pageSize: operationPageSize,
    pageCount: operationPageCount,
    pagedRecords: pagedOperations,
    resetPage: resetOperationPage,
} = usePagination(visibleOperations);
const {
    page: reviewPage,
    pageSize: reviewPageSize,
    pageCount: reviewPageCount,
    pagedRecords: pagedReviews,
} = usePagination(reviews);
watch(showArchive, resetOperationPage);
async function chooseReview(e: Event) {
    try {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) {
            if (f.size > 25000000)
                throw new Error("Maximum backup size is 25 MB.");
            reviewBackup.value = JSON.parse(await f.text());
        }
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function importReview() {
    reviewBusy.value = true;
    try {
        const operations = await readBackupProposals(
            reviewBackup.value,
            reviewPass.value,
        );
        await send("/sync/reviews/import", {
            operations: operations.filter((o) => o.state !== "archived"),
        });
        reviewPass.value = "";
        reviewBackup.value = undefined;
        await loadReviews();
        message.value =
            "Proposals imported for review. Original authorship retained; no changes were applied.";
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        reviewBusy.value = false;
    }
}
const pending = computed(() =>
        app.operations.filter((o) => o.state === "pending"),
    ),
    failed = computed(() =>
        app.operations.filter((o) => ["failed", "conflict"].includes(o.state)),
    );
async function backup() {
    try {
        const data = await app.vault!.export();
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(data)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download =
            "sinlink-encrypted-backup-" +
            new Date().toISOString().slice(0, 10) +
            ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        message.value =
            "Encrypted backup downloaded. Recovery uses your account password at the time of export.";
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function restore(e: Event) {
    try {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        if (f.size > 25000000)
            throw new Error("Backup is too large (maximum 25 MB).");
        await app.vault!.import(
            JSON.parse(await f.text()),
            backupPassword.value || undefined,
        );
        backupPassword.value = "";
        await app.refresh();
        message.value =
            "Missing local work restored. Operation identities are retained; normal server validation still applies.";
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function loadReviews() {
    if (app.user?.role === "admin" && app.online && !app.needsAuth)
        try {
            reviews.value = await api("/sync/reviews");
        } catch (e) {
            error.value = (e as Error).message;
        }
}
async function reviewed(id: string) {
    try {
        await send("/sync/reviews/" + id, {});
        await loadReviews();
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function recoverDraft(op: Operation) {
    try {
        const p = JSON.parse(JSON.stringify(op.payload)) as Invoice;
        if (!p.items?.length)
            throw new Error(
                "Only invoice content can be recovered as a draft.",
            );
        const id = uuid();
        const draft: Invoice = {
            ...p,
            id,
            status: "draft",
            invoice_number: null,
            number_value: undefined,
            allocation_id: undefined,
            version: 0,
            created_by: app.user!.id,
            creator: { id: app.user!.id, name: app.user!.name },
            device_id: app.vault!.profile.device_id,
            created_at: new Date().toISOString(),
            issued_at: undefined,
            cancelled_at: undefined,
            items: p.items.map((i) => ({ ...i, id: uuid() })),
            saved_at: undefined,
            local_revision: undefined,
            local_only: true,
            local_dirty: true,
            events: [],
            replacements: [],
            company_snapshot: JSON.parse(JSON.stringify(app.company)),
        };
        await app.persistDraft(draft);
        message.value =
            "Proposal copied to a new draft. Review it in Invoices. The rejected operation is retained.";
        selected.value = undefined;
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function archive() {
    if (!selected.value) return;
    try {
        const op = selected.value;
        await app.archive(op.id);
        if (app.online)
            await app
                .adoptServer(
                    op.entity_id,
                    op.type.startsWith("invoice")
                        ? "invoice"
                        : op.type.startsWith("vehicle")
                          ? "vehicle"
                          : "customer",
                )
                .catch(() => {});
        showArchive.value = false;
        selected.value = undefined;
        message.value =
            "Proposal archived for review. Dependent operations for this record were archived together; their original content remains in the backup.";
    } catch (e) {
        error.value = (e as Error).message;
    }
}
onMounted(loadReviews);
</script>
<template>
    <div class="page-heading">
        <div>
            <span class="eyebrow">EVERY CHANGE ACCOUNTED FOR</span>
            <h1>Sync status</h1>
            <p class="muted">
                Your work stays on the device until the server confirms it.
            </p>
        </div>
        <button
            class="button primary"
            :disabled="app.syncing"
            @click="app.sync"
        >
            <RefreshCw :size="18" :class="{ spinning: app.syncing }" />{{
                app.syncing ? "Syncing…" : "Sync now"
            }}
        </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="success" role="status">{{ message }}</p>
    <p v-if="app.syncMessage" class="banner">{{ app.syncMessage }}</p>
    <div class="sync-overview">
        <section class="card">
            <span class="eyebrow">QUEUED</span
            ><strong>{{ pending.length }}</strong>
            <p>Waiting for server receipt</p>
        </section>
        <section class="card">
            <span class="eyebrow">NEEDS ATTENTION</span
            ><strong>{{ failed.length }}</strong>
            <p>Failed operations & conflicts</p>
        </section>
        <section class="card">
            <span class="eyebrow">OFFLINE NUMBERS</span
            ><strong>{{ app.remaining }}</strong>
            <p>Reserved for this device</p>
        </section>
    </div>
    <p class="hint">
        Last successful sync:
        {{
            app.lastSync
                ? new Date(app.lastSync).toLocaleString("en-MY")
                : "Not yet completed"
        }}. Open the app to sync; closed-app background sync is not required.
    </p>
    <section class="list-panel">
        <div class="panel-title">
            <h2>Local operations</h2>
            <label class="checkbox-label"
                ><input type="checkbox" v-model="showArchive" />Show
                archived</label
            >
            <PageSizeSelector v-model="operationPageSize" />
        </div>
        <div v-if="!visibleOperations.length" class="empty-state compact-empty">
            <Check :size="28" />
            <h2>All caught up</h2>
            <p>No pending operations on this device.</p>
        </div>
        <article
            v-for="op in pagedOperations"
            :key="op.id"
            class="operation-row"
        >
            <AlertCircle
                v-if="op.state === 'conflict' || op.state === 'failed'"
                :size="20"
                class="attention"
            /><RefreshCw v-else :size="19" />
            <div>
                <b>{{ op.type.replace(".", " · ") }}</b
                ><small
                    >{{
                        formatInvoiceNumber(op.payload.invoice_number) ||
                        op.payload.name ||
                        op.entity_id.slice(0, 8)
                    }}
                    ·
                    {{ new Date(op.action_at).toLocaleString("en-MY") }}</small
                >
                <p v-if="op.error" class="attention small">{{ op.error }}</p>
                <small>Attempts: {{ op.attempts }} · {{ op.state }}</small>
            </div>
            <div class="operation-actions">
                <button class="text-button" @click="selected = op">
                    Review</button
                ><button
                    v-if="op.state !== 'archived'"
                    class="button secondary"
                    @click="app.retry(op.id)"
                >
                    Retry
                </button>
            </div>
        </article>
        <Pagination
            v-model="operationPage"
            :page-size="operationPageSize"
            :page-count="operationPageCount"
            :total="visibleOperations.length"
            label="Local operations"
        />
    </section>
    <section class="card backup-card">
        <h2>Encrypted local backup</h2>
        <p class="muted">
            Export before clearing browser data or resetting a device. This file
            contains encrypted business records and outbox entries, never your
            password. Recovery uses the account password from the time of
            export.
        </p>
        <div class="heading-actions">
            <button class="button secondary" @click="backup">
                <Download :size="17" />Export backup</button
            ><label class="button secondary file-button"
                ><Upload :size="17" />Import missing work<input
                    type="file"
                    accept="application/json"
                    @change="restore"
            /></label>
        </div>
        <label
            >Backup password · only if different from your current
            password<input
                v-model="backupPassword"
                type="password"
                autocomplete="off"
        /></label>
        <p class="hint">
            Import on this device restores missing records without rewinding
            number counters.
        </p>
    </section>
    <section v-if="app.user?.role === 'admin'" class="list-panel">
        <div class="panel-title">
            <h2>Administrator review</h2>
            <label
                v-if="app.online && !app.needsAuth"
                class="button secondary file-button"
                >Review staff backup<input
                    type="file"
                    accept="application/json"
                    @change="chooseReview" /></label
            ><button class="text-button" @click="loadReviews">Refresh</button>
            <PageSizeSelector v-model="reviewPageSize" />
        </div>
        <p v-if="!reviews.length" class="padded muted">
            No server-reported rejections. A disconnected device must reconnect
            before its rejected work appears here.
        </p>
        <article
            v-for="review in pagedReviews"
            :key="review.id"
            class="review-row"
        >
            <details>
                <summary>
                    {{ review.operation.type }} · Actor #{{ review.actor_id }} ·
                    {{ review.status }}
                </summary>
                <p class="attention">{{ review.error }}</p>
                <pre>{{ JSON.stringify(review.operation, null, 2) }}</pre>
            </details>
            <button
                v-if="review.status === 'open'"
                class="button secondary"
                @click="reviewed(review.id)"
            >
                Mark reviewed
            </button>
        </article>
        <Pagination
            v-model="reviewPage"
            :page-size="reviewPageSize"
            :page-count="reviewPageCount"
            :total="reviews.length"
            label="Administrator reviews"
        />
        <p class="hint padded">
            Review acknowledges the preserved proposal. It does not reassign
            authorship, change financial content, or bypass authorization.
        </p>
    </section>
    <Modal
        v-if="reviewBackup"
        @close="
            reviewBackup = undefined;
            reviewPass = '';
        "
        ><template #title><h2>Review staff backup</h2></template>
        <p>
            Enter the password that protected the backup when it was exported.
            Older backups may use a device passphrase. Proposals are sent for
            administrator review with their original actor and operation IDs.
            They are never executed by this import.
        </p>
        <form @submit.prevent="importReview" class="stack">
            <label
                >Backup password<input
                    v-model="reviewPass"
                    type="password"
                    required
                    autocomplete="off" /></label
            ><button
                class="button primary"
                :disabled="reviewBusy || !app.online"
            >
                Import proposals for review
            </button>
        </form></Modal
    >
    <Modal v-if="selected" @close="selected = undefined"
        ><template #title><h2>Review local operation</h2></template>
        <p :class="selected.error ? 'error' : 'hint'">
            {{
                selected.error ||
                "This operation is waiting for acknowledgment."
            }}
        </p>
        <p class="hint">
            Original author #{{ selected.actor_id }} · Operation
            {{ selected.id }}
        </p>
        <details>
            <summary>Preserved proposal</summary>
            <pre>{{ JSON.stringify(selected.payload, null, 2) }}</pre>
        </details>
        <div class="stack">
            <button
                v-if="
                    selected.type.startsWith('invoice') &&
                    selected.payload.items
                "
                class="button secondary"
                @click="recoverDraft(selected)"
            >
                Copy proposal to a new draft</button
            ><button
                v-if="selected.state !== 'archived'"
                class="button secondary"
                @click="
                    app.retry(selected.id);
                    selected = undefined;
                "
            >
                Retry unchanged operation</button
            ><button
                v-if="
                    selected.state === 'conflict' || selected.state === 'failed'
                "
                class="button danger-outline"
                @click="showArchive = true"
            >
                Archive proposal & use server record
            </button>
        </div></Modal
    >
    <Modal v-if="showArchive && selected" @close="showArchive = false"
        ><template #title><h2>Archive this proposal?</h2></template>
        <p>
            The proposal and its dependent operations stay in encrypted local
            history. The current server record will be used. Export a backup
            first if you need a separate copy.
        </p>
        <div class="form-actions">
            <button class="button secondary" @click="showArchive = false">
                Keep for review</button
            ><button class="button danger" @click="archive">
                Archive proposal
            </button>
        </div></Modal
    >
</template>
