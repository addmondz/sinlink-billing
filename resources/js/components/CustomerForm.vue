<script setup lang="ts">
import { reactive, ref } from "vue";
import { useApp } from "../store";
import type { Customer } from "../lib/types";
const props = defineProps<{ customer?: Partial<Customer>; prefill?: string }>(),
    emit = defineEmits<{ saved: [Customer]; cancel: [] }>(),
    app = useApp();
const isPhone = /^[+\d\s()-]+$/.test(props.prefill ?? "");
const form = reactive<Partial<Customer>>({
    ...props.customer,
    name: props.customer?.name ?? (!isPhone ? props.prefill : ""),
    phone: props.customer?.phone ?? (isPhone ? props.prefill : ""),
});
const error = ref(""),
    busy = ref(false);
async function submit() {
    busy.value = true;
    error.value = "";
    try {
        const c = await app.saveCustomer(form);
        emit("saved", c);
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
            >Name
            <input
                v-model="form.name"
                required
                maxlength="255"
                autocomplete="name"
                autofocus /></label
        ><label
            >Phone
            <input
                v-model="form.phone"
                required
                maxlength="80"
                type="tel"
                placeholder="0162726866 or +60162726866"
                autocomplete="tel" /></label
        ><label class="span-full"
            >Address
            <textarea
                v-model="form.address"
                rows="2"
                maxlength="4000"
                autocomplete="street-address"
            /></label
        ><label
            >Email
            <input
                v-model="form.email"
                type="email"
                autocomplete="email" /></label
        ><label>Notes <input v-model="form.notes" maxlength="4000" /></label>
        <div class="form-actions span-full">
            <button
                type="button"
                class="button secondary"
                @click="emit('cancel')"
            >
                Cancel</button
            ><button class="button primary" :disabled="busy">
                {{ busy ? "Saving…" : "Save customer" }}
            </button>
        </div>
    </form>
</template>
