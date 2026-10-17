<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\AdminUserSeeder;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class AdminUserSeederTest extends TestCase
{
    use DatabaseMigrations;

    public function test_fresh_migrations_create_a_working_dummy_administrator_locally_without_configured_credentials(): void
    {
        config(['initial_admin.email' => null, 'initial_admin.password' => null]);

        $this->app['env'] = 'local';
        try {
            $this->artisan('migrate:fresh', ['--seed' => true, '--force' => true])->assertSuccessful();
        } finally {
            $this->app['env'] = 'testing';
        }

        $this->assertDatabaseHas('users', ['email' => 'admin@admin.com', 'role' => 'admin', 'active' => true]);
        $user = User::where('email', 'admin@admin.com')->firstOrFail();
        $this->assertTrue(Hash::check('password1234', $user->password));
        $this->postJson('/api/login', ['email' => 'admin@admin.com', 'password' => 'password1234'])
            ->assertOk()
            ->assertJsonPath('user.role', 'admin');

        $this->seed(AdminUserSeeder::class);

        $this->assertDatabaseCount('users', 1);
    }

    public function test_unconfigured_production_seeding_does_not_create_a_dummy_account(): void
    {
        config(['initial_admin.email' => null, 'initial_admin.password' => null]);

        $this->app['env'] = 'production';
        try {
            $this->artisan('db:seed', ['--class' => AdminUserSeeder::class, '--force' => true])->assertSuccessful();
        } finally {
            $this->app['env'] = 'testing';
        }

        $this->assertDatabaseCount('users', 0);
    }

    public function test_default_seeding_creates_an_active_administrator_with_a_hashed_password_and_working_login(): void
    {
        $password = 'A long seeder test passphrase!';
        config(['initial_admin' => ['name' => 'Shop Administrator', 'email' => 'seed-admin@example.test', 'password' => $password]]);

        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseHas('users', ['name' => 'Shop Administrator', 'email' => 'seed-admin@example.test', 'role' => 'admin', 'active' => true]);
        $user = User::where('email', 'seed-admin@example.test')->firstOrFail();
        $this->assertNotSame($password, $user->password);
        $this->assertTrue(Hash::check($password, $user->password));
        $this->postJson('/api/login', ['email' => $user->email, 'password' => $password])
            ->assertOk()
            ->assertJsonPath('user.role', 'admin');
    }

    public function test_reseeding_keeps_existing_accounts_and_does_not_promote_reactivate_or_reset_them(): void
    {
        $user = User::factory()->create(['name' => 'Existing staff', 'email' => 'existing@example.test', 'role' => 'staff', 'active' => false]);
        $originalHash = $user->password;
        config(['initial_admin' => ['name' => 'Replacement name', 'email' => $user->email, 'password' => 'A different seed passphrase!']]);

        $this->seed(AdminUserSeeder::class);
        $this->seed(AdminUserSeeder::class);

        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Existing staff', 'role' => 'staff', 'active' => false, 'password' => $originalHash]);
    }

    public function test_partial_credentials_fail_without_creating_an_account(): void
    {
        config(['initial_admin' => ['name' => 'Shop Administrator', 'email' => 'seed-admin@example.test', 'password' => null]]);

        try {
            $this->seed(AdminUserSeeder::class);
            $this->fail('Incomplete seed credentials must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('password', $exception->errors());
        }

        $this->assertDatabaseCount('users', 0);
    }

    public function test_short_passwords_fail_without_creating_an_account(): void
    {
        config(['initial_admin' => ['name' => 'Shop Administrator', 'email' => 'seed-admin@example.test', 'password' => 'short']]);

        try {
            $this->seed(AdminUserSeeder::class);
            $this->fail('Short seed passwords must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('password', $exception->errors());
        }

        $this->assertDatabaseCount('users', 0);
    }
}
