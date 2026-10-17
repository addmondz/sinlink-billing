<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_reviews', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('actor_id')->constrained('users');
            $t->uuid('device_id');
            $t->json('operation');
            $t->text('error');
            $t->string('status')->default('open');
            $t->foreignId('reviewed_by')->nullable()->constrained('users');
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_reviews');
    }
};
