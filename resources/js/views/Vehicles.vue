<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, PenLine, Car } from "@lucide/vue";
import { useApp } from "../store";
import { normalizeRegistration, type Vehicle } from "../lib/types";
import VehicleForm from "../components/VehicleForm.vue";
import VehicleDetails from "../components/VehicleDetails.vue";
import Modal from "../components/Modal.vue";
import ListingPanel from "../components/ListingPanel.vue";
import { usePagination } from "../lib/pagination";
const app = useApp(),
    search = ref(""),
    viewing = ref<Vehicle>(),
    form = ref(false),
    editing = ref<Vehicle>();
const list = computed(() =>
    app.vehicles
        .filter((vehicle) => {
            const customers = app.customers.filter((customer) =>
                vehicle.customer_ids.includes(customer.id),
            );
            const text = [
                vehicle.registration,
                vehicle.car_model,
                ...customers.map(
                    (customer) => customer.name + " " + customer.phone,
                ),
            ]
                .join(" ")
                .toLowerCase();
            const query = search.value.trim();
            return (
                text.includes(query.toLowerCase()) ||
                (!!normalizeRegistration(query) &&
                    vehicle.normalized_registration.includes(
                        normalizeRegistration(query),
                    ))
            );
        })
        .sort((a, b) => a.registration.localeCompare(b.registration)),
);
const { page, pageSize, pageCount, pagedRecords, resetPage } =
    usePagination(list);
watch(search, resetPage);
function edit(vehicle?: Vehicle) {
    viewing.value = undefined;
    editing.value = vehicle;
    form.value = true;
}
</script>
<template>
    <div class="page-heading">
        <div>
            <h1>Cars</h1>
            <p class="muted">
                Save a car once and link every customer who shares it.
            </p>
        </div>
        <button class="button primary" @click="edit()">
            <Plus :size="18" />Create car
        </button>
    </div>
    <ListingPanel
        v-model:search="search"
        v-model:page="page"
        v-model:page-size="pageSize"
        :records="pagedRecords"
        :total="list.length"
        :page-count="pageCount"
        :record-label="(vehicle) => vehicle.registration"
        label="Cars"
        row-class="vehicle-row"
        search-placeholder="Registration, model or customer"
        empty-title="No cars saved yet"
        empty-message="Create a car here or while entering an invoice."
        @view="viewing = $event"
    >
        <template #summary>
            <span>Cars downloaded to this device · refreshed by sync</span
            ><span>{{ list.length }} cars</span>
        </template>
        <template #empty-icon><Car :size="32" /></template>
        <template #default="{ record: vehicle }">
            <Car :size="24" />
            <div class="customer-info">
                <h3>{{ vehicle.registration }}</h3>
                <p>{{ vehicle.car_model }}</p>
                <p
                    v-for="customer in app.customers.filter((customer) =>
                        vehicle.customer_ids.includes(customer.id),
                    )"
                    :key="customer.id"
                >
                    {{ customer.name }} · {{ customer.phone }}
                </p>
                <p v-if="vehicle.notes" class="muted">{{ vehicle.notes }}</p>
            </div>
        </template>
        <template #actions="{ record: vehicle }">
            <button
                class="icon-button"
                :aria-label="'Edit car ' + vehicle.registration"
                @click="edit(vehicle)"
            >
                <PenLine :size="18" />
            </button>
        </template>
    </ListingPanel>
    <VehicleDetails
        v-if="viewing"
        :vehicle="viewing"
        @close="viewing = undefined"
        @edit="edit"
    />
    <Modal v-if="form" @close="form = false"
        ><template #title
            ><h2>{{ editing ? "Edit car" : "Create car" }}</h2></template
        ><VehicleForm
            :vehicle="editing"
            @saved="form = false"
            @cancel="form = false"
    /></Modal>
</template>
