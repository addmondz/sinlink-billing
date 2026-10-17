<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
    Plus,
    Trash2,
    Search,
    Check,
    Eye,
    Download,
    Printer,
    ArrowLeft,
} from "@lucide/vue";
import { useApp } from "../store";
import { api } from "../lib/api";
import { calculate, money, amountWords } from "../lib/money";
import {
    uuid,
    todayKL,
    normalizeRegistration,
    type Vehicle,
    type Invoice,
    type Customer,
    type Item,
} from "../lib/types";
import { downloadPdf } from "../lib/document";
import { searchCustomersByPhone } from "../lib/customer-search";
import CustomerForm from "../components/CustomerForm.vue";
import VehicleForm from "../components/VehicleForm.vue";
import InvoiceDocument from "../components/InvoiceDocument.vue";
import Modal from "../components/Modal.vue";
const app = useApp(),
    route = useRoute(),
    router = useRouter(),
    model = ref<Invoice>(),
    search = ref(""),
    showCustomer = ref(false),
    showVehicle = ref(false),
    preview = ref(false),
    error = ref(""),
    saved = ref(""),
    busy = ref(false),
    ready = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined,
    chain = Promise.resolve();
const matches = computed(() =>
    searchCustomersByPhone(app.customers, search.value),
);
const selected = computed(() =>
    app.customers.find((c) => c.id === model.value?.customer_id),
);
const customerVehicles = computed(() =>
    app.vehicles.filter((vehicle) =>
        vehicle.customer_ids.includes(model.value?.customer_id ?? ""),
    ),
);
const selectedVehicle = computed(
    () =>
        customerVehicles.value.find(
            (vehicle) =>
                normalizeRegistration(vehicle.registration) ===
                normalizeRegistration(model.value?.vehicle_registration ?? ""),
        )?.id ?? "",
);
function useVehicle(vehicle?: Vehicle) {
    if (!vehicle) return;
    model.value!.vehicle_registration = vehicle.registration;
    model.value!.car_model = vehicle.car_model;
    showVehicle.value = false;
}
const totals = computed(() => {
    try {
        return calculate(model.value?.items ?? []);
    } catch {
        return {
            total_cents: model.value?.total_cents ?? 0,
            subtotal_cents: model.value?.subtotal_cents ?? 0,
            total_quantity: model.value?.total_quantity ?? "0.000",
            items: model.value?.items ?? [],
        };
    }
});
function addItem() {
    model.value!.items.push({
        id: uuid(),
        description: "",
        quantity: "1",
        unit: "PCS",
        unit_price: "0.00",
        amount_cents: 0,
    });
}
function select(c: Customer) {
    model.value!.customer_id = c.id;
    model.value!.customer_snapshot = {
        name: c.name,
        phone: c.phone,
        address: c.address ?? "",
        email: c.email ?? "",
    };
    search.value = "";
    error.value = "";
}
function created(c: Customer) {
    select(c);
    showCustomer.value = false;
}
function snapshot() {
    return { ...model.value!, ...totals.value };
}
async function autosave() {
    if (!model.value || !ready.value) return;
    saved.value = "Saving…";
    chain = chain
        .catch(() => {})
        .then(async () => {
            if (!model.value) return;
            const result = await app.persistDraft(snapshot());
            model.value.saved_at = result.saved_at;
            model.value.local_revision = result.local_revision;
            model.value.version = result.version;
            model.value.total_cents = result.total_cents;
            saved.value = "Saved on this device";
            error.value = "";
        })
        .catch((e) => {
            saved.value = "Save needs attention";
            error.value = (e as Error).message;
            throw e;
        });
    await chain;
}
async function flush() {
    if (timer) {
        clearTimeout(timer);
        timer = undefined;
        await autosave();
    } else await chain;
}
async function saveDraft() {
    busy.value = true;
    error.value = "";
    try {
        await flush();
        const saved = await app.persistDraft(snapshot(), true);
        model.value!.saved_at = saved.saved_at;
        model.value!.local_revision = saved.local_revision;
        model.value!.version = saved.version;
        await router.replace("/invoices/" + saved.id);
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
async function issue() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        await flush();
        const invoice = await app.issue(snapshot());
        ready.value = false;
        await router.replace("/invoices/" + invoice.id);
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
async function openPreview() {
    try {
        await flush();
        preview.value = true;
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function printDraft() {
    try {
        await flush();
        preview.value = true;
        await nextTick();
        print();
    } catch (e) {
        error.value = (e as Error).message;
    }
}
async function pdf() {
    try {
        await flush();
        await downloadPdf(snapshot());
    } catch (e) {
        error.value = (e as Error).message;
    }
}
function print() {
    const c = model.value!.company_snapshot;
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
const warn = (e: BeforeUnloadEvent) => {
    if (saved.value === "Saving…") {
        e.preventDefault();
        e.returnValue = "";
    }
};
onMounted(async () => {
    try {
        if (route.params.id) {
            let row = await app.vault!.get<Invoice>(
                "invoice",
                String(route.params.id),
            );
            if (!row) {
                row = await api("/invoices/" + route.params.id);
                await app.vault!.put("invoice", row!.id, row);
            }
            if (!row) throw new Error("Invoice unavailable on this device.");
            if (row.status !== "draft")
                return void router.replace("/invoices/" + row.id);
            if (row.created_by !== app.user!.id && app.user!.role !== "admin")
                throw new Error(
                    "Only the creator or an administrator can edit this draft.",
                );
            model.value = JSON.parse(JSON.stringify(row));
        } else {
            const original = app.invoices.find(
                (i) => i.id === route.query.replace,
            );
            model.value = {
                id: uuid(),
                invoice_number: null,
                status: "draft",
                invoice_date: todayKL(),
                customer_id: "",
                customer_snapshot: {},
                company_snapshot: JSON.parse(JSON.stringify(app.company)),
                vehicle_registration: original?.vehicle_registration ?? "",
                car_model: original?.car_model ?? "",
                notes: "",
                items: [],
                total_cents: 0,
                subtotal_cents: 0,
                total_quantity: "0.000",
                version: 0,
                created_by: app.user!.id,
                creator: { id: app.user!.id, name: app.user!.name },
                device_id: app.vault!.profile.device_id,
                created_at: new Date().toISOString(),
                local_only: true,
            };
            if (original) {
                if (original.status !== "cancelled")
                    throw new Error(
                        "Cancel the original before making a replacement.",
                    );
                model.value.replacement_for = original.id;
                model.value.customer_id = original.customer_id;
                model.value.customer_snapshot = {
                    ...original.customer_snapshot,
                };
                model.value.items = original.items.map((i) => ({
                    ...i,
                    id: uuid(),
                }));
            } else addItem();
            // Give new drafts a stable URL immediately so reopening the screen restores the same draft.
            await app.vault!.put(
                "invoice",
                model.value.id,
                JSON.parse(JSON.stringify(model.value)),
            );
            await app.refresh();
            await router.replace("/invoices/" + model.value.id + "/edit");
            return;
        }
        ready.value = true;
        saved.value = "Saved on this device";
        app.setDraftFlusher(flush);
        window.addEventListener("beforeunload", warn);
    } catch (e) {
        error.value = (e as Error).message;
    }
});
watch(
    () =>
        JSON.stringify(
            model.value && {
                customer_id: model.value.customer_id,
                customer_snapshot: model.value.customer_snapshot,
                invoice_date: model.value.invoice_date,
                vehicle_registration: model.value.vehicle_registration,
                car_model: model.value.car_model,
                notes: model.value.notes,
                items: model.value.items,
            },
        ),
    () => {
        if (!ready.value) return;
        saved.value = "Saving…";
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            void autosave().catch(() => {});
        }, 300);
    },
);
onBeforeRouteLeave(async () => {
    if (ready.value) {
        try {
            await flush();
        } catch {
            return false;
        }
    }
});
onUnmounted(() => {
    clearTimeout(timer);
    app.setDraftFlusher();
    window.removeEventListener("beforeunload", warn);
});
</script>
<template>
    <div class="page-heading compact">
        <div>
            <RouterLink to="/" class="back-link"
                ><ArrowLeft :size="15" />Invoices</RouterLink
            >
            <h1>New cash sale</h1>
            <p class="muted">A few details. A clear receipt. Ready to go.</p>
        </div>
        <span class="saved-indicator" role="status"
            ><Check :size="16" />{{ saved }}</span
        >
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <form v-if="model && ready" class="editor-layout" @submit.prevent="issue">
        <div class="editor-main">
            <section class="card">
                <div class="section-title">
                    <span class="step">01</span>
                    <h2>Customer</h2>
                    <button
                        v-if="model.customer_id"
                        type="button"
                        class="text-button"
                        @click="
                            model.customer_id = '';
                            model.customer_snapshot = {};
                        "
                    >
                        Change
                    </button>
                </div>
                <template v-if="!model.customer_id"
                    ><label class="search-field customer-search"
                        ><Search :size="19" /><input
                            v-model="search"
                            aria-label="Find customer by mobile number"
                            placeholder="Enter customer mobile number"
                            inputmode="tel"
                            autocomplete="off"
                    /></label>
                    <p class="hint">
                        Enter at least 3 digits to find a customer saved on this
                        device.
                        {{
                            app.online
                                ? "Sync refreshes this list."
                                : "Offline results may be incomplete."
                        }}
                    </p>
                    <div class="customer-matches">
                        <button
                            v-for="c in matches"
                            :key="c.id"
                            type="button"
                            @click="select(c)"
                        >
                            <span class="avatar subtle">{{
                                c.name.slice(0, 1)
                            }}</span
                            ><span
                                ><b>{{ c.name }}</b
                                ><small>{{ c.phone }}</small></span
                            ><span class="match-arrow">→</span>
                        </button>
                    </div>
                    <p
                        v-if="
                            search.replace(/\D/g, '').length >= 3 &&
                            !matches.length
                        "
                        class="hint"
                    >
                        No matching customers on this device. You can create a
                        customer here.
                    </p>
                    <button
                        type="button"
                        class="button secondary"
                        @click="showCustomer = true"
                    >
                        <Plus :size="17" />Create customer<span v-if="search"
                            >“{{ search }}”</span
                        >
                    </button></template
                >
                <div v-else class="selected-customer">
                    <span class="avatar">{{
                        model.customer_snapshot.name?.slice(0, 1)
                    }}</span>
                    <div>
                        <h3>{{ model.customer_snapshot.name }}</h3>
                        <p>{{ model.customer_snapshot.phone }}</p>
                        <p class="muted preserve">
                            {{ model.customer_snapshot.address }}
                        </p>
                        <p
                            v-if="selected?.possible_duplicates?.length"
                            class="hint attention"
                        >
                            Possible phone duplicate. Review in Customers.
                        </p>
                    </div>
                    <Check :size="20" class="selected-check" />
                </div>
            </section>
            <section class="card">
                <div class="section-title">
                    <span class="step">02</span>
                    <h2>Invoice details</h2>
                    <span class="status draft">Draft</span>
                </div>
                <div class="form-grid">
                    <label
                        >Invoice date<input
                            v-model="model.invoice_date"
                            type="date"
                            required /></label
                    ><label
                        >Invoice number<input
                            value="Assigned when issued"
                            readonly
                            class="readonly"
                    /></label>
                </div>
                <div class="invoice-vehicle">
                    <div class="invoice-vehicle-heading">
                        <h3>
                            Car details <span class="muted">· optional</span>
                        </h3>
                        <button
                            type="button"
                            class="button secondary"
                            :disabled="!model.customer_id"
                            @click="showVehicle = true"
                        >
                            <Plus :size="17" />Add car
                        </button>
                    </div>
                    <p v-if="!model.customer_id" class="hint">
                        Select a customer first to choose or add a car.
                    </p>
                    <p v-else-if="!customerVehicles.length" class="hint">
                        No cars
                    </p>
                    <div class="form-grid">
                        <label v-if="customerVehicles.length" class="span-full"
                            >Select car<select
                                aria-label="Select car"
                                :value="selectedVehicle"
                                :disabled="!model.customer_id"
                                @change="
                                    useVehicle(
                                        app.vehicles.find(
                                            (vehicle) =>
                                                vehicle.id ===
                                                (
                                                    $event.target as HTMLSelectElement
                                                ).value,
                                        ),
                                    )
                                "
                            >
                                <option value="">
                                    Choose a linked car or enter details below
                                </option>
                                <option
                                    v-for="vehicle in customerVehicles"
                                    :key="vehicle.id"
                                    :value="vehicle.id"
                                >
                                    {{ vehicle.registration }} ·
                                    {{ vehicle.car_model }}
                                </option>
                            </select></label
                        >
                        <label
                            >Registration number<input
                                v-model="model.vehicle_registration"
                                placeholder="e.g. WXY 1234"
                                maxlength="40"
                                class="uppercase" /></label
                        ><label
                            >Car model<input
                                v-model="model.car_model"
                                placeholder="e.g. Perodua Myvi"
                                maxlength="255"
                        /></label>
                    </div>
                </div>
            </section>
            <section class="card items-card">
                <div class="section-title">
                    <span class="step">03</span>
                    <h2>Line items</h2>
                    <span class="muted small"
                        >{{ model.items.length }} items</span
                    >
                </div>
                <div class="item-grid item-head">
                    <span>Description</span><span>Quantity</span
                    ><span>Unit</span><span>Unit price (RM)</span
                    ><span>Amount (RM)</span><span />
                </div>
                <div
                    v-for="(item, index) in model.items"
                    :key="item.id"
                    class="item-grid item-entry"
                >
                    <label class="item-description"
                        ><span class="mobile-only"
                            >Item {{ index + 1 }} · Description</span
                        ><textarea
                            v-model="item.description"
                            :aria-label="'Item ' + (index + 1) + ' description'"
                            rows="2"
                            placeholder="Item or service description"
                            maxlength="4000"
                            required
                        /></label
                    ><label
                        ><span class="mobile-only">Quantity</span
                        ><input
                            v-model="item.quantity"
                            :aria-label="'Item ' + (index + 1) + ' quantity'"
                            inputmode="decimal"
                            required /></label
                    ><label
                        ><span class="mobile-only">Unit</span
                        ><input
                            v-model="item.unit"
                            :aria-label="'Item ' + (index + 1) + ' unit'"
                            maxlength="20"
                            required /></label
                    ><label
                        ><span class="mobile-only">Unit price (RM)</span
                        ><input
                            v-model="item.unit_price"
                            :aria-label="'Item ' + (index + 1) + ' unit price'"
                            inputmode="decimal"
                            required /></label
                    ><output class="line-amount"
                        ><span class="mobile-only">Amount</span
                        >{{
                            (
                                (totals.items[index]?.amount_cents ?? 0) / 100
                            ).toFixed(2)
                        }}</output
                    ><button
                        type="button"
                        class="icon-button remove-item"
                        :aria-label="'Remove item ' + (index + 1)"
                        @click="model.items.splice(index, 1)"
                    >
                        <Trash2 :size="17" />
                    </button>
                </div>
                <button
                    type="button"
                    class="button secondary add-item"
                    @click="addItem"
                >
                    <Plus :size="17" />Add item
                </button>
            </section>
            <section class="card">
                <label
                    >Remarks <span class="muted">· optional</span
                    ><textarea
                        v-model="model.notes"
                        rows="3"
                        maxlength="4000"
                        placeholder="Anything else for the customer?"
                    />
                </label>
            </section>
        </div>
        <aside class="editor-summary">
            <section class="card summary-card">
                <span class="eyebrow">SALE SUMMARY</span>
                <h2>All added up.</h2>
                <dl>
                    <div>
                        <dt>Total quantity</dt>
                        <dd>{{ totals.total_quantity }}</dd>
                    </div>
                    <div>
                        <dt>Subtotal</dt>
                        <dd>{{ money(totals.subtotal_cents) }}</dd>
                    </div>
                </dl>
                <div class="summary-total">
                    <span>Total amount</span
                    ><strong>{{ money(totals.total_cents) }}</strong
                    ><small>Malaysian ringgit</small>
                </div>
                <p class="amount-words">
                    {{ amountWords(totals.total_cents) }}
                </p>
                <button
                    class="button primary full"
                    :disabled="busy || !app.remaining"
                    type="submit"
                >
                    <Check :size="18" />{{ busy ? "Saving…" : "Issue Invoice" }}
                </button>
                <p v-if="!app.remaining" class="hint attention">
                    No reserved numbers. Save a draft and connect to refill.
                </p>
                <button
                    type="button"
                    class="button secondary full"
                    :disabled="busy"
                    @click="saveDraft"
                >
                    Save Draft
                </button>
                <div class="output-buttons">
                    <button type="button" @click="openPreview">
                        <Eye :size="17" />Preview</button
                    ><button type="button" @click="printDraft">
                        <Printer :size="17" />Print</button
                    ><button type="button" @click="pdf">
                        <Download :size="17" />PDF
                    </button>
                </div>
                <p class="hint">
                    Issuing makes the invoice final. Corrections require
                    cancellation and a replacement.
                </p>
            </section>
            <p class="summary-note">
                <span class="connection-dot" />{{ app.remaining }} final numbers
                available<br /><span>Drafts do not use invoice numbers.</span>
            </p>
        </aside>
    </form>
    <Modal v-if="showCustomer" @close="showCustomer = false"
        ><template #title><h2>Create customer</h2></template
        ><CustomerForm
            :prefill="search"
            @saved="created"
            @cancel="showCustomer = false"
    /></Modal>
    <Modal v-if="showVehicle" @close="showVehicle = false"
        ><template #title><h2>Add car</h2></template
        ><VehicleForm
            :customer-id="model?.customer_id"
            @saved="useVehicle"
            @cancel="showVehicle = false"
    /></Modal>
    <Modal
        v-if="preview && model"
        class="preview-modal"
        @close="preview = false"
        ><template #title><h2>Draft preview</h2></template>
        <div class="preview-actions no-print">
            <span class="hint">Sinlink cash sales layout</span
            ><button class="button secondary" @click="print">
                <Printer :size="16" />Print</button
            ><button class="button primary" @click="pdf">
                <Download :size="16" />PDF
            </button>
        </div>
        <div id="print-area"><InvoiceDocument :invoice="snapshot()" /></div
    ></Modal>
</template>
