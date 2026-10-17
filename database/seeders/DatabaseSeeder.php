<?php

namespace Database\Seeders;

use App\Services\BillingFeed;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function () {
            DB::table('billing_counters')->insertOrIgnore(['id' => 1, 'next_number' => 1, 'change_sequence' => 0]);
            BillingFeed::lock();
            if (! DB::table('company_settings')->where('id', 1)->exists()) {
                DB::table('company_settings')->insert(['id' => 1, 'business_id' => Str::uuid(), 'version' => 1, 'data' => json_encode(['company_name' => 'Sinlink Auto Accessories', 'registration_number' => '', 'address' => '', 'phone' => '', 'logo' => '', 'paper_size' => 'A4', 'margin_mm' => 12, 'footer_terms' => '', 'signature_left' => 'Authorized signature', 'signature_right' => 'Customer signature']), 'created_at' => now(), 'updated_at' => now()]);
                BillingFeed::append('company', '1', BillingFeed::settings());
            }
        });

        $this->call(AdminUserSeeder::class);
    }
}
