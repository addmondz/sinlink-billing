<?php

use App\Models\Invoice;
use App\Services\BillingFeed;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Invoice::query()->whereNotNull('number_value')->select('id')->chunkById(200, function (Collection $invoices): void {
            DB::transaction(function () use ($invoices): void {
                BillingFeed::lock();
                $currentInvoices = Invoice::query()->whereKey($invoices->modelKeys())->whereNotNull('number_value')->orderBy('id')->get();
                foreach ($currentInvoices as $invoice) {
                    $formatted = Invoice::formatNumber((int) $invoice->number_value);
                    if ($invoice->invoice_number === $formatted) {
                        continue;
                    }
                    $invoice->update(['invoice_number' => $formatted]);
                    BillingFeed::append('invoice', $invoice->id, $invoice->load(['items', 'creator', 'events', 'replacements'])->toArray());
                    if ($invoice->replacement_for) {
                        $original = Invoice::findOrFail($invoice->replacement_for)->load(['items', 'creator', 'events', 'replacements']);
                        BillingFeed::append('invoice', $original->id, $original->toArray());
                    }
                }
            }, 5);
        });
    }

    /**
     * Keep the new presentation without changing the reserved running numbers.
     */
    public function down(): void {}
};
