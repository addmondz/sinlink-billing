<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\InvoiceEvent;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SyncService
{
    public function process(array $op, User $actor): array
    {
        Validator::make($op, [
            'id' => 'required|uuid', 'device_id' => 'required|uuid', 'actor_id' => 'required|integer',
            'entity_id' => 'required|uuid', 'type' => 'required|in:customer.save,vehicle.save,invoice.save,invoice.issue,invoice.cancel',
            'expected_version' => 'required|integer|min:0', 'payload' => 'present|array', 'action_at' => 'nullable|date',
        ])->validate();
        abort_unless((int) $op['actor_id'] === $actor->id, 403, 'An operation must be synchronized by its original author.');
        abort_unless(DB::table('devices')->where('id', $op['device_id'])->where('user_id', $actor->id)->exists(), 403, 'Register this device online first.');
        $hash = hash('sha256', json_encode($this->canonical($op)));

        return DB::transaction(function () use ($op, $actor, $hash) {
            BillingFeed::lock();
            // Recheck active status inside the transaction (deactivation also uses this mutex).
            $actor = User::findOrFail($actor->id);
            abort_unless($actor->active, 403, 'Account deactivated. Preserve this work for administrator review.');
            $receipt = DB::table('sync_operations')->where('id', $op['id'])->first();
            if ($receipt) {
                abort_unless($receipt->actor_id === $actor->id && $receipt->payload_hash === $hash, 409, 'Operation ID already belongs to different content.');

                return json_decode($receipt->result, true);
            }
            $result = match ($op['type']) {
                'customer.save' => $this->customer($op, $actor),
                'vehicle.save' => $this->vehicle($op, $actor),
                default => $this->invoice($op, $actor),
            };
            DB::table('sync_operations')->insert(['id' => $op['id'], 'device_id' => $op['device_id'], 'actor_id' => $actor->id, 'entity_id' => $op['entity_id'], 'type' => $op['type'], 'payload_hash' => $hash, 'result' => json_encode($result), 'created_at' => now()]);
            DB::table('devices')->where('id', $op['device_id'])->update(['last_seen_at' => now()]);

            return $result;
        }, 5);
    }

    private function canonical(array $data): array
    {
        if (! array_is_list($data)) {
            ksort($data);
        }
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $data[$key] = $this->canonical($value);
            }
        }

        return $data;
    }

    private function customer(array $op, User $actor): array
    {
        $p = Validator::make($op['payload'], [
            'name' => 'required|string|max:255', 'phone' => 'required|string|max:80',
            'address' => 'nullable|string|max:4000', 'email' => 'nullable|email|max:255', 'notes' => 'nullable|string|max:4000',
        ])->validate();
        $customer = Customer::find($op['entity_id']);
        abort_if(($customer?->version ?? 0) !== $op['expected_version'], 409, 'Customer changed elsewhere. Your proposed details have been preserved.');
        $p['phone'] = self::formatPhone($p['phone']);
        if ($p['phone'] === null) {
            throw ValidationException::withMessages(['phone' => 'Enter a valid phone number, for example 0162726866 or +60162726866.']);
        }
        $p['normalized_phone'] = self::normalizePhone($p['phone']);
        $customer = Customer::updateOrCreate(['id' => $op['entity_id']], [...$p, 'created_by' => $customer?->created_by ?? $actor->id, 'version' => ($customer?->version ?? 0) + 1]);
        $duplicates = Customer::where('normalized_phone', $p['normalized_phone'])->where('id', '!=', $customer->id)->get(['id', 'name', 'phone'])->toArray();
        $data = [...$customer->toArray(), 'possible_duplicates' => $duplicates];
        BillingFeed::append('customer', $customer->id, $data);

        return ['entity_type' => 'customer', 'entity' => $data, 'possible_duplicates' => $duplicates];
    }

    public static function normalizePhone(string $phone): string
    {
        $n = preg_replace('/\D/', '', $phone);
        if (! str_starts_with(trim($phone), '+')) {
            if (str_starts_with($n, '00')) {
                $n = substr($n, 2);
            } elseif (str_starts_with($n, '0')) {
                $n = '60'.substr($n, 1);
            } elseif (! str_starts_with($n, '60') && preg_match('/\A(?:1[0-9]{8,9}|3[0-9]{8}|[4-9][0-9]{7})\z/', $n)) {
                $n = '60'.$n;
            }
        }
        if (str_starts_with($n, '600')) {
            $n = '60'.substr($n, 3);
        }

        return $n;
    }

    public static function formatPhone(string $phone): ?string
    {
        $compact = preg_replace('/[\s().-]/u', '', trim($phone));
        if (strlen($phone) > 80 || ! preg_match('/\A\+?[0-9]+\z/', $compact)) {
            return null;
        }
        $number = self::normalizePhone($compact);
        if (! str_starts_with($number, '60') && ! str_starts_with($compact, '+') && ! str_starts_with($compact, '00') && strlen($number) < 10) {
            return null;
        }
        $pattern = str_starts_with($number, '60')
            ? '/\A60(?:1[0-9]{8,9}|3[0-9]{8}|[4-9][0-9]{7})\z/'
            : '/\A[1-9][0-9]{6,14}\z/';

        return preg_match($pattern, $number) ? '+'.$number : null;
    }

    private function vehicle(array $op, User $actor): array
    {
        $payload = Validator::make($op['payload'], [
            'registration' => ['required', 'string', 'max:40', 'regex:/\A[A-Za-z0-9][A-Za-z0-9 -]*\z/'],
            'car_model' => 'required|string|max:255',
            'notes' => 'nullable|string|max:4000',
            'customer_ids' => 'required|array|min:1',
            'customer_ids.*' => 'required|uuid|distinct|exists:customers,id',
        ])->validate();
        $vehicle = Vehicle::find($op['entity_id']);
        abort_if(($vehicle?->version ?? 0) !== $op['expected_version'], 409, 'This car changed elsewhere. Your proposed details have been preserved.');
        $normalizedRegistration = Vehicle::normalizeRegistration($payload['registration']);
        abort_if(Vehicle::where('normalized_registration', $normalizedRegistration)->where('id', '!=', $op['entity_id'])->exists(), 409, 'This registration already exists. Edit that car to link additional customers.');
        $customerIds = $payload['customer_ids'];
        unset($payload['customer_ids']);
        $vehicle = Vehicle::updateOrCreate(['id' => $op['entity_id']], [...$payload, 'registration' => strtoupper(trim($payload['registration'])), 'normalized_registration' => $normalizedRegistration, 'created_by' => $vehicle?->created_by ?? $actor->id, 'version' => ($vehicle?->version ?? 0) + 1]);
        $vehicle->customers()->sync($customerIds);
        $data = $vehicle->load('customers')->toArray();
        BillingFeed::append('vehicle', $vehicle->id, $data);

        return ['entity_type' => 'vehicle', 'entity' => $data];
    }

    private function invoice(array $op, User $actor): array
    {
        $invoice = Invoice::find($op['entity_id']);
        $p = $op['payload'];
        if ($op['type'] === 'invoice.cancel') {
            abort_unless($invoice && in_array($invoice->status, ['issued', 'cancelled']), 422, 'Only issued invoices can be cancelled.');
            if ($invoice->status === 'cancelled') {
                return ['entity_type' => 'invoice', 'entity' => $invoice->load(['items', 'creator', 'events', 'replacements'])->toArray()];
            }
            Validator::make($p, ['reason' => 'nullable|string|max:4000'])->validate();
            $invoice->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancelled_by' => $actor->id, 'cancellation_reason' => $p['reason'] ?? null, 'version' => $invoice->version + 1]);
            $this->event($invoice, 'cancelled', $op, $actor, $p['reason'] ?? null);
        } else {
            abort_if($invoice && $invoice->status !== 'draft', 409, 'Issued and cancelled invoices cannot be edited. Create a replacement instead.');
            abort_if($invoice && $invoice->created_by !== $actor->id && $actor->role !== 'admin', 403, 'Only the creator or an administrator can edit this draft.');
            abort_if(($invoice?->version ?? 0) !== $op['expected_version'], 409, 'This draft changed elsewhere. Review your preserved proposal.');
            Validator::make($p, [
                'invoice_date' => 'required|date_format:Y-m-d', 'customer_id' => 'required|uuid|exists:customers,id',
                'customer_snapshot' => 'required|array', 'customer_snapshot.name' => 'required|string|max:255', 'customer_snapshot.phone' => 'required|string|max:80',
                'customer_snapshot.address' => 'nullable|string|max:4000', 'customer_snapshot.email' => 'nullable|string|max:255',
                'company_snapshot.version' => 'required|integer|min:1', 'vehicle_registration' => 'nullable|string|max:40',
                'car_model' => 'nullable|string|max:255', 'notes' => 'nullable|string|max:4000', 'replacement_for' => 'nullable|uuid|exists:invoices,id',
                'total_cents' => 'required|integer|min:0', 'total_quantity' => 'required|numeric',
            ])->validate();
            if (! empty($p['replacement_for'])) {
                abort_unless(Invoice::find($p['replacement_for'])->status === 'cancelled', 422, 'A replacement must reference a cancelled invoice.');
            }
            $calc = Money::calculate($p['items'] ?? []);
            if ($calc['total_cents'] !== (int) $p['total_cents'] || bccomp($calc['total_quantity'], (string) $p['total_quantity'], 3) !== 0) {
                throw ValidationException::withMessages(['totals' => 'Financial reconciliation failed. The local document was retained; review it before retrying.']);
            }
            foreach ($calc['items'] as $i => $line) {
                if (! isset($p['items'][$i]['amount_cents']) || (int) $p['items'][$i]['amount_cents'] !== $line['amount_cents']) {
                    throw ValidationException::withMessages(['items' => 'A line amount differs from the rounding rule. Local content has been preserved.']);
                }
                abort_if(DB::table('invoice_items')->where('id', $line['id'])->where('invoice_id', '!=', $op['entity_id'])->exists(), 422, 'Line ID belongs to another invoice.');
            }
            $company = BillingFeed::settings();
            if ($company['version'] !== $p['company_snapshot']['version']) {
                $history = DB::table('change_log')->where('entity_type', 'company')->orderByDesc('sequence')->get();
                $company = collect($history)->map(fn ($row) => json_decode($row->data, true))->firstWhere('version', $p['company_snapshot']['version']);
                abort_unless($company, 422, 'Company snapshot version is unknown.');
            }
            // Reject rather than silently change a document already printed on a disconnected device.
            foreach ($company as $key => $value) {
                abort_unless(($p['company_snapshot'][$key] ?? null) === $value, 422, 'Company snapshot differs from its authorized settings version.');
            }
            $attrs = [
                'status' => 'draft', 'invoice_date' => $p['invoice_date'], 'customer_id' => $p['customer_id'],
                'customer_snapshot' => array_intersect_key($p['customer_snapshot'], array_flip(['name', 'phone', 'address', 'email'])),
                'company_snapshot' => $company, 'customer_name' => $p['customer_snapshot']['name'], 'customer_phone' => $p['customer_snapshot']['phone'], 'customer_phone_normalized' => self::normalizePhone($p['customer_snapshot']['phone']),
                'vehicle_registration' => $p['vehicle_registration'] ?? null, 'car_model' => $p['car_model'] ?? null, 'notes' => $p['notes'] ?? null,
                'replacement_for' => $p['replacement_for'] ?? null, 'total_cents' => $calc['total_cents'], 'subtotal_cents' => $calc['subtotal_cents'], 'total_quantity' => $calc['total_quantity'],
                'created_by' => $invoice?->created_by ?? $actor->id, 'device_id' => $invoice?->device_id ?? $op['device_id'], 'version' => ($invoice?->version ?? 0) + 1,
            ];
            if ($op['type'] === 'invoice.issue') {
                Validator::make($p, ['allocation_id' => 'required|uuid', 'number_value' => 'required|integer|min:1', 'invoice_number' => 'required|string'])->validate();
                $allocation = DB::table('invoice_number_allocations')->where('id', $p['allocation_id'])->where('device_id', $op['device_id'])->first();
                abort_unless($allocation && $p['number_value'] >= $allocation->start && $p['number_value'] <= $allocation->end, 422, 'Number is outside the registered device allocation.');
                $formatted = Invoice::formatNumber((int) $p['number_value']);
                $legacyNumber = 'SL-'.str_pad((string) $p['number_value'], 8, '0', STR_PAD_LEFT);
                abort_unless(in_array($p['invoice_number'], [$formatted, $legacyNumber], true), 422, 'Invoice number does not match the reserved number.');
                abort_if(Invoice::where('number_value', $p['number_value'])->exists(), 409, 'Reserved number was already consumed. Preserve this invoice for administrator review.');
                $attrs = [...$attrs, 'status' => 'issued', 'issued_at' => now(), 'allocation_id' => $allocation->id, 'number_value' => $p['number_value'], 'invoice_number' => $formatted];
            }
            $invoice = Invoice::updateOrCreate(['id' => $op['entity_id']], $attrs);
            $invoice->items()->delete();
            foreach ($calc['items'] as $line) {
                $invoice->items()->create($line);
            }
            $this->event($invoice, $op['type'] === 'invoice.issue' ? 'issued' : 'draft_saved', $op, $actor, null, ['number_value' => $attrs['number_value'] ?? null, 'version' => $invoice->version]);
            $this->linkInvoiceVehicle($invoice);
        }
        $data = $invoice->fresh()->load(['items', 'creator', 'events', 'replacements'])->toArray();
        BillingFeed::append('invoice', $invoice->id, $data);
        if ($invoice->replacement_for) {
            $original = Invoice::find($invoice->replacement_for)->load(['items', 'creator', 'events', 'replacements']);
            BillingFeed::append('invoice', $original->id, $original->toArray());
        }

        return ['entity_type' => 'invoice', 'entity' => $data];
    }

    private function linkInvoiceVehicle(Invoice $invoice): void
    {
        $registration = strtoupper(trim($invoice->vehicle_registration ?? ''));
        $normalizedRegistration = Vehicle::normalizeRegistration($registration);
        if ($normalizedRegistration === '') {
            return;
        }
        $vehicle = Vehicle::firstOrNew(['normalized_registration' => $normalizedRegistration]);
        $created = ! $vehicle->exists;
        if ($created) {
            $vehicle->fill([
                'id' => (string) Str::uuid(),
                'registration' => $registration,
                'car_model' => trim($invoice->car_model ?? '') ?: 'Unspecified',
                'created_by' => $invoice->created_by,
                'version' => 1,
            ])->save();
        }
        $links = $vehicle->customers()->syncWithoutDetaching([$invoice->customer_id]);
        if (! $created && $links['attached'] !== []) {
            $vehicle->update(['version' => $vehicle->version + 1]);
        }
        if ($created || $links['attached'] !== []) {
            BillingFeed::append('vehicle', $vehicle->id, $vehicle->load('customers')->toArray());
        }
    }

    private function event(Invoice $invoice, string $type, array $op, User $actor, ?string $reason = null, array $metadata = []): void
    {
        InvoiceEvent::create(['invoice_id' => $invoice->id, 'type' => $type, 'actor_id' => $actor->id, 'device_id' => $op['device_id'], 'reason' => $reason, 'metadata' => $metadata, 'device_action_at' => isset($op['action_at']) ? Carbon::parse($op['action_at'])->setTimezone(config('app.timezone')) : null, 'created_at' => now()]);
    }
}
