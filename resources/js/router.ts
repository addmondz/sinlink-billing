import { createRouter, createWebHistory } from "vue-router";
import { useApp } from "./store";
import Invoices from "./views/Invoices.vue";
import Editor from "./views/Editor.vue";
import Details from "./views/Details.vue";
import Customers from "./views/Customers.vue";
import CustomerDetails from "./views/CustomerDetails.vue";
import Vehicles from "./views/Vehicles.vue";
import Staff from "./views/Staff.vue";
import Settings from "./views/Settings.vue";
import Sync from "./views/Sync.vue";
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: "/", component: Invoices },
        {
            path: "/invoices/new",
            component: Editor,
            meta: { invoiceEditor: true },
        },
        {
            path: "/invoices/:id/edit",
            component: Editor,
            meta: { invoiceEditor: true },
        },
        { path: "/invoices/:id", component: Details },
        { path: "/customers", component: Customers },
        { path: "/customers/:id", component: CustomerDetails },
        { path: "/cars", component: Vehicles },
        { path: "/staff", component: Staff, meta: { requiresAdmin: true } },
        {
            path: "/settings",
            component: Settings,
            meta: { requiresAdmin: true },
        },
        { path: "/sync", component: Sync },
    ],
});
router.beforeEach((to) => {
    const app = useApp();
    if (to.meta.requiresAdmin && app.user && app.user.role !== "admin") {
        return "/";
    }
});
