<?php

namespace Database\Factories;

use App\Models\Customer;
use App\Models\User;
use App\Services\BillingFeed;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class InvoiceFactory extends Factory
{
    public function definition(): array
    {
        $user = User::factory()->create();
        $device = (string) Str::uuid();
        $customer = Customer::factory()->create(['created_by' => $user->id]);
        DB::table('devices')->insert(['id' => $device, 'user_id' => $user->id, 'name' => 'Factory device', 'created_at' => now(), 'updated_at' => now()]);

        return ['id' => Str::uuid(), 'status' => 'draft', 'invoice_date' => today(), 'customer_id' => $customer->id, 'customer_snapshot' => ['name' => $customer->name, 'phone' => $customer->phone], 'company_snapshot' => BillingFeed::settings(), 'customer_name' => $customer->name, 'customer_phone' => $customer->phone, 'customer_phone_normalized' => $customer->normalized_phone, 'total_cents' => 1000, 'subtotal_cents' => 1000, 'total_quantity' => '1.000', 'created_by' => $user->id, 'device_id' => $device];
    }
}
