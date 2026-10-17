<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, PenLine, Plus, Car } from "@lucide/vue";
import { useApp } from "../store";
import { api } from "../lib/api";
import {
    formatPhone,
    normalizeRegistration,
    type Customer,
    type Vehicle,
} from "../lib/types";
import CustomerForm from "../components/CustomerForm.vue";
import VehicleForm from "../components/VehicleForm.vue";
import VehicleDetails from "../components/VehicleDetails.vue";
import ListingPanel from "../components/ListingPanel.vue";
import { usePagination } from "../lib/pagination";
import Modal from "../components/Modal.vue";
const app = useApp(),
    route = useRoute(),
    error = ref(""),
    editing = ref(false),
    carSearch = ref(""),
    viewingCar = ref<Vehicle>(),
    editingCar = ref<Vehicle>(),
    carForm = ref(false);
const customer = computed(() =>
    app.customers.find((customer) => customer.id === route.params.id),
);
const cars = computed(() => {
    const query = carSearch.value.trim().toLowerCase();
    const registrationQuery = normalizeRegistration(query);
    return app.vehicles
        .filter(
            (vehicle) =>
                vehicle.customer_ids.includes(String(route.params.id)) &&
                ((vehicle.registration + " " + vehicle.car_model)
                    .toLowerCase()
                    .includes(query) ||
                    (registrationQuery !== "" &&
                        vehicle.normalized_registration.includes(
                            registrationQuery,
                        ))),
        )
        .sort((a, b) => a.registration.localeCompare(b.registration));
});
const { page, pageSize, pageCount, pagedRecords, resetPage } =
    usePagination(cars);
watch(carSearch, resetPage);
function editCar(vehicle?: Vehicle) {
    viewingCar.value = undefined;
    editingCar.value = vehicle;
    carForm.value = true;
}
watch(
    () => route.params.id,
    async (id) => {
        error.value = "";
        editing.value = false;
        if (customer.value) return;
        const unavailableMessage =
            "Customer is unavailable on this device. Connect and sync to download it.";
        if (!app.online || app.needsAuth) {
            error.value = unavailableMessage;
            return;
        }
        try {
            const row = await api<Customer>("/customers/" + id);
            await app.vault!.put("customer", row.id, row);
            await app.refresh();
        } catch {
            error.value = unavailableMessage;
        }
    },
    { immediate: true },
);
</script>
<template>
    <div class="page-heading compact">
        <div>
            <RouterLink to="/customers" class="back-link">
                <ArrowLeft :size="15" />Customers
            </RouterLink>
            <h1>{{ customer?.name || "Customer" }}</h1>
            <p class="muted">Customer details</p>
        </div>
        <button v-if="customer" class="button primary" @click="editing = true">
            <PenLine :size="17" />Edit customer
        </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="customer" class="stack">
        <section class="card">
            <div class="section-title"><h2>Contact details</h2></div>
            <dl class="customer-details">
                <div>
                    <dt>Phone</dt>
                    <dd>{{ customer.phone || "—" }}</dd>
                    <p
                        v-if="!formatPhone(customer.phone ?? '')"
                        class="error small"
                    >
                        Invalid phone number · edit to correct
                    </p>
                </div>
                <div>
                    <dt>Email</dt>
                    <dd>{{ customer.email || "—" }}</dd>
                </div>
                <div class="span-full">
                    <dt>Address</dt>
                    <dd class="preserve">{{ customer.address || "—" }}</dd>
                </div>
                <div class="span-full">
                    <dt>Notes</dt>
                    <dd class="preserve">{{ customer.notes || "—" }}</dd>
                </div>
            </dl>
        </section>
        <section class="card customer-cars" aria-label="Customer cars">
            <div class="section-title">
                <h2>Cars</h2>
                <button class="button secondary" @click="editCar()">
                    <Plus :size="17" />Add car
                </button>
            </div>
            <ListingPanel
                v-model:search="carSearch"
                v-model:page="page"
                v-model:page-size="pageSize"
                :records="pagedRecords"
                :total="cars.length"
                :page-count="pageCount"
                :record-label="(vehicle) => vehicle.registration"
                label="Customer cars"
                row-class="vehicle-row"
                search-placeholder="Search registration or model"
                empty-title="No cars linked yet"
                empty-message="Cars saved on this customer’s invoices appear here. You can also add a car."
                @view="viewingCar = $event"
            >
                <template #empty-icon><Car :size="32" /></template>
                <template #default="{ record: vehicle }">
                    <Car :size="24" />
                    <div class="customer-info">
                        <h3>{{ vehicle.registration }}</h3>
                        <p>{{ vehicle.car_model }}</p>
                        <p v-if="vehicle.notes" class="muted">
                            {{ vehicle.notes }}
                        </p>
                    </div>
                </template>
                <template #actions="{ record: vehicle }">
                    <button
                        class="icon-button"
                        :aria-label="'Edit car ' + vehicle.registration"
                        @click="editCar(vehicle)"
                    >
                        <PenLine :size="18" />
                    </button>
                </template>
            </ListingPanel>
        </section>
    </div>
    <VehicleDetails
        v-if="viewingCar"
        :vehicle="viewingCar"
        @close="viewingCar = undefined"
        @edit="editCar"
    />
    <Modal v-if="carForm && customer" @close="carForm = false">
        <template #title
            ><h2>{{ editingCar ? "Edit car" : "Add car" }}</h2></template
        >
        <VehicleForm
            :vehicle="editingCar"
            :customer-id="customer.id"
            @saved="carForm = false"
            @cancel="carForm = false"
        />
    </Modal>
    <Modal v-if="editing && customer" @close="editing = false">
        <template #title><h2>Edit customer</h2></template>
        <CustomerForm
            :customer="customer"
            @saved="editing = false"
            @cancel="editing = false"
        />
    </Modal>
</template>
