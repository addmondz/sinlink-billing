<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Plus, Search, FileText, ArrowUpRight } from "@lucide/vue";
import { useApp } from "../store";
import { api } from "../lib/api";
import { money } from "../lib/money";
import { normalizePhone, type Invoice } from "../lib/types";
import Pagination from "../components/Pagination.vue";
import PageSizeSelector from "../components/PageSizeSelector.vue";
import { usePagination } from "../lib/pagination";
const app = useApp(),
    q = ref(""),
    status = ref(""),
    from = ref(""),
    to = ref(""),
    page = ref(1),
    server = ref<Invoice[]>([]),
    total = ref(0),
    pages = ref(1),
    loaded = ref(false),
    loading = ref(false),
    error = ref("");
let timer: ReturnType<typeof setTimeout>,
    generation = 0;
const hasPending = (id: string) =>
    app.operations.some((o) => o.entity_id === id && o.state !== "archived");
const matches = (i: Invoice) =>
    [
        i.invoice_number,
        i.customer_snapshot.name,
        i.customer_snapshot.phone,
        normalizePhone(i.customer_snapshot.phone ?? ""),
        i.vehicle_registration,
    ]
        .join(" ")
        .toLowerCase()
        .includes(q.value.trim().toLowerCase()) ||
    (normalizePhone(q.value) !== "" &&
        normalizePhone(i.customer_snapshot.phone ?? "").includes(
            normalizePhone(q.value),
        ));
const matchesFilters = (i: Invoice) =>
    matches(i) &&
    (!status.value || i.status === status.value) &&
    (!from.value || i.invoice_date >= from.value) &&
    (!to.value || i.invoice_date <= to.value);
const isServer = computed(() => app.online && !app.needsAuth && loaded.value);
const list = computed(() => {
    const local = app.invoices.filter(
        (i) => i.local_only || i.local_dirty || hasPending(i.id),
    );
    const rows = isServer.value
        ? [
              ...local.filter(matchesFilters),
              ...server.value.filter((i) => !local.some((l) => l.id === i.id)),
          ]
        : app.invoices.filter(matchesFilters);
    return rows.sort(
        (a, b) =>
            b.invoice_date.localeCompare(a.invoice_date) ||
            b.created_at.localeCompare(a.created_at),
    );
});
const {
    page: localPage,
    pageSize,
    pageCount: localPageCount,
    pagedRecords: localInvoices,
    resetPage: resetLocalPage,
} = usePagination(list);
const visibleInvoices = computed(() =>
    isServer.value ? list.value : localInvoices.value,
);
const currentPage = computed({
    get: () => (isServer.value ? page.value : localPage.value),
    set: (value: number) => {
        if (isServer.value) page.value = value;
        else localPage.value = value;
    },
});
const pageCount = computed(() =>
    isServer.value ? pages.value : localPageCount.value,
);
const syncState = (i: Invoice) => {
    const ops = app.operations.filter(
        (o) => o.entity_id === i.id && o.state !== "archived",
    );
    return ops.some((o) => o.state === "conflict")
        ? "Conflict"
        : ops.some((o) => o.state === "failed")
          ? "Needs attention"
          : ops.length
            ? "Pending sync"
            : i.local_only || i.local_dirty
              ? "Saved on device"
              : "Synced";
};
async function fetchList() {
    const n = ++generation;
    if (!app.online || app.needsAuth) {
        loaded.value = false;
        return;
    }
    loading.value = true;
    try {
        const p = new URLSearchParams({
            q: q.value,
            status: status.value,
            from: from.value,
            to: to.value,
            page: String(page.value),
            per_page: String(pageSize.value),
        });
        const r = await api("/invoices?" + p);
        if (n !== generation) return;
        server.value = r.data;
        total.value = r.total;
        pages.value = r.last_page;
        if (page.value > pages.value) {
            page.value = pages.value;
        }
        loaded.value = true;
        error.value = "";
    } catch {
        loaded.value = false;
        error.value = "Showing invoices available on this device.";
    } finally {
        loading.value = false;
    }
}
watch([q, status, from, to], () => {
    page.value = 1;
    resetLocalPage();
    clearTimeout(timer);
    timer = setTimeout(fetchList, 250);
});
watch(
    pageSize,
    () => {
        page.value = 1;
    },
    { flush: "sync" },
);
watch([page, pageSize, () => app.online, () => app.lastSync], fetchList);
watch(
    () => app.user?.simple_mode,
    (enabled) => {
        if (enabled) {
            status.value = "";
            from.value = "";
            to.value = "";
        }
    },
);
onMounted(fetchList);
onUnmounted(() => clearTimeout(timer));
</script>
<template>
    <div class="page-heading simple-list-heading">
        <div>
            <span class="eyebrow">CASH SALES</span>
            <h1>Invoices</h1>
            <p v-if="!app.user?.simple_mode" class="muted">
                {{
                    app.user?.simple_mode
                        ? "Enter a customer mobile number to find their invoices."
                        : "Keep every sale organized, from first draft to final receipt."
                }}
            </p>
        </div>
        <RouterLink class="button primary" to="/invoices/new"
            ><Plus :size="18" />New Invoice</RouterLink
        >
    </div>
    <section class="list-panel invoices-panel simple-list-panel">
        <div v-if="!app.user?.simple_mode" class="panel-toolbar">
            <div class="tabs">
                <button
                    :class="{ selected: status === '' }"
                    @click="status = ''"
                >
                    All invoices</button
                ><button
                    :class="{ selected: status === 'draft' }"
                    @click="status = 'draft'"
                >
                    Drafts</button
                ><button
                    :class="{ selected: status === 'issued' }"
                    @click="status = 'issued'"
                >
                    Issued</button
                ><button
                    :class="{ selected: status === 'cancelled' }"
                    @click="status = 'cancelled'"
                >
                    Cancelled
                </button>
            </div>
            <span class="small muted desktop-only">MYR · Cash sales</span>
        </div>
        <div class="filters">
            <label class="search-field"
                ><Search :size="18" /><input
                    v-model="q"
                    type="search"
                    aria-label="Search invoices"
                    :placeholder="
                        app.user?.simple_mode
                            ? 'Search invoice or phone'
                            : 'Search number, customer, phone or vehicle…'
                    "
                    :inputmode="
                        app.user?.simple_mode ? 'tel' : 'text'
                    " /></label
            ><label v-if="!app.user?.simple_mode" class="date-filter"
                >From
                <input
                    v-model="from"
                    type="date"
                    aria-label="From date" /></label
            ><label v-if="!app.user?.simple_mode" class="date-filter"
                >To <input v-model="to" type="date" aria-label="To date"
            /></label>
            <PageSizeSelector v-model="pageSize" :busy="isServer && loading" />
            <span
                v-if="app.user?.simple_mode"
                class="simple-list-note"
                :title="
                    !isServer
                        ? 'Only invoices available on this device are shown.'
                        : undefined
                "
                >{{
                    loading
                        ? "Loading…"
                        : isServer
                          ? total + " invoices"
                          : "Saved results"
                }}</span
            >
        </div>
        <div v-if="!app.user?.simple_mode" class="dataset-note">
            <span>{{
                isServer
                    ? "Online records · " +
                      pageSize +
                      " per page, plus pending local work"
                    : "Records available on this device · may be incomplete"
            }}</span
            ><span>{{
                loading
                    ? "Loading…"
                    : isServer
                      ? total + " online invoices"
                      : list.length + " local invoices"
            }}</span>
        </div>
        <p v-if="error" class="hint padded">{{ error }}</p>
        <div class="invoice-table-wrap">
            <table class="invoice-table">
                <thead>
                    <tr>
                        <th>
                            {{
                                app.user?.simple_mode
                                    ? "Invoice"
                                    : "Invoice / date"
                            }}
                        </th>
                        <th>Customer</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th v-if="!app.user?.simple_mode">Created by</th>
                        <th v-if="!app.user?.simple_mode">Sync</th>
                        <th><span class="sr-only">Open</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="i in visibleInvoices"
                        :key="i.id"
                        class="clickable-row"
                        @click="$router.push('/invoices/' + i.id)"
                    >
                        <td>
                            <RouterLink
                                :to="'/invoices/' + i.id"
                                class="invoice-number"
                                @click.stop
                                >{{
                                    i.invoice_number ||
                                    "Draft · " + i.id.slice(0, 6)
                                }}</RouterLink
                            ><small v-if="!app.user?.simple_mode">{{
                                i.invoice_date
                            }}</small>
                            <small
                                v-if="
                                    app.user?.simple_mode &&
                                    ['Conflict', 'Needs attention'].includes(
                                        syncState(i),
                                    )
                                "
                                class="attention"
                                >Needs attention</small
                            >
                        </td>
                        <td>
                            <b>{{
                                i.customer_snapshot.name ||
                                "Customer not selected"
                            }}</b
                            ><small>{{
                                (app.user?.simple_mode
                                    ? i.customer_snapshot.phone
                                    : i.vehicle_registration ||
                                      i.customer_snapshot.phone) || "—"
                            }}</small>
                        </td>
                        <td class="amount">{{ money(i.total_cents) }}</td>
                        <td>
                            <span :class="['status', i.status]">{{
                                i.status
                            }}</span>
                        </td>
                        <td v-if="!app.user?.simple_mode">
                            {{ i.creator?.name || app.user?.name }}
                        </td>
                        <td v-if="!app.user?.simple_mode">
                            <span
                                :class="[
                                    'sync-state',
                                    {
                                        attention: [
                                            'Conflict',
                                            'Needs attention',
                                        ].includes(syncState(i)),
                                    },
                                ]"
                                >{{ syncState(i) }}</span
                            >
                        </td>
                        <td>
                            <RouterLink
                                class="icon-button"
                                :aria-label="
                                    'Open ' + (i.invoice_number || 'draft')
                                "
                                :to="'/invoices/' + i.id"
                                @click.stop
                                ><ArrowUpRight :size="18"
                            /></RouterLink>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="invoice-cards">
            <RouterLink
                v-for="i in visibleInvoices"
                :key="i.id"
                class="invoice-card"
                :to="'/invoices/' + i.id"
            >
                <template v-if="app.user?.simple_mode">
                    <div class="simple-invoice-top">
                        <div class="simple-invoice-reference">
                            <b>{{
                                i.invoice_number ||
                                "Draft · " + i.id.slice(0, 6)
                            }}</b>
                            <span :class="['status', i.status]">{{
                                i.status
                            }}</span>
                        </div>
                        <strong>{{ money(i.total_cents) }}</strong>
                    </div>
                    <h3 :title="i.customer_snapshot.name">
                        {{
                            i.customer_snapshot.name || "Customer not selected"
                        }}
                    </h3>
                    <p>{{ i.customer_snapshot.phone || "No phone saved" }}</p>
                    <p
                        v-if="
                            ['Conflict', 'Needs attention'].includes(
                                syncState(i),
                            )
                        "
                        class="attention"
                    >
                        Needs attention
                    </p>
                </template>
                <template v-else>
                    <div>
                        <b>{{
                            i.invoice_number || "Draft · " + i.id.slice(0, 6)
                        }}</b
                        ><span :class="['status', i.status]">{{
                            i.status
                        }}</span>
                    </div>
                    <h3>
                        {{
                            i.customer_snapshot.name || "Customer not selected"
                        }}
                    </h3>
                    <p>
                        {{ i.invoice_date }} ·
                        {{
                            i.vehicle_registration ||
                            i.customer_snapshot.phone ||
                            "—"
                        }}
                    </p>
                    <div>
                        <strong>{{ money(i.total_cents) }}</strong
                        ><span class="sync-state">{{ syncState(i) }}</span>
                    </div>
                    <small>{{ i.creator?.name || app.user?.name }}</small>
                </template>
            </RouterLink>
        </div>
        <div v-if="!list.length" class="empty-state">
            <span class="empty-icon"><FileText :size="30" /></span>
            <h2>
                {{
                    q || status || from || to
                        ? "No matching invoices"
                        : "Ready for your next sale"
                }}
            </h2>
            <p>
                {{
                    q || status || from || to
                        ? "Try another search or change the filters."
                        : "Create your first cash sales invoice. Drafts save automatically on this device."
                }}
            </p>
            <RouterLink to="/invoices/new" class="button primary"
                ><Plus :size="18" />New Invoice</RouterLink
            >
        </div>
        <Pagination
            v-model="currentPage"
            :page-size="pageSize"
            :page-count="pageCount"
            :total="isServer ? total : list.length"
            :busy="isServer && loading"
            label="Invoices"
        />
    </section>
    <div v-if="!app.user?.simple_mode" class="list-footer">
        <span
            ><span class="connection-dot" /> {{ app.remaining }} offline invoice
            numbers ready</span
        ><RouterLink to="/sync">View sync status →</RouterLink>
    </div>
</template>
