<?php

namespace App\Models;

use Database\Factories\VehicleFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Vehicle extends Model
{
    /** @use HasFactory<VehicleFactory> */
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $appends = ['customer_ids'];

    public function customers(): BelongsToMany
    {
        return $this->belongsToMany(Customer::class);
    }

    protected function customerIds(): Attribute
    {
        return Attribute::get(fn (): array => $this->customers->modelKeys());
    }

    public static function normalizeRegistration(string $registration): string
    {
        return preg_replace('/[^A-Z0-9]/', '', strtoupper($registration));
    }
}
