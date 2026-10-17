<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\User;
use App\Models\Vehicle;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\VehicleSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class VehicleTest extends TestCase
{
    use DatabaseMigrations;

    private function signIn(): string
    {
        $this->seed(DatabaseSeeder::class);
        $this->actingAs(User::factory()->create());
        $device = (string) Str::uuid();
        $this->postJson('/api/devices', ['id' => $device, 'name' => 'Car test terminal'])->assertOk();

        return $device;
    }

    private function saveVehicle(string $device, array $customers, string $registration = 'VDR 4118', ?string $id = null, int $version = 0): TestResponse
    {
        return $this->postJson('/api/sync/push', ['operations' => [[
            'id' => (string) Str::uuid(), 'device_id' => $device, 'actor_id' => auth()->id(),
            'entity_id' => $id ?? (string) Str::uuid(), 'type' => 'vehicle.save', 'expected_version' => $version,
            'payload' => ['registration' => $registration, 'car_model' => 'MYVI', 'customer_ids' => $customers],
        ]]]);
    }

    public function test_one_car_is_shared_by_multiple_customers_and_published_to_devices(): void
    {
        $device = $this->signIn();
        $customers = Customer::factory()->count(2)->create(['created_by' => auth()->id()]);

        $response = $this->saveVehicle($device, $customers->modelKeys())->assertOk()->assertJsonPath('results.0.ok', true);

        $id = $response->json('results.0.entity.id');
        $this->assertDatabaseHas('vehicles', ['id' => $id, 'registration' => 'VDR 4118', 'normalized_registration' => 'VDR4118']);
        $this->assertDatabaseCount('vehicles', 1);
        $this->assertDatabaseCount('customer_vehicle', 2);
        foreach ($customers as $customer) {
            $this->assertSame($id, $customer->vehicles->sole()->id);
        }
        $this->getJson('/api/vehicles/'.$id)->assertOk()->assertJsonCount(2, 'customer_ids');
        $this->getJson('/api/vehicles')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/sync/pull?cursor=1')->assertOk()->assertJsonPath('changes.0.entity_type', 'vehicle')->assertJsonCount(2, 'changes.0.data.customer_ids');
    }

    public function test_changing_linked_customers_preserves_car_identity_and_rejects_stale_edits(): void
    {
        $device = $this->signIn();
        $customers = Customer::factory()->count(3)->create(['created_by' => auth()->id()]);
        $id = $this->saveVehicle($device, [$customers[0]->id, $customers[1]->id])->json('results.0.entity.id');

        $this->saveVehicle($device, [$customers[1]->id, $customers[2]->id], 'VDR 4118', $id, 1)->assertOk()->assertJsonPath('results.0.ok', true);
        $this->saveVehicle($device, [$customers[0]->id], 'VDR 4118', $id, 1)->assertOk()->assertJsonPath('results.0.status', 409);

        $this->assertDatabaseCount('vehicles', 1);
        $this->assertDatabaseCount('customer_vehicle', 2);
        $this->assertDatabaseMissing('customer_vehicle', ['vehicle_id' => $id, 'customer_id' => $customers[0]->id]);
        $this->assertDatabaseHas('vehicles', ['id' => $id, 'version' => 2]);
    }

    public function test_duplicate_registrations_are_rejected_without_merging_or_changing_customer_links(): void
    {
        $device = $this->signIn();
        $customers = Customer::factory()->count(2)->create(['created_by' => auth()->id()]);
        $id = $this->saveVehicle($device, [$customers[0]->id])->json('results.0.entity.id');

        $this->saveVehicle($device, [$customers[1]->id], 'vdr-4118')->assertOk()->assertJsonPath('results.0.status', 409);

        $this->assertDatabaseCount('vehicles', 1);
        $this->assertDatabaseHas('customer_vehicle', ['vehicle_id' => $id, 'customer_id' => $customers[0]->id]);
        $this->assertDatabaseMissing('customer_vehicle', ['vehicle_id' => $id, 'customer_id' => $customers[1]->id]);
    }

    public function test_nonexistent_customers_are_rejected_without_creating_a_car(): void
    {
        $device = $this->signIn();

        $this->saveVehicle($device, [(string) Str::uuid()])->assertOk()->assertJsonPath('results.0.status', 422);

        $this->assertDatabaseCount('vehicles', 0);
        $this->assertDatabaseCount('customer_vehicle', 0);
        $this->assertDatabaseCount('change_log', 1);
    }

    public function test_car_directory_requires_authentication(): void
    {
        $this->getJson('/api/vehicles')->assertUnauthorized();
    }

    public function test_vehicle_seeding_links_existing_invoice_customers_without_rewriting_history_or_duplicating_cars(): void
    {
        $this->seed(DatabaseSeeder::class);
        $first = Invoice::factory()->create(['vehicle_registration' => 'VDR 4118', 'car_model' => 'MYVI']);
        $second = Invoice::factory()->create(['vehicle_registration' => 'vdr4118', 'car_model' => 'MYVI']);
        $original = [$first->refresh()->getAttributes(), $second->refresh()->getAttributes()];

        $this->seed(VehicleSeeder::class);
        $sequence = DB::table('billing_counters')->value('change_sequence');
        $this->seed(VehicleSeeder::class);

        $this->assertDatabaseCount('vehicles', 1);
        $this->assertDatabaseCount('customer_vehicle', 2);
        $this->assertSame($sequence, DB::table('billing_counters')->value('change_sequence'));
        $this->assertSame($original, [$first->fresh()->getAttributes(), $second->fresh()->getAttributes()]);
        $this->assertCount(2, Vehicle::firstOrFail()->customers);
    }
}
