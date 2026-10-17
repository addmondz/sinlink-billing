<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, PenLine } from "@lucide/vue";
import { useApp } from "../store";
import { api } from "../lib/api";
import { formatPhone, type Customer } from "../lib/types";
import CustomerForm from "../components/CustomerForm.vue";
import Modal from "../components/Modal.vue";
const app = useApp(),
    route = useRoute(),
    error = ref(""),
    editing = ref(false);
const customer = computed(() =>
    app.customers.find((customer) => customer.id === route.params.id),
);
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
    <section v-if="customer" class="card">
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
    <Modal v-if="editing && customer" @close="editing = false">
        <template #title><h2>Edit customer</h2></template>
        <CustomerForm
            :customer="customer"
            @saved="editing = false"
            @cancel="editing = false"
        />
    </Modal>
</template>
