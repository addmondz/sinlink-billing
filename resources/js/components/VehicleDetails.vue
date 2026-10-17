<script setup lang="ts">
import { computed } from "vue";
import { PenLine } from "@lucide/vue";
import { useApp } from "../store";
import type { Vehicle } from "../lib/types";
import Modal from "./Modal.vue";
const props = defineProps<{ vehicle: Vehicle }>();
const emit = defineEmits<{ close: []; edit: [vehicle: Vehicle] }>();
const app = useApp();
const customers = computed(() =>
    app.customers.filter((customer) =>
        props.vehicle.customer_ids.includes(customer.id),
    ),
);
</script>
<template>
    <Modal @close="emit('close')">
        <template #title
            ><h2>{{ vehicle.registration }}</h2></template
        >
        <dl class="customer-details">
            <div>
                <dt>Registration number</dt>
                <dd>{{ vehicle.registration }}</dd>
            </div>
            <div>
                <dt>Car model</dt>
                <dd>{{ vehicle.car_model }}</dd>
            </div>
            <div class="span-full">
                <dt>Linked customers</dt>
                <dd v-for="customer in customers" :key="customer.id">
                    <RouterLink :to="'/customers/' + customer.id">{{
                        customer.name
                    }}</RouterLink>
                    · {{ customer.phone }}
                </dd>
                <dd v-if="!customers.length">
                    No linked customers on this device
                </dd>
            </div>
            <div class="span-full">
                <dt>Notes</dt>
                <dd class="preserve">{{ vehicle.notes || "—" }}</dd>
            </div>
        </dl>
        <div class="form-actions">
            <button class="button secondary" @click="emit('close')">
                Close
            </button>
            <button class="button primary" @click="emit('edit', vehicle)">
                <PenLine :size="18" />Edit car
            </button>
        </div>
    </Modal>
</template>
