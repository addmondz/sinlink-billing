<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class InvoiceNumberMigrationTest extends TestCase
{
    use DatabaseMigrations;

    private const MIGRATION = '2026_10_17_103151_format_existing_invoice_numbers';

    private function migrateInvoiceNumbers(): void
    {
        DB::table('migrations')->where('migration', self::MIGRATION)->delete();
        $this->artisan('migrate', ['--path' => 'database/migrations/'.self::MIGRATION.'.php', '--force' => true])->assertSuccessful();
    }

    public function test_existing_numbers_are_formatted_and_published_without_changing_the_running_sequence_or_invoice_content(): void
    {
        $this->seed(DatabaseSeeder::class);
        $user = User::factory()->create();
        DB::table('billing_counters')->where('id', 1)->update(['next_number' => 200001]);
        $invoices = [];
        foreach ([1 => '00001', 1234 => '01234', 99999 => '99999', 100000 => '100000'] as $number => $formatted) {
            $invoice = Invoice::factory()->create(['status' => $number === 1234 ? 'cancelled' : 'issued', 'invoice_number' => 'SL-'.str_pad((string) $number, 8, '0', STR_PAD_LEFT), 'number_value' => $number, 'version' => 4]);
            $invoices[] = [$invoice, $formatted, $invoice->fresh()->getAttributes()];
        }

        $this->migrateInvoiceNumbers();

        foreach ($invoices as [$invoice, $formatted, $original]) {
            $current = $invoice->fresh()->getAttributes();
            $this->assertSame($formatted, $current['invoice_number']);
            unset($current['invoice_number'], $current['updated_at'], $original['invoice_number'], $original['updated_at']);
            $this->assertSame($original, $current);
            $this->actingAs($user)->getJson('/api/invoices?q='.$formatted)->assertOk()->assertJsonPath('data.0.id', (string) $invoice->id);
            $change = DB::table('change_log')->where('entity_id', $invoice->id)->latest('sequence')->first();
            $data = json_decode($change->data, true);
            $this->assertSame($formatted, $data['invoice_number']);
            $this->assertSame(4, $data['version']);
            $this->assertSame($invoice->customer_snapshot, $data['customer_snapshot']);
            $this->assertArrayHasKey('items', $data);
        }
        $this->assertSame(200001, DB::table('billing_counters')->where('id', 1)->value('next_number'));
        $this->assertDatabaseCount('change_log', 5);
    }

    public function test_drafts_and_formatted_numbers_are_unchanged_and_rerunning_the_migration_does_not_repeat_changes(): void
    {
        $this->seed(DatabaseSeeder::class);
        $draft = Invoice::factory()->create();
        $formatted = Invoice::factory()->create(['status' => 'issued', 'invoice_number' => '00042', 'number_value' => 42]);
        $legacy = Invoice::factory()->create(['status' => 'issued', 'invoice_number' => 'SL-00000001', 'number_value' => 1]);
        $draftBefore = $draft->fresh()->getAttributes();
        $formattedBefore = $formatted->fresh()->getAttributes();

        $this->migrateInvoiceNumbers();
        $migration = require database_path('migrations/'.self::MIGRATION.'.php');
        $migration->up();

        $this->assertSame($draftBefore, $draft->fresh()->getAttributes());
        $this->assertSame($formattedBefore, $formatted->fresh()->getAttributes());
        $this->assertSame('00001', $legacy->fresh()->invoice_number);
        $this->assertDatabaseCount('change_log', 2);
    }
}
