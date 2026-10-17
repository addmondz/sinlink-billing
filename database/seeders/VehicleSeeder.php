<?php

namespace Database\Seeders;

use App\Models\Invoice;
use App\Models\Vehicle;
use App\Services\BillingFeed;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class VehicleSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        DB::transaction(function (): void {
            BillingFeed::lock();
            foreach (Invoice::whereNotNull('vehicle_registration')->where('vehicle_registration', '!=', '')->orderBy('created_at')->get() as $invoice) {
                $registration = Vehicle::normalizeRegistration($invoice->vehicle_registration);
                if ($registration === '') {
                    continue;
                }
                $vehicle = Vehicle::firstOrNew(['normalized_registration' => $registration]);
                $changed = ! $vehicle->exists;
                if ($changed) {
                    $vehicle->fill(['id' => (string) Str::uuid(), 'registration' => strtoupper(trim($invoice->vehicle_registration)), 'car_model' => $invoice->car_model ?: 'Unspecified', 'created_by' => $invoice->created_by, 'version' => 1])->save();
                }
                $links = $vehicle->customers()->syncWithoutDetaching([$invoice->customer_id]);
                if (! $changed && $links['attached'] !== []) {
                    $vehicle->update(['version' => $vehicle->version + 1]);
                }
                if ($changed || $links['attached'] !== []) {
                    BillingFeed::append('vehicle', $vehicle->id, $vehicle->load('customers')->toArray());
                }
            }
        }, 5);
    }
}
