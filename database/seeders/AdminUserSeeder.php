<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Validator;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $credentials = config('initial_admin');

        if (blank($credentials['email']) && blank($credentials['password'])) {
            if (! app()->environment(['local', 'testing'])) {
                $this->command?->info('Administrator seed skipped: configure SINLINK_ADMIN_EMAIL and SINLINK_ADMIN_PASSWORD to create an account.');

                return;
            }

            $credentials = [
                'name' => $credentials['name'] ?: 'Administrator',
                'email' => 'admin@admin.com',
                'password' => 'password1234',
            ];
        }

        $validated = Validator::make($credentials, [
            'name' => 'required|string|max:255',
            'email' => 'required|email|max:255',
            'password' => 'required|string|min:12|max:128',
        ])->validate();

        $user = User::firstOrCreate(
            ['email' => $validated['email']],
            [
                'name' => $validated['name'],
                'password' => $validated['password'],
                'role' => 'admin',
                'active' => true,
            ],
        );

        $this->command?->info($user->wasRecentlyCreated
            ? 'Administrator account created.'
            : 'An account with this email already exists. Its name, password, role, and status were kept.');
    }
}
