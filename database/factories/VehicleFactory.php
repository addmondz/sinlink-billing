<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Vehicle>
 */
class VehicleFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'id' => Str::uuid(),
            'registration' => fake()->unique()->bothify('TST ####???'),
            'normalized_registration' => fn (array $attributes): string => Vehicle::normalizeRegistration($attributes['registration']),
            'car_model' => 'Perodua Myvi',
            'created_by' => User::factory(),
            'version' => 1,
        ];
    }
}
