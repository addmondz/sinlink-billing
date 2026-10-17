<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CustomerPhoneMigrationTest extends TestCase
{
    use DatabaseMigrations;

    private const MIGRATION = '2026_10_17_100525_format_existing_customer_phone_numbers';

    private function migrateLegacyPhones(): void
    {
        DB::table('migrations')->where('migration', self::MIGRATION)->delete();
        $this->artisan('migrate', ['--path' => 'database/migrations/'.self::MIGRATION.'.php', '--force' => true])->assertSuccessful();
    }

    public function test_migration_formats_existing_numbers_and_publishes_them_for_devices(): void
    {
        $this->seed(DatabaseSeeder::class);
        $user = User::factory()->create();
        $customers = [];
        foreach (['162726866', '60162726866', '0162726866'] as $phone) {
            $customers[] = Customer::factory()->create(['phone' => $phone, 'normalized_phone' => $phone, 'created_by' => $user->id, 'version' => 4]);
        }

        $this->migrateLegacyPhones();

        foreach ($customers as $customer) {
            $this->assertDatabaseHas('customers', ['id' => $customer->id, 'name' => $customer->name, 'phone' => '+60162726866', 'normalized_phone' => '60162726866', 'created_by' => $user->id, 'version' => 5]);
        }
        $this->assertDatabaseCount('customers', 3);
        $this->assertDatabaseCount('change_log', 4);
        $this->actingAs($user)->getJson('/api/sync/pull?cursor=1')->assertOk()->assertJsonCount(3, 'changes')
            ->assertJsonPath('changes.0.data.phone', '+60162726866')
            ->assertJsonPath('changes.1.data.phone', '+60162726866')
            ->assertJsonPath('changes.2.data.phone', '+60162726866')
            ->assertJsonPath('changes.2.data.version', 5);
    }

    public function test_migration_keeps_invalid_numbers_and_already_formatted_customers_unchanged(): void
    {
        $this->seed(DatabaseSeeder::class);
        $user = User::factory()->create();
        $customers = [];
        foreach (['0123', 'not a phone', '', '+60162726866'] as $phone) {
            $customer = Customer::factory()->create(['phone' => $phone, 'normalized_phone' => $phone === '+60162726866' ? '60162726866' : '', 'created_by' => $user->id]);
            $customers[] = [$customer, $customer->refresh()->getAttributes()];
        }

        $this->migrateLegacyPhones();

        foreach ($customers as [$customer, $original]) {
            $this->assertSame($original, $customer->fresh()->getAttributes());
        }
        $this->assertDatabaseCount('change_log', 1);
    }

    public function test_migration_repairs_stale_search_digits_and_preserves_historical_invoice_details(): void
    {
        $this->seed(DatabaseSeeder::class);
        $invoice = Invoice::factory()->create(['status' => 'issued', 'customer_snapshot' => ['name' => 'Historical customer', 'phone' => '0162726866'], 'customer_phone' => '0162726866', 'customer_phone_normalized' => '60162726866']);
        $originalInvoice = $invoice->refresh()->getAttributes();
        $customer = Customer::findOrFail($invoice->customer_id);
        $customer->update(['phone' => '+60162726866', 'normalized_phone' => '162726866']);

        $this->migrateLegacyPhones();

        $this->assertDatabaseHas('customers', ['id' => $customer->id, 'phone' => '+60162726866', 'normalized_phone' => '60162726866', 'version' => 2]);
        $this->assertSame($originalInvoice, $invoice->fresh()->getAttributes());
    }

    public function test_rerunning_migrations_does_not_repeat_phone_changes_or_sync_events(): void
    {
        $this->seed(DatabaseSeeder::class);
        $customer = Customer::factory()->create(['phone' => '162726866', 'normalized_phone' => '162726866']);
        $this->migrateLegacyPhones();

        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        $migration = require database_path('migrations/'.self::MIGRATION.'.php');
        $migration->up();

        $this->assertDatabaseHas('customers', ['id' => $customer->id, 'phone' => '+60162726866', 'normalized_phone' => '60162726866', 'version' => 2]);
        $this->assertDatabaseCount('change_log', 2);
    }
}
