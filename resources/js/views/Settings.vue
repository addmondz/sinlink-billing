<script setup lang="ts">
import { ref } from "vue";
import { Save, LogOut, LockKeyhole } from "@lucide/vue";
import { useApp } from "../store";
import { send } from "../lib/api";
import type { Company } from "../lib/types";
const app = useApp(),
    form = ref<Company>(JSON.parse(JSON.stringify(app.company))),
    error = ref(""),
    message = ref(""),
    busy = ref(false);
async function save() {
    busy.value = true;
    error.value = "";
    try {
        const result = await send<Company>("/settings", form.value, "PUT");
        app.company = result;
        form.value = JSON.parse(JSON.stringify(result));
        await app.sync();
        message.value =
            "Company and print settings saved. Issued invoices keep their original snapshot.";
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        busy.value = false;
    }
}
async function logo(e: Event) {
    error.value = "";
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpeg"].includes(f.type) || f.size > 200000) {
        error.value = "Choose a PNG or JPEG smaller than 200 KB.";
        return;
    }
    const reader = new FileReader();
    reader.onload = () => (form.value.logo = String(reader.result));
    reader.readAsDataURL(f);
}
async function lock() {
    await app.flushDraft();
    await app.lock();
}
async function toggleSimpleMode(event: Event) {
    error.value = "";
    try {
        await app.setSimpleMode((event.target as HTMLInputElement).checked);
    } catch (e) {
        error.value = (e as Error).message;
    }
}
</script>
<template>
    <div class="page-heading">
        <div>
            <span class="eyebrow">MAKE IT YOURS</span>
            <h1>Settings</h1>
            <p class="muted">Your company, your documents, your device.</p>
        </div>
        <RouterLink
            v-if="app.user?.role === 'admin'"
            to="/staff"
            class="button secondary mobile-only"
            >Manage staff</RouterLink
        >
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="success" role="status">{{ message }}</p>
    <div class="settings-layout">
        <form class="stack" @submit.prevent="save">
            <section class="card">
                <div class="section-title">
                    <h2>Your display preferences</h2>
                </div>
                <label class="preference-switch">
                    <input
                        type="checkbox"
                        :checked="!!app.user?.simple_mode"
                        @change="toggleSimpleMode"
                    />
                    Simple mode
                </label>
                <p class="hint">
                    Larger text and buttons, mobile number search, and invoice
                    creation on one page. Saved for your account; change it here
                    at any time.
                </p>
                <RouterLink to="/cars" class="text-button"
                    >Manage cars and linked customers →</RouterLink
                >
            </section>
            <fieldset
                :disabled="
                    app.user?.role !== 'admin' || !app.online || app.needsAuth
                "
            >
                <section class="card">
                    <div class="section-title"><h2>Company details</h2></div>
                    <p class="hint">
                        Invoices use the supplied Sinlink cash sales layout.
                        These details are saved with each invoice.
                    </p>
                    <div class="form-grid">
                        <label class="span-full"
                            >Company name<input
                                v-model="form.company_name"
                                required
                                maxlength="255" /></label
                        ><label
                            >Registration number<input
                                v-model="form.registration_number"
                                maxlength="100" /></label
                        ><label
                            >Phone<input
                                v-model="form.phone"
                                type="tel"
                                maxlength="80" /></label
                        ><label class="span-full"
                            >Address<textarea
                                v-model="form.address"
                                rows="3"
                                maxlength="2000"
                            /></label
                        ><label class="span-full"
                            >Bank details<input
                                v-model="form.bank_details"
                                maxlength="255" /></label
                        ><label class="span-full"
                            >Company logo · PNG or JPEG, up to 200 KB<input
                                type="file"
                                accept="image/png,image/jpeg"
                                @change="logo"
                        /></label>
                        <div v-if="form.logo" class="logo-preview">
                            <img :src="form.logo" alt="Logo preview" /><button
                                type="button"
                                class="text-button"
                                @click="form.logo = ''"
                            >
                                Remove logo
                            </button>
                        </div>
                    </div>
                </section>
                <section class="card">
                    <div class="section-title"><h2>Print layout</h2></div>
                    <div class="form-grid">
                        <label
                            >Paper size<select v-model="form.paper_size">
                                <option>A4</option>
                                <option>A5</option>
                            </select></label
                        ><label
                            >Margins (mm)<input
                                v-model.number="form.margin_mm"
                                type="number"
                                min="5"
                                max="25"
                                required /></label
                        ><label class="span-full"
                            >Footer terms<textarea
                                v-model="form.footer_terms"
                                rows="3"
                                maxlength="2000"
                            /></label
                        ><label
                            >Left signature label<input
                                v-model="form.signature_left"
                                maxlength="100" /></label
                        ><label
                            >Right signature label<input
                                v-model="form.signature_right"
                                maxlength="100"
                        /></label>
                    </div>
                </section>
                <button class="button primary" :disabled="busy">
                    <Save :size="17" />{{ busy ? "Saving…" : "Save settings" }}
                </button>
            </fieldset>
            <p
                v-if="
                    app.user?.role !== 'admin' || !app.online || app.needsAuth
                "
                class="hint"
            >
                Changing company settings requires an administrator and an
                online session.
            </p>
        </form>
        <div class="stack">
            <section class="card">
                <h2>This device</h2>
                <p class="small muted">{{ app.vault?.profile.device_id }}</p>
                <p>{{ app.remaining }} reserved numbers remaining</p>
                <RouterLink to="/sync" class="text-button"
                    >Sync, backup & recovery →</RouterLink
                ><button class="button secondary full" @click="lock">
                    <LockKeyhole :size="17" />Lock device
                </button>
            </section>
            <section class="card prose">
                <h2>Offline access</h2>
                <p>
                    Your encrypted local data opens with your account password.
                    Access lasts 7 days from the last online account
                    verification.
                </p>
                <p>
                    Offline access does not authenticate server requests. An
                    expired or revoked server session pauses synchronization and
                    preserves queued work.
                </p>
                <p>
                    A disconnected device cannot receive an immediate account
                    revocation. Use trusted devices and lock them when
                    unattended.
                </p>
            </section>
            <section class="card prose">
                <h2>Install the app</h2>
                <p>
                    <b>iPhone / iPad:</b> Open in Safari → Share → Add to Home
                    Screen.
                </p>
                <p>
                    <b>Android / desktop:</b> Browser menu → Install app or Add
                    to Home screen.
                </p>
                <p>
                    Open and sync online once. Offline use then includes drafts,
                    reserved-number issuance, cancellation, print preview, and
                    PDF.
                </p>
            </section>
            <section class="card prose">
                <h2>Keep your work safe</h2>
                <p>
                    Browser storage can be cleared or evicted. Persistent
                    storage is requested where supported, but it is not a backup
                    guarantee. Export unsynced work before resetting a device.
                </p>
                <p>
                    Reserved numbers may leave gaps. Numbers across devices are
                    not guaranteed to follow date order.
                </p>
            </section>
        </div>
    </div>
</template>
