<?php

namespace Database\Factories;

use App\Models\User;
use App\Services\SyncService;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class CustomerFactory extends Factory
{
    public function definition(): array
    {
        $p = '+6012'.fake()->numerify('#######');

        return ['id' => Str::uuid(), 'name' => fake()->name(), 'phone' => $p, 'normalized_phone' => SyncService::normalizePhone($p), 'created_by' => User::factory(), 'version' => 1];
    }
}
