<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->string('role', 16)->default('staff');
            $t->boolean('active')->default(true);
        });
        Schema::create('company_settings', function (Blueprint $t) {
            $t->unsignedInteger('id')->primary();
            $t->uuid('business_id')->unique();
            $t->json('data');
            $t->unsignedInteger('version')->default(1);
            $t->timestamps();
        });
        // This singleton also serializes change-feed commits. No timestamp cursor races.
        Schema::create('billing_counters', function (Blueprint $t) {
            $t->unsignedInteger('id')->primary();
            $t->unsignedBigInteger('next_number')->default(1);
            $t->unsignedBigInteger('change_sequence')->default(0);
        });
        Schema::create('devices', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('user_id')->constrained();
            $t->string('name', 100);
            $t->timestamp('last_seen_at')->nullable();
            $t->timestamps();
        });
        Schema::create('invoice_number_allocations', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained();
            $t->unsignedBigInteger('start');
            $t->unsignedBigInteger('end');
            $t->timestamps();
            $t->unique(['start', 'end']);
        });
        Schema::create('customers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name')->index();
            $t->string('phone', 80);
            $t->string('normalized_phone', 80)->index();
            $t->text('address')->nullable();
            $t->string('email')->nullable();
            $t->text('notes')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });
        Schema::create('invoices', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('invoice_number', 40)->nullable()->unique();
            $t->unsignedBigInteger('number_value')->nullable()->unique();
            $t->foreignUuid('allocation_id')->nullable()->constrained('invoice_number_allocations');
            $t->string('status', 16)->index();
            $t->date('invoice_date')->index();
            $t->foreignUuid('customer_id')->constrained();
            $t->json('customer_snapshot');
            $t->json('company_snapshot');
            $t->string('customer_name')->index();
            $t->string('customer_phone', 80)->index();
            $t->string('vehicle_registration', 40)->nullable()->index();
            $t->string('car_model')->nullable();
            $t->string('currency', 3)->default('MYR');
            $t->decimal('total_quantity', 16, 3);
            $t->unsignedBigInteger('subtotal_cents');
            $t->unsignedBigInteger('total_cents');
            $t->text('notes')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->foreignUuid('device_id')->constrained();
            $t->unsignedInteger('version')->default(1);
            $t->timestamp('issued_at')->nullable();
            $t->timestamp('cancelled_at')->nullable();
            $t->foreignId('cancelled_by')->nullable()->constrained('users');
            $t->text('cancellation_reason')->nullable();
            $t->foreignUuid('replacement_for')->nullable()->constrained('invoices');
            $t->timestamps();
            $t->index(['status', 'invoice_date']);
        });
        Schema::create('invoice_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('invoice_id')->constrained();
            $t->unsignedInteger('sort_order');
            $t->text('description');
            $t->decimal('quantity', 12, 3);
            $t->string('unit', 20);
            $t->decimal('unit_price', 12, 2);
            $t->unsignedBigInteger('amount_cents');
            $t->index(['invoice_id', 'sort_order']);
        });
        Schema::create('invoice_events', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('invoice_id')->constrained();
            $t->string('type', 40);
            $t->foreignId('actor_id')->constrained('users');
            $t->foreignUuid('device_id')->constrained();
            $t->text('reason')->nullable();
            $t->json('metadata')->nullable();
            $t->timestamp('device_action_at')->nullable();
            $t->timestamp('created_at');
        });
        Schema::create('sync_operations', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('device_id')->constrained();
            $t->foreignId('actor_id')->constrained('users');
            $t->uuid('entity_id')->index();
            $t->string('type', 40);
            $t->string('payload_hash', 64);
            $t->json('result');
            $t->timestamp('created_at');
        });
        Schema::create('change_log', function (Blueprint $t) {
            $t->unsignedBigInteger('sequence')->primary();
            $t->string('entity_type', 20);
            $t->string('entity_id', 40);
            $t->json('data');
            $t->timestamp('created_at');
            $t->index(['entity_type', 'sequence']);
        });
    }

    public function down(): void
    {
        foreach (['change_log', 'sync_operations', 'invoice_events', 'invoice_items', 'invoices', 'customers', 'invoice_number_allocations', 'devices', 'billing_counters', 'company_settings'] as $name) {
            Schema::dropIfExists($name);
        }
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['role', 'active']));
    }
};
