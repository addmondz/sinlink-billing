<?php

use App\Models\Customer;
use App\Services\BillingFeed;
use App\Services\SyncService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Customer::query()->select('id')->chunkById(200, function (Collection $customers): void {
            DB::transaction(function () use ($customers): void {
                BillingFeed::lock();
                $currentCustomers = Customer::query()->whereKey($customers->modelKeys())->orderBy('id')->get();
                foreach ($currentCustomers as $customer) {
                    $phone = SyncService::formatPhone($customer->phone);
                    if ($phone === null) {
                        continue;
                    }
                    $normalizedPhone = SyncService::normalizePhone($phone);
                    if ($customer->phone === $phone && $customer->normalized_phone === $normalizedPhone) {
                        continue;
                    }
                    $customer->update(['phone' => $phone, 'normalized_phone' => $normalizedPhone, 'version' => $customer->version + 1]);
                    BillingFeed::append('customer', $customer->id, $customer->toArray());
                }
            }, 5);
        });
    }

    /**
     * Preserve normalized numbers because the original formatting is unavailable.
     */
    public function down(): void {}
};
