<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Plus, PenLine, Users } from "@lucide/vue";
import { useApp } from "../store";
import { api, send } from "../lib/api";
import type { User } from "../lib/types";
import Modal from "../components/Modal.vue";
import ListingPanel from "../components/ListingPanel.vue";
import { usePagination } from "../lib/pagination";
const app = useApp(),
    staff = ref<User[]>([]),
    search = ref(""),
    viewing = ref<User>(),
    form = ref(false),
    editing = ref<Partial<User> & { password?: string }>({}),
    error = ref(""),
    busy = ref(false);
const list = computed(() => {
    const query = search.value.trim().toLowerCase();
    return staff.value.filter((user) =>
        (user.name + " " + user.email).toLowerCase().includes(query),
    );
});
const { page, pageSize, pageCount, pagedRecords, resetPage } =
    usePagination(list);
watch(search, resetPage);
async function load() {
    try {
        staff.value = await api("/staff");
    } catch (e) {
        error.value = (e as Error).message;
    }
}
function edit(user?: User) {
    viewing.value = undefined;
    editing.value = user
        ? { ...user, password: "" }
        : {
              name: "",
              email: "",
              role: "staff",
              active: true,
              simple_mode: false,
              password: "",
          };
    form.value = true;
    error.value = "";
}
async function save() {
    busy.value = true;
    error.value = "";
    try {
        const u = editing.value;
        const savedUser = await send<User>(
            "/staff" + (u.id ? "/" + u.id : ""),
            u,
            u.id ? "PUT" : "POST",
        );
        if (savedUser.id === app.user?.id) {
            app.user = savedUser;
            await app.setSimpleMode(!!savedUser.simple_mode);
        }
        form.value = false;
        await load();
        if (!list.value.some((user) => user.id === savedUser.id)) {
            search.value = "";
            await nextTick();
        }
        const savedIndex = list.value.findIndex(
            (user) => user.id === savedUser.id,
        );
        if (savedIndex >= 0)
            page.value = Math.floor(savedIndex / pageSize.value) + 1;
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
onMounted(() => {
    if (app.user?.role === "admin") void load();
});
</script>
<template>
    <div class="page-heading">
        <div>
            <span class="eyebrow">THE SHOP TEAM</span>
            <h1>Staff</h1>
            <p class="muted">Give your team the access they need.</p>
        </div>
        <button
            v-if="app.user?.role === 'admin'"
            class="button primary"
            :disabled="!app.online || app.needsAuth"
            @click="edit()"
        >
            <Plus :size="18" />Add staff
        </button>
    </div>
    <p v-if="app.user?.role !== 'admin'" class="error">
        Administrator access required.
    </p>
    <p v-else-if="!app.online || app.needsAuth" class="banner">
        Staff accounts and password resets require an authenticated online
        session.
    </p>
    <template v-else>
        <p v-if="error && !form" class="error" role="alert">{{ error }}</p>
        <ListingPanel
            v-model:search="search"
            v-model:page="page"
            v-model:page-size="pageSize"
            :records="pagedRecords"
            :total="list.length"
            :page-count="pageCount"
            :record-label="(user) => user.name"
            label="Staff"
            search-placeholder="Search by name or email"
            empty-title="No staff accounts yet"
            empty-message="Add a staff account to give your team access."
            @view="viewing = $event"
        >
            <template #empty-icon><Users :size="32" /></template>
            <template #default="{ record: u }">
                <span class="avatar subtle">{{ u.name.slice(0, 1) }}</span>
                <div class="customer-info">
                    <h3>
                        {{ u.name }}
                        <span
                            :class="[
                                'status',
                                u.active ? 'issued' : 'cancelled',
                            ]"
                            >{{ u.active ? "Active" : "Inactive" }}</span
                        >
                    </h3>
                    <p>{{ u.email }}</p>
                    <small
                        >{{ u.role === "admin" ? "Administrator" : "Staff" }} ·
                        All invoices visible</small
                    >
                </div>
            </template>
            <template #actions="{ record: u }">
                <button
                    class="icon-button"
                    :aria-label="'Edit ' + u.name"
                    @click="edit(u)"
                >
                    <PenLine :size="18" />
                </button>
            </template>
        </ListingPanel>
    </template>
    <Modal v-if="viewing" @close="viewing = undefined">
        <template #title><h2>{{ viewing.name }}</h2></template>
        <dl class="customer-details">
            <div>
                <dt>Email</dt>
                <dd>{{ viewing.email }}</dd>
            </div>
            <div>
                <dt>Role</dt>
                <dd>
                    {{ viewing.role === "admin" ? "Administrator" : "Staff" }}
                </dd>
            </div>
            <div>
                <dt>Account status</dt>
                <dd>{{ viewing.active ? "Active" : "Inactive" }}</dd>
            </div>
            <div>
                <dt>Simple mode</dt>
                <dd>{{ viewing.simple_mode ? "On" : "Off" }}</dd>
            </div>
            <div class="span-full">
                <dt>Invoice access</dt>
                <dd>All invoices visible</dd>
            </div>
        </dl>
        <div class="form-actions">
            <button class="button secondary" @click="viewing = undefined">
                Close
            </button>
            <button class="button primary" @click="edit(viewing)">
                <PenLine :size="18" />Edit staff
            </button>
        </div>
    </Modal>
    <Modal v-if="form" @close="form = false"
        ><template #title
            ><h2>{{ editing.id ? "Edit staff" : "Add staff" }}</h2></template
        >
        <form @submit.prevent="save" class="form-grid">
            <p v-if="error" class="error span-full" role="alert">{{ error }}</p>
            <label
                >Name<input
                    v-model="editing.name"
                    required
                    maxlength="255"
                    autocomplete="name" /></label
            ><label
                >Email<input
                    v-model="editing.email"
                    type="email"
                    required
                    autocomplete="email" /></label
            ><label
                >Role<select v-model="editing.role">
                    <option value="staff">Staff</option>
                    <option value="admin">Administrator</option>
                </select></label
            ><label
                >Account status<select v-model="editing.active">
                    <option :value="true">Active</option>
                    <option :value="false">Inactive</option>
                </select></label
            ><label class="span-full"
                >{{
                    editing.id
                        ? "Reset password · leave blank to keep existing"
                        : "Password"
                }}<input
                    v-model="editing.password"
                    type="password"
                    :required="!editing.id"
                    minlength="12"
                    maxlength="128"
                    autocomplete="new-password"
                /><span class="hint"
                    >At least 12 characters. Password resets end existing online
                    sessions.</span
                ></label
            >
            <label class="preference-switch span-full"
                ><input type="checkbox" v-model="editing.simple_mode" />Simple
                mode · larger text and single-page invoices</label
            >
            <p v-if="!editing.active" class="hint span-full">
                Server access will be rejected. A disconnected device can retain
                previously authorized data until its offline access expires;
                rejected work remains available for review.
            </p>
            <div class="form-actions span-full">
                <button
                    type="button"
                    class="button secondary"
                    @click="form = false"
                >
                    Cancel</button
                ><button class="button primary" :disabled="busy">
                    {{ busy ? "Saving…" : "Save staff" }}
                </button>
            </div>
        </form></Modal
    >
</template>
