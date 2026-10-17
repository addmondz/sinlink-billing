<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useApp } from "../store";
import type { Vehicle } from "../lib/types";
const props = defineProps<{ vehicle?: Vehicle; customerId?: string }>();
const emit = defineEmits<{ saved: [Vehicle]; cancel: [] }>();
const app = useApp();
const form = reactive<Partial<Vehicle>>({
    ...props.vehicle,
    customer_ids: [
        ...(props.vehicle?.customer_ids ??
            (props.customerId ? [props.customerId] : [])),
    ],
});
const search = ref(""),
    error = ref(""),
    busy = ref(false);
const customers = computed(() =>
    app.customers.filter((customer) =>
        (customer.name + " " + customer.phone)
            .toLowerCase()
            .includes(search.value.toLowerCase()),
    ),
);
async function submit() {
    busy.value = true;
    error.value = "";
    try {
        emit("saved", await app.saveVehicle(form));
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <form class="form-grid" @submit.prevent="submit">
        <p v-if="error" class="error span-full" role="alert">{{ error }}</p>
        <label
            >Registration number<input
                v-model="form.registration"
                maxlength="40"
                required
                placeholder="VDR 4118"
                class="uppercase"
        /></label>
        <label
            >Car model<input
                v-model="form.car_model"
                maxlength="255"
                required
                placeholder="Perodua Myvi"
        /></label>
        <fieldset class="span-full vehicle-customers">
            <legend>Linked customers · select one or more</legend>
            <input
                v-model="search"
                type="search"
                placeholder="Find customer"
                aria-label="Find linked customers"
            />
            <div class="customer-checkboxes">
                <label
                    v-for="customer in customers"
                    :key="customer.id"
                    class="preference-switch"
                >
                    <input
                        v-model="form.customer_ids"
                        type="checkbox"
                        :value="customer.id"
                    />
                    {{ customer.name }} · {{ customer.phone }}
                </label>
            </div>
            <p v-if="!app.customers.length" class="hint">
                Create a customer first, then link them to this car.
            </p>
            <p class="hint">
                {{ form.customer_ids?.length }} selected. One car can be shared
                by multiple customers.
            </p>
        </fieldset>
        <label class="span-full"
            >Notes<textarea v-model="form.notes" maxlength="4000" rows="2" />
        </label>
        <div class="form-actions span-full">
            <button
                type="button"
                class="button secondary"
                @click="emit('cancel')"
            >
                Cancel
            </button>
            <button class="button primary" :disabled="busy">
                {{ busy ? "Saving…" : "Save car" }}
            </button>
        </div>
    </form>
</template>
