<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = ['customer_snapshot' => 'array', 'company_snapshot' => 'array', 'total_cents' => 'integer', 'subtotal_cents' => 'integer', 'issued_at' => 'datetime', 'cancelled_at' => 'datetime'];

    public static function formatNumber(int $number): string
    {
        return str_pad((string) $number, 5, '0', STR_PAD_LEFT);
    }

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class)->orderBy('sort_order');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->select(['id', 'name']);
    }

    public function events(): HasMany
    {
        return $this->hasMany(InvoiceEvent::class)->with('actor')->orderBy('id');
    }

    public function replacements(): HasMany
    {
        return $this->hasMany(self::class, 'replacement_for')->select(['id', 'replacement_for', 'invoice_number', 'status']);
    }
}
