<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class RecoveryReviewTest extends TestCase
{
    use DatabaseMigrations;

    public function test_administrator_can_review_deactivated_staff_backup_without_executing_or_reattributing_it(): void
    {
        $this->seed(DatabaseSeeder::class);
        $staff = User::factory()->create(['active' => false]);
        $admin = User::factory()->create(['role' => 'admin']);
        $device = (string) Str::uuid();
        DB::table('devices')->insert(['id' => $device, 'user_id' => $staff->id, 'name' => 'Original device', 'created_at' => now(), 'updated_at' => now()]);
        $op = ['id' => (string) Str::uuid(), 'entity_id' => (string) Str::uuid(), 'device_id' => $device, 'actor_id' => $staff->id, 'type' => 'customer.save', 'payload' => ['name' => 'Preserved work', 'phone' => '0123456']];
        $this->actingAs($admin)->postJson('/api/sync/reviews/import', ['operations' => [$op]])->assertOk();
        $this->assertDatabaseHas('sync_reviews', ['id' => $op['id'], 'actor_id' => $staff->id]);
        $this->assertDatabaseCount('customers', 0);
        $this->assertDatabaseCount('sync_operations', 0);
        $this->postJson('/api/sync/reviews/import', ['operations' => [$op]])->assertOk();
        $this->assertDatabaseCount('sync_reviews', 1);
        $this->postJson('/api/sync/reviews/'.$op['id'])->assertOk();
        $this->assertDatabaseHas('sync_reviews', ['id' => $op['id'], 'status' => 'reviewed', 'reviewed_by' => $admin->id]);
        $staff->update(['active' => true]);
        $this->actingAs($staff)->postJson('/api/sync/reviews/import', ['operations' => [$op]])->assertForbidden();
    }

    public function test_backup_review_rejects_a_spoofed_original_actor(): void
    {
        $this->seed(DatabaseSeeder::class);
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create();
        $device = (string) Str::uuid();
        DB::table('devices')->insert(['id' => $device, 'user_id' => $staff->id, 'name' => 'Device', 'created_at' => now(), 'updated_at' => now()]);
        $op = ['id' => (string) Str::uuid(), 'entity_id' => (string) Str::uuid(), 'device_id' => $device, 'actor_id' => $admin->id, 'type' => 'customer.save', 'payload' => ['name' => 'Wrong author', 'phone' => '123']];
        $this->actingAs($admin)->postJson('/api/sync/reviews/import', ['operations' => [$op]])->assertUnprocessable();
        $this->assertDatabaseCount('sync_reviews', 0);
    }

    public function test_static_shell_and_assets_never_set_session_cookies(): void
    {
        $this->get('/')->assertOk()->assertCookieMissing(config('session.cookie'));
        $this->get('/icon-192.png')->assertOk()->assertCookieMissing(config('session.cookie'));
    }
}
