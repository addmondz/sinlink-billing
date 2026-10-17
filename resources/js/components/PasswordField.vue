<script setup lang="ts">
import { ref, useId } from "vue";
import { Eye, EyeOff } from "@lucide/vue";
defineOptions({ inheritAttrs: false });
defineProps<{ label: string }>();
const value = defineModel<string>({ default: "" });
const visible = ref(false),
    id = useId();
</script>
<template>
    <div class="password-field">
        <label :for="id">{{ label }}</label>
        <div class="password-control">
            <input
                v-bind="$attrs"
                :id="id"
                v-model="value"
                :type="visible ? 'text' : 'password'"
            />
            <button
                type="button"
                class="password-toggle"
                :aria-label="visible ? 'Hide password' : 'Show password'"
                :aria-pressed="visible"
                :aria-controls="id"
                @click="visible = !visible"
            >
                <EyeOff v-if="visible" :size="20" /><Eye v-else :size="20" />
            </button>
        </div>
    </div>
</template>
