<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, Search, PenLine, Users, ArrowUpRight } from "@lucide/vue";
import { useApp } from "../store";
import { formatPhone, normalizePhone, type Customer } from "../lib/types";
import CustomerForm from "../components/CustomerForm.vue";
import Modal from "../components/Modal.vue";
import Pagination from "../components/Pagination.vue";
import PageSizeSelector from "../components/PageSizeSelector.vue";
import { usePagination } from "../lib/pagination";
const app = useApp(),
    q = ref(""),
    phoneStatus = ref<"all" | "invalid" | "valid">("all"),
    form = ref(false),
    editing = ref<Customer>();
const list = computed(() =>
    app.customers
        .filter((c) => {
            const validPhone = formatPhone(c.phone ?? "") !== null;
            const matchesPhoneStatus =
                phoneStatus.value === "all" ||
                (phoneStatus.value === "valid" ? validPhone : !validPhone);
            const search = q.value.trim().toLowerCase();
            const phoneSearch = normalizePhone(search);
            return (
                matchesPhoneStatus &&
                ((c.name + " " + c.phone + " " + c.normalized_phone)
                    .toLowerCase()
                    .includes(search) ||
                    (phoneSearch !== "" &&
                        normalizePhone(c.phone ?? "").includes(phoneSearch)))
            );
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
);
const { page, pageSize, pageCount, pagedRecords, resetPage } =
    usePagination(list);
watch([q, phoneStatus], resetPage);
watch(
    () => app.user?.simple_mode,
    (enabled) => {
        if (enabled) phoneStatus.value = "all";
    },
);
watch(
    () => app.user?.role,
    (role) => {
        if (role !== "admin") phoneStatus.value = "all";
    },
);
function duplicates(c: Customer) {
    const phone = formatPhone(c.phone ?? "");
    if (!phone) return [];
    return app.customers.filter(
        (o) => o.id !== c.id && formatPhone(o.phone ?? "") === phone,
    );
}
function edit(c?: Customer) {
    editing.value = c;
    form.value = true;
}
</script>
<template>
    <div class="page-heading simple-list-heading">
        <div>
            <span class="eyebrow">PEOPLE AT THE HEART OF EVERY SALE</span>
            <h1>Customers</h1>
            <p v-if="!app.user?.simple_mode" class="muted">
                Find familiar faces and keep their details close.
            </p>
        </div>
        <button class="button primary" @click="edit()">
            <Plus :size="18" />Create customer
        </button>
    </div>
    <section class="list-panel customers-panel simple-list-panel">
        <div class="filters">
            <label class="search-field"
                ><Search :size="18" /><input
                    v-model="q"
                    type="search"
                    placeholder="Search by name or phone"
                    aria-label="Search customers"
            /></label>
            <label
                v-if="app.user?.role === 'admin' && !app.user.simple_mode"
                class="date-filter"
                >Phone numbers
                <select v-model="phoneStatus" aria-label="Filter phone numbers">
                    <option value="all">All phone numbers</option>
                    <option value="invalid">Invalid phone numbers</option>
                    <option value="valid">Valid phone numbers</option>
                </select>
            </label>
            <PageSizeSelector v-model="pageSize" />
            <span
                v-if="app.user?.simple_mode"
                class="simple-list-note"
                :title="
                    !app.online
                        ? 'Offline results may be incomplete.'
                        : undefined
                "
                >{{
                    app.online ? list.length + " customers" : "Offline results"
                }}</span
            >
        </div>
        <div v-if="!app.user?.simple_mode" class="dataset-note">
            <span
                >Customers downloaded to this device ·
                {{
                    app.online
                        ? "refreshed by sync"
                        : "offline results may be incomplete"
                }}</span
            ><span>{{ list.length }} customers</span>
        </div>
        <div v-if="!list.length" class="empty-state">
            <Users :size="32" />
            <h2>
                {{
                    q || phoneStatus !== "all"
                        ? "No matching customers"
                        : "A good place to start"
                }}
            </h2>
            <p>Create a customer here, or while entering an invoice.</p>
            <button class="button primary" @click="edit()">
                Create customer
            </button>
        </div>
        <div
            v-if="app.user?.simple_mode && list.length"
            class="customer-columns"
            aria-hidden="true"
        >
            <span>Customer</span><span>Phone</span>
        </div>
        <div v-if="!app.user?.simple_mode" class="customer-table-wrap">
            <table class="invoice-table customer-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Address</th>
                        <th><span class="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="c in pagedRecords"
                        :key="c.id"
                        class="clickable-row"
                        @click="$router.push('/customers/' + c.id)"
                    >
                        <td>
                            <RouterLink
                                :to="'/customers/' + c.id"
                                :title="c.name"
                                class="invoice-number customer-name"
                                @click.stop
                                >{{ c.name }}</RouterLink
                            >
                            <small
                                v-if="c.notes"
                                class="customer-summary"
                                :title="c.notes"
                                >{{ c.notes }}</small
                            >
                        </td>
                        <td>
                            <span class="customer-phone">{{
                                c.phone || "—"
                            }}</span>
                            <small
                                v-if="!formatPhone(c.phone ?? '')"
                                class="attention"
                                >Invalid phone number · edit to correct</small
                            >
                            <details
                                v-if="duplicates(c).length"
                                class="duplicate-warning"
                                @click.stop
                            >
                                <summary>
                                    {{ duplicates(c).length }} possible
                                    duplicate(s)
                                </summary>
                                <p
                                    v-for="duplicate in duplicates(c)"
                                    :key="duplicate.id"
                                >
                                    {{ duplicate.name }} ·
                                    {{ duplicate.phone }} ·
                                    {{ duplicate.id.slice(0, 8) }}
                                </p>
                                <p>
                                    No automatic merge. Keep both until an
                                    administrator reviews the submitted details.
                                </p>
                            </details>
                        </td>
                        <td>
                            <span class="customer-email" :title="c.email">{{
                                c.email || "—"
                            }}</span>
                        </td>
                        <td>
                            <span
                                class="customer-address preserve"
                                :title="c.address"
                                >{{ c.address || "—" }}</span
                            >
                        </td>
                        <td>
                            <div class="customer-row-actions">
                                <button
                                    class="icon-button"
                                    :aria-label="'Edit ' + c.name"
                                    @click.stop="edit(c)"
                                >
                                    <PenLine :size="18" />
                                </button>
                                <RouterLink
                                    class="icon-button"
                                    :aria-label="'Open ' + c.name"
                                    :to="'/customers/' + c.id"
                                    @click.stop
                                >
                                    <ArrowUpRight :size="18" />
                                </RouterLink>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div
            class="customer-list"
            :class="{ 'customer-mobile-list': !app.user?.simple_mode }"
        >
            <article
                v-for="c in pagedRecords"
                :key="c.id"
                class="customer-row clickable-row"
                @click="$router.push('/customers/' + c.id)"
            >
                <span class="avatar subtle">{{ c.name.slice(0, 1) }}</span>
                <div class="customer-info">
                    <h3>
                        <RouterLink
                            :to="'/customers/' + c.id"
                            :title="c.name"
                            @click.stop
                        >
                            {{ c.name }}
                        </RouterLink>
                    </h3>
                    <p class="customer-contact">
                        {{ c.phone }}
                        <span v-if="c.email && !app.user?.simple_mode"
                            >· {{ c.email }}</span
                        >
                    </p>
                    <p
                        v-if="
                            !app.user?.simple_mode &&
                            !formatPhone(c.phone ?? '')
                        "
                        class="error small"
                    >
                        Invalid phone number · edit to correct
                    </p>
                    <p
                        v-if="c.address && !app.user?.simple_mode"
                        class="muted preserve"
                    >
                        {{ c.address }}
                    </p>
                    <p
                        v-if="c.notes && !app.user?.simple_mode"
                        class="small muted"
                    >
                        {{ c.notes }}
                    </p>
                    <details
                        v-if="!app.user?.simple_mode && duplicates(c).length"
                        class="duplicate-warning"
                        @click.stop
                    >
                        <summary>
                            Possible duplicate phone · review
                            {{ duplicates(c).length }} match(es)
                        </summary>
                        <p v-for="d in duplicates(c)" :key="d.id">
                            {{ d.name }} · {{ d.phone }} ·
                            {{ d.id.slice(0, 8) }}
                        </p>
                        <p>
                            No automatic merge. Keep both until an administrator
                            reviews the submitted details.
                        </p>
                    </details>
                </div>
                <button
                    class="icon-button"
                    :aria-label="'Edit ' + c.name"
                    @click.stop="edit(c)"
                >
                    <PenLine :size="18" />
                </button>
            </article>
        </div>
        <Pagination
            v-model="page"
            :page-size="pageSize"
            :page-count="pageCount"
            :total="list.length"
            label="Customers"
        />
    </section>
    <Modal v-if="form" @close="form = false"
        ><template #title
            ><h2>
                {{ editing ? "Edit customer" : "Create customer" }}
            </h2></template
        ><CustomerForm
            :customer="editing"
            :prefill="q"
            @saved="form = false"
            @cancel="form = false"
        />
        <p class="hint">
            Issued invoices keep the original customer details printed at the
            time of sale.
        </p></Modal
    >
</template>
