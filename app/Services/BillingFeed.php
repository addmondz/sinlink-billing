<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class BillingFeed
{
    // Call within a transaction before any business writes, always in this lock order.
    public static function lock(): object
    {
        return DB::table('billing_counters')->where('id', 1)->lockForUpdate()->firstOrFail();
    }

    public static function append(string $type, string $id, array $data): void
    {
        DB::table('billing_counters')->where('id', 1)->increment('change_sequence');
        $seq = DB::table('billing_counters')->where('id', 1)->value('change_sequence');
        DB::table('change_log')->insert(['sequence' => $seq, 'entity_type' => $type, 'entity_id' => $id, 'data' => json_encode($data), 'created_at' => now()]);
    }

    public static function settings(): array
    {
        $row = DB::table('company_settings')->where('id', 1)->firstOrFail();

        return [...json_decode($row->data, true), 'version' => $row->version, 'business_id' => $row->business_id];
    }
}
