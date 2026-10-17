<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceEvent extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = ['metadata' => 'array', 'created_at' => 'datetime', 'device_action_at' => 'datetime'];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id')->select(['id', 'name']);
    }
}
