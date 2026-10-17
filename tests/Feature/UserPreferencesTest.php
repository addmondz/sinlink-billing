<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Tests\TestCase;

class UserPreferencesTest extends TestCase
{
    use DatabaseMigrations;

    public function test_staff_can_enable_and_disable_simple_mode_for_their_own_account_only(): void
    {
        $this->seed(DatabaseSeeder::class);
        $staff = User::factory()->create(['role' => 'staff']);
        $other = User::factory()->create(['simple_mode' => false]);

        $this->actingAs($staff)->putJson('/api/preferences', ['simple_mode' => true, 'id' => $other->id, 'role' => 'admin'])->assertOk()->assertJsonPath('simple_mode', true);

        $this->assertDatabaseHas('users', ['id' => $staff->id, 'simple_mode' => true, 'role' => 'staff']);
        $this->assertDatabaseHas('users', ['id' => $other->id, 'simple_mode' => false]);
        $this->getJson('/api/me')->assertOk()->assertJsonPath('user.simple_mode', true);
        $this->putJson('/api/preferences', ['simple_mode' => false])->assertOk()->assertJsonPath('simple_mode', false);
        $this->assertDatabaseHas('users', ['id' => $staff->id, 'simple_mode' => false]);
    }

    public function test_administrators_can_configure_simple_mode_from_staff_settings(): void
    {
        $this->seed(DatabaseSeeder::class);
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $payload = ['name' => $staff->name, 'email' => $staff->email, 'role' => 'staff', 'active' => true, 'simple_mode' => true];

        $this->actingAs($admin)->putJson('/api/staff/'.$staff->id, $payload)->assertOk()->assertJsonPath('simple_mode', true);

        $this->assertDatabaseHas('users', ['id' => $staff->id, 'simple_mode' => true]);
        $this->actingAs($staff->fresh())->getJson('/api/me')->assertOk()->assertJsonPath('user.simple_mode', true);
        $this->putJson('/api/staff/'.$admin->id, $payload)->assertForbidden();
    }

    public function test_display_preferences_require_an_active_authenticated_account(): void
    {
        $this->putJson('/api/preferences', ['simple_mode' => true])->assertUnauthorized();
        $inactive = User::factory()->create(['active' => false]);
        $this->actingAs($inactive)->putJson('/api/preferences', ['simple_mode' => true])->assertForbidden();
        $this->assertDatabaseHas('users', ['id' => $inactive->id, 'simple_mode' => false]);
    }

    public function test_invalid_preferences_return_422_without_changing_the_display_mode(): void
    {
        $staff = User::factory()->create(['simple_mode' => false]);

        $this->actingAs($staff)->putJson('/api/preferences', ['simple_mode' => 'sometimes'])->assertUnprocessable()->assertJsonValidationErrors('simple_mode');

        $this->assertDatabaseHas('users', ['id' => $staff->id, 'simple_mode' => false]);
    }
}
