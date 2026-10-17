<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\User;
use App\Services\BillingFeed;
use App\Services\Money;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\TestWith;
use Tests\TestCase;

class BillingTest extends TestCase
{
    use DatabaseMigrations;

    private User $admin;

    private string $device;

    private array $allocation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($this->admin);
        $this->device = (string) Str::uuid();
        $this->postJson('/api/devices', ['id' => $this->device, 'name' => 'Test terminal'])->assertOk();
        $this->allocation = $this->postJson('/api/number-allocations', ['id' => (string) Str::uuid(), 'device_id' => $this->device])->assertOk()->json();
    }

    private function op(string $type, array $payload, int $version = 0, ?string $id = null): array
    {
        return ['id' => (string) Str::uuid(), 'device_id' => $this->device, 'actor_id' => auth()->id(), 'entity_id' => $id ?? (string) Str::uuid(), 'type' => $type, 'payload' => $payload, 'expected_version' => $version, 'action_at' => now()->toISOString()];
    }

    private function push(array $op): array
    {
        return $this->postJson('/api/sync/push', ['operations' => [$op]])->assertOk()->json('results.0');
    }

    private function customer(): Customer
    {
        $op = $this->op('customer.save', ['name' => 'Aisha Tan', 'phone' => '012-345 6789', 'address' => 'Original address']);
        $this->assertTrue($this->push($op)['ok']);

        return Customer::findOrFail($op['entity_id']);
    }

    private function payload(?Customer $c = null, int $offset = 0): array
    {
        $c ??= $this->customer();
        $items = [['id' => (string) Str::uuid(), 'description' => 'Window film and installation', 'quantity' => '1.005', 'unit' => 'PCS', 'unit_price' => '1.00', 'amount_cents' => 101]];

        return ['invoice_date' => '2026-10-17', 'customer_id' => $c->id, 'customer_snapshot' => ['name' => $c->name, 'phone' => $c->phone, 'address' => $c->address, 'email' => ''], 'company_snapshot' => BillingFeed::settings(), 'items' => $items, 'total_cents' => 101, 'subtotal_cents' => 101, 'total_quantity' => '1.005', 'allocation_id' => $this->allocation['id'], 'number_value' => $this->allocation['start'] + $offset, 'invoice_number' => str_pad((string) ($this->allocation['start'] + $offset), 5, '0', STR_PAD_LEFT)];
    }

    private function issued(): Invoice
    {
        $op = $this->op('invoice.issue', $this->payload());
        $this->assertTrue($this->push($op)['ok']);

        return Invoice::findOrFail($op['entity_id']);
    }

    public function test_login_permissions_and_staff_management(): void
    {
        auth('web')->logout();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/invoices')->assertUnauthorized();
        $pass = Str::password(20);
        $this->admin->update(['password' => $pass]);
        $this->postJson('/api/login', ['email' => $this->admin->email, 'password' => 'bad'])->assertUnprocessable();
        $this->postJson('/api/login', ['email' => $this->admin->email, 'password' => $pass])->assertOk();
        $staff = $this->postJson('/api/staff', ['name' => 'Cashier', 'email' => 'cashier@example.test', 'password' => $pass, 'role' => 'staff', 'active' => true])->assertSuccessful()->json();
        $this->putJson('/api/staff/'.$staff['id'], ['name' => 'Cashier 2', 'email' => 'cashier@example.test', 'password' => Str::password(24), 'role' => 'staff', 'active' => false])->assertOk();
        $this->actingAs(User::find($staff['id']));
        $this->getJson('/api/invoices')->assertForbidden();
        User::find($staff['id'])->update(['active' => true]);
        $this->actingAs(User::find($staff['id']));
        $this->getJson('/api/staff')->assertForbidden();
        $this->postJson('/api/staff', [])->assertForbidden();
    }

    public function test_invoice_pagination_defaults_to_five_results(): void
    {
        Invoice::factory()->count(6)->create();

        $this->getJson('/api/invoices')
            ->assertOk()
            ->assertJsonPath('per_page', 5)
            ->assertJsonPath('last_page', 2)
            ->assertJsonCount(5, 'data');
    }

    #[TestWith([5])]
    #[TestWith([10])]
    #[TestWith([20])]
    #[TestWith([50])]
    #[TestWith([100])]
    public function test_invoice_pagination_uses_the_requested_page_size(int $pageSize): void
    {
        Invoice::factory()->count($pageSize + 1)->create();

        $firstPage = $this->getJson('/api/invoices?per_page='.$pageSize)
            ->assertOk()
            ->assertJsonPath('per_page', $pageSize)
            ->assertJsonPath('last_page', 2)
            ->assertJsonCount($pageSize, 'data');
        $lastPage = $this->getJson('/api/invoices?per_page='.$pageSize.'&page=2')
            ->assertOk()
            ->assertJsonPath('current_page', 2)
            ->assertJsonCount(1, 'data');

        $this->assertNotContains($lastPage->json('data.0.id'), array_column($firstPage->json('data'), 'id'));
    }

    #[TestWith([0])]
    #[TestWith([25])]
    #[TestWith([101])]
    #[TestWith(['invalid'])]
    public function test_invoice_pagination_rejects_unsupported_page_sizes(int|string $pageSize): void
    {
        $this->getJson('/api/invoices?per_page='.$pageSize)->assertUnprocessable()->assertJsonValidationErrors('per_page');
    }

    public function test_customer_search_normalization_duplicates_and_no_name_merge(): void
    {
        $a = $this->customer();
        $op = $this->op('customer.save', ['name' => 'Different person', 'phone' => '+60 12 345 6789']);
        $r = $this->push($op);
        $this->assertCount(1, $r['possible_duplicates']);
        $this->assertSame('60123456789', $a->normalized_phone);
        $this->getJson('/api/customers/'.$a->id)->assertOk()->assertJsonPath('name', 'Aisha Tan');
        $this->getJson('/api/customers?q=Aisha')->assertJsonCount(1, 'data');
        $this->getJson('/api/customers?q=60123456789')->assertJsonCount(2, 'data');
        $this->assertTrue($this->push($this->op('customer.save', ['name' => $a->name, 'phone' => '+44 7777 123456']))['ok']);
        $this->assertSame(3, Customer::count());
    }

    #[TestWith(['0162726866'])]
    #[TestWith(['162726866'])]
    #[TestWith(['60162726866'])]
    #[TestWith(['+60 16-272 6866'])]
    public function test_invoice_search_matches_formatted_phone_queries_against_historical_numbers(string $query): void
    {
        $invoice = $this->issued();
        $invoice->update(['customer_phone' => '016-272 6866', 'customer_phone_normalized' => null]);

        $this->getJson('/api/invoices?q='.urlencode($query))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $invoice->id);
    }

    public function test_customer_creation_and_edits_store_international_phone_numbers(): void
    {
        $op = $this->op('customer.save', ['name' => 'Customer with local number', 'phone' => '162726866']);

        $result = $this->push($op);

        $this->assertTrue($result['ok']);
        $this->assertSame('+60162726866', $result['entity']['phone']);
        $this->assertDatabaseHas('customers', ['id' => $op['entity_id'], 'phone' => '+60162726866', 'normalized_phone' => '60162726866']);
        $this->getJson('/api/customers?q=0162726866')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.phone', '+60162726866');

        $result = $this->push($this->op('customer.save', ['name' => 'Edited customer', 'phone' => '60162726866'], 1, $op['entity_id']));

        $this->assertTrue($result['ok']);
        $this->assertDatabaseHas('customers', ['id' => $op['entity_id'], 'phone' => '+60162726866', 'version' => 2]);
        $this->getJson('/api/sync/pull')->assertOk()->assertJsonPath('changes.1.data.phone', '+60162726866');
    }

    public function test_customer_creation_returns_422_for_an_invalid_phone_number(): void
    {
        $op = $this->op('customer.save', ['name' => 'Invalid phone', 'phone' => '0123']);

        $result = $this->push($op);

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
        $this->assertSame(['Enter a valid phone number, for example 0162726866 or +60162726866.'], $result['errors']['phone']);
        $this->assertDatabaseMissing('customers', ['id' => $op['entity_id']]);
        $this->assertDatabaseMissing('change_log', ['entity_id' => $op['entity_id']]);
        $this->assertDatabaseMissing('sync_operations', ['id' => $op['id']]);
    }

    public function test_invalid_phone_edits_preserve_the_existing_customer(): void
    {
        $customer = $this->customer();

        $result = $this->push($this->op('customer.save', ['name' => 'Invalid edit', 'phone' => 'not a phone'], 1, $customer->id));

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
        $this->assertDatabaseHas('customers', ['id' => $customer->id, 'name' => 'Aisha Tan', 'phone' => '+60123456789', 'version' => 1]);
    }

    public function test_rounding_and_server_financial_reconciliation(): void
    {
        $calc = Money::calculate([['id' => (string) Str::uuid(), 'description' => 'Part', 'quantity' => '1.005', 'unit' => 'PCS', 'unit_price' => '1.00']]);
        $this->assertSame(101, $calc['total_cents']);
        $p = $this->payload();
        $p['total_cents'] = 100;
        $r = $this->push($this->op('invoice.issue', $p));
        $this->assertFalse($r['ok']);
        $this->assertSame(422, $r['status']);
        $this->assertSame(0, Invoice::count());
        $this->assertSame(1, DB::table('sync_reviews')->count());
    }

    public function test_replay_after_commit_or_lost_response_keeps_number_and_single_event(): void
    {
        $op = $this->op('invoice.issue', $this->payload());
        $first = $this->push($op);
        $again = $this->push($op);
        $this->assertTrue($first['ok']);
        $this->assertEquals($first, $again);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, DB::table('invoice_events')->where('type', 'issued')->count());
        $op['payload']['notes'] = 'Different content';
        $this->assertSame(409, $this->push($op)['status']);
    }

    public function test_all_staff_see_and_cancel_any_invoice_blank_reason_and_terminal_state(): void
    {
        $i = $this->issued();
        $staff = User::factory()->create(['role' => 'staff']);
        $this->actingAs($staff);
        $this->device = (string) Str::uuid();
        $this->postJson('/api/devices', ['id' => $this->device, 'name' => 'Staff device'])->assertOk();
        $this->getJson('/api/invoices')->assertJsonPath('data.0.id', $i->id);
        $cancel = $this->op('invoice.cancel', ['reason' => ''], 0, $i->id);
        $this->assertTrue($this->push($cancel)['ok']);
        $this->assertTrue($this->push($this->op('invoice.cancel', [], 0, $i->id))['ok']);
        $this->assertSame('cancelled', $i->fresh()->status);
        $this->assertSame($staff->id, $i->fresh()->cancelled_by);
        $this->assertSame(1, DB::table('invoice_events')->where('type', 'cancelled')->count());
        $stale = $this->op('invoice.save', $this->payload(Customer::find($i->customer_id)), 1, $i->id);
        $this->assertSame(409, $this->push($stale)['status']);
        $this->assertSame('cancelled', $i->fresh()->status);
        $this->assertNotNull($i->fresh()->invoice_number);
    }

    public function test_draft_permissions_versions_and_numbers_only_on_issue(): void
    {
        $p = $this->payload();
        $op = $this->op('invoice.save', $p);
        $this->assertTrue($this->push($op)['ok']);
        $i = Invoice::find($op['entity_id']);
        $this->assertNull($i->invoice_number);
        $this->assertNull($i->number_value);
        $other = User::factory()->create();
        $this->actingAs($other);
        $this->device = (string) Str::uuid();
        $this->postJson('/api/devices', ['id' => $this->device, 'name' => 'Other'])->assertOk();
        $this->assertSame(403, $this->push($this->op('invoice.save', $p, 1, $i->id))['status']);
        $this->actingAs($this->admin);
        $this->device = $op['device_id'];
        $this->assertSame(409, $this->push($this->op('invoice.save', $p, 0, $i->id))['status']);
        $this->assertTrue($this->push($this->op('invoice.issue', $p, 1, $i->id))['ok']);
        $this->assertSame($p['invoice_number'], $i->fresh()->invoice_number);
    }

    public function test_historical_snapshots_survive_customer_and_company_edits(): void
    {
        $i = $this->issued();
        $before = $i->customer_snapshot;
        $company = $i->company_snapshot;
        $this->assertTrue($this->push($this->op('customer.save', ['name' => 'Changed name', 'phone' => '0198888888', 'address' => 'New address'], 1, $i->customer_id))['ok']);
        $this->putJson('/api/settings', [...BillingFeed::settings(), 'company_name' => 'Updated company'])->assertOk();
        $this->assertSame($before, $i->fresh()->customer_snapshot);
        $this->assertSame($company, $i->fresh()->company_snapshot);
    }

    public function test_partial_batch_and_offline_dependencies(): void
    {
        $cid = (string) Str::uuid();
        $customerOp = $this->op('customer.save', ['name' => 'Offline customer', 'phone' => '0123456789'], 0, $cid);
        $c = Customer::factory()->make(['id' => $cid, 'name' => 'Offline customer', 'phone' => '+60123456789']);
        $payload = $this->payload($c);
        $invoiceOp = $this->op('invoice.issue', $payload);
        $bad = $this->op('customer.save', ['name' => '', 'phone' => '']);
        $r = $this->postJson('/api/sync/push', ['operations' => [$customerOp, $bad, $invoiceOp]])->assertOk();
        $r->assertJsonPath('results.0.ok', true)->assertJsonPath('results.1.ok', false)->assertJsonPath('results.2.ok', true);
        $this->assertSame($cid, Invoice::first()->customer_id);
    }

    #[TestWith([1, '00001'])]
    #[TestWith([1234, '01234'])]
    #[TestWith([99999, '99999'])]
    #[TestWith([100000, '100000'])]
    public function test_issued_numbers_have_at_least_five_digits_without_a_prefix(int $number, string $formatted): void
    {
        if ($number > $this->allocation['end']) {
            DB::table('billing_counters')->where('id', 1)->update(['next_number' => $number]);
            $this->allocation = $this->postJson('/api/number-allocations', ['id' => (string) Str::uuid(), 'device_id' => $this->device])->assertOk()->json();
        }
        $op = $this->op('invoice.issue', $this->payload());

        $this->postJson('/api/sync/push', ['operations' => [$op]])->assertOk()
            ->assertJsonPath('results.0.ok', true)
            ->assertJsonPath('results.0.entity.invoice_number', $formatted);

        $this->assertDatabaseHas('invoices', ['id' => $op['entity_id'], 'number_value' => $number, 'invoice_number' => $formatted]);
    }

    public function test_legacy_offline_numbers_sync_as_five_digits_and_replay_without_using_another_number(): void
    {
        $payload = $this->payload();
        $payload['invoice_number'] = 'SL-00000001';
        $op = $this->op('invoice.issue', $payload);

        $first = $this->push($op);
        $replayed = $this->push($op);

        $this->assertTrue($first['ok']);
        $this->assertSame('00001', $first['entity']['invoice_number']);
        $this->assertEquals($first, $replayed);
        $this->assertDatabaseHas('invoices', ['id' => $op['entity_id'], 'number_value' => 1, 'invoice_number' => '00001']);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, DB::table('invoice_events')->where('type', 'issued')->count());
    }

    #[TestWith(['00002'])]
    #[TestWith(['SL-00000002'])]
    #[TestWith(['1'])]
    public function test_issuing_rejects_a_number_that_does_not_match_its_reserved_format(string $formatted): void
    {
        $payload = $this->payload();
        $payload['invoice_number'] = $formatted;

        $result = $this->push($this->op('invoice.issue', $payload));

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
        $this->assertSame(0, Invoice::count());
    }

    public function test_number_range_idempotency_ownership_unique_constraint_and_exhaustion(): void
    {
        $req = ['id' => (string) Str::uuid(), 'device_id' => $this->device];
        $a = $this->postJson('/api/number-allocations', $req)->assertOk()->json();
        $b = $this->postJson('/api/number-allocations', $req)->assertOk()->json();
        $this->assertSame($a['start'], $b['start']);
        $this->assertGreaterThan($this->allocation['end'], $a['start']);
        $p = $this->payload();
        $p['number_value'] = $this->allocation['end'] + 1;
        $p['invoice_number'] = str_pad((string) $p['number_value'], 5, '0', STR_PAD_LEFT);
        $this->assertSame(422, $this->push($this->op('invoice.issue', $p))['status']);
        $this->assertTrue($this->push($this->op('invoice.save', $p))['ok']);
        $first = $this->op('invoice.issue', $this->payload());
        $this->assertTrue($this->push($first)['ok']);
        $second = $first['payload'];
        $second['items'][0]['id'] = (string) Str::uuid();
        $this->assertSame(409, $this->push($this->op('invoice.issue', $second))['status']);
    }

    public function test_deactivation_and_actor_spoofing_are_rejected(): void
    {
        $op = $this->op('customer.save', ['name' => 'Spoof', 'phone' => '123']);
        $op['actor_id'] = 9999;
        $this->assertSame(403, $this->push($op)['status']);
        $this->admin->update(['active' => false]);
        $this->postJson('/api/sync/push', ['operations' => [$op]])->assertForbidden();
        $this->assertSame(0, Customer::count());
    }

    public function test_cursor_feed_has_server_sequence_and_preserves_replacement_link(): void
    {
        $i = $this->issued();
        $this->push($this->op('invoice.cancel', ['reason' => 'Wrong item'], 1, $i->id));
        $p = $this->payload(Customer::find($i->customer_id), 1);
        $p['replacement_for'] = $i->id;
        $replacement = $this->op('invoice.issue', $p);
        $this->assertTrue($this->push($replacement)['ok']);
        $this->getJson('/api/invoices/'.$i->id)->assertJsonPath('replacements.0.id', $replacement['entity_id']);
        $r = $this->getJson('/api/sync/pull?cursor=0')->assertOk()->json();
        $seq = array_column($r['changes'], 'sequence');
        $sorted = $seq;
        sort($sorted);
        $this->assertSame($sorted, $seq);
        $this->assertSame(count($seq), count(array_unique($seq)));
        $this->getJson('/api/sync/pull?cursor='.$r['cursor'])->assertJsonCount(0, 'changes');
    }

    public function test_concurrent_mysql_range_reservations_do_not_overlap(): void
    {
        $this->assertSame('mysql', DB::connection()->getDriverName());
        $workers = [];
        for ($n = 0; $n < 3; $n++) {
            $pipes = [];
            $proc = proc_open([PHP_BINARY, base_path('tests/support/reserve-worker.php'), $this->device, (string) $this->admin->id], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path());
            fclose($pipes[0]);
            $workers[] = [$proc, $pipes];
        }
        $ranges = [];
        foreach ($workers as [$proc,$pipes]) {
            $out = stream_get_contents($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $this->assertSame(0, proc_close($proc), $err);
            $ranges[] = json_decode($out, true, flags: JSON_THROW_ON_ERROR);
        }
        usort($ranges, fn ($a, $b) => $a['start'] <=> $b['start']);
        $this->assertLessThan($ranges[1]['start'], $ranges[0]['end']);
        $this->assertLessThan($ranges[2]['start'], $ranges[1]['end']);
    }

    public function test_role_is_rechecked_after_a_previously_authorized_request_context_becomes_stale(): void
    {
        $payload = $this->payload();
        $adminDevice = $this->device;
        $owner = User::factory()->create();
        $this->actingAs($owner);
        $this->device = (string) Str::uuid();
        $this->postJson('/api/devices', ['id' => $this->device, 'name' => 'Owner terminal'])->assertOk();
        $save = $this->op('invoice.save', $payload);
        $this->assertTrue($this->push($save)['ok']);
        $this->actingAs($this->admin);
        $this->device = $adminDevice;
        DB::table('users')->where('id', $this->admin->id)->update(['role' => 'staff']);

        $result = $this->push($this->op('invoice.save', $payload, 1, $save['entity_id']));

        $this->assertSame(403, $result['status']);
        $this->assertSame(1, Invoice::findOrFail($save['entity_id'])->version);
    }
}
