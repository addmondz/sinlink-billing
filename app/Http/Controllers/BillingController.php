<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\BillingFeed;
use App\Services\SyncService;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class BillingController extends Controller
{
    public function login(Request $r): JsonResponse
    {
        $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        if (! Auth::guard('web')->attempt(['email' => $r->email, 'password' => $r->password, 'active' => true])) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect, or the account is inactive.']);
        }
        $r->session()->regenerate();

        return response()->json(['user' => Auth::guard('web')->user(), 'company' => BillingFeed::settings()])->header('Cache-Control', 'no-store');
    }

    public function me(Request $r): JsonResponse
    {
        return response()->json(['user' => $r->user(), 'company' => BillingFeed::settings()])->header('Cache-Control', 'no-store');
    }

    public function logout(Request $r): JsonResponse
    {
        Auth::guard('web')->logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();

        return response()->json(['ok' => true]);
    }

    public function savePreferences(Request $r): User
    {
        $preferences = $r->validate(['simple_mode' => 'required|boolean']);
        $r->user()->update($preferences);

        return $r->user()->fresh();
    }

    public function registerDevice(Request $r): array
    {
        $p = $r->validate(['id' => 'required|uuid', 'name' => 'required|string|max:100']);

        return DB::transaction(function () use ($p, $r) {
            BillingFeed::lock();
            $device = DB::table('devices')->where('id', $p['id'])->first();
            abort_if($device && $device->user_id !== $r->user()->id, 403, 'This device identity belongs to another account.');
            if (! $device) {
                DB::table('devices')->insert([...$p, 'user_id' => $r->user()->id, 'last_seen_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            }

            return ['id' => $p['id'], 'business_id' => BillingFeed::settings()['business_id']];
        });
    }

    public function reserve(Request $r): array
    {
        $p = $r->validate(['id' => 'required|uuid', 'device_id' => 'required|uuid']);

        return DB::transaction(function () use ($p, $r) {
            $counter = BillingFeed::lock();
            abort_unless(DB::table('devices')->where('id', $p['device_id'])->where('user_id', $r->user()->id)->exists(), 403);
            $existing = DB::table('invoice_number_allocations')->where('id', $p['id'])->first();
            if ($existing) {
                abort_unless($existing->device_id === $p['device_id'], 403);

                return (array) $existing;
            }
            $row = [...$p, 'start' => $counter->next_number, 'end' => $counter->next_number + 99, 'created_at' => now(), 'updated_at' => now()];
            DB::table('invoice_number_allocations')->insert($row);
            DB::table('billing_counters')->where('id', 1)->update(['next_number' => $row['end'] + 1]);

            return $row;
        }, 5);
    }

    public function push(Request $r, SyncService $service): array
    {
        $r->validate(['operations' => 'required|array|max:50', 'operations.*' => 'array']);
        $results = [];
        foreach ($r->operations as $op) {
            try {
                $results[] = ['id' => $op['id'] ?? null, 'ok' => true, ...$service->process($op, $r->user())];
            } catch (ValidationException $e) {
                $results[] = $this->failure($op, $r, 422, $e->getMessage(), $e->errors());
            } catch (\Throwable $e) {
                if ($e instanceof HttpExceptionInterface) {
                    $results[] = $this->failure($op, $r, $e->getStatusCode(), $e->getMessage());
                } else {
                    report($e);
                    $results[] = ['id' => $op['id'] ?? null, 'ok' => false, 'status' => 503, 'error' => 'Server could not commit this operation. It is safe to retry.'];
                }
            }
        }

        return ['results' => $results];
    }

    private function failure(array $op, Request $r, int $status, string $error, array $errors = []): array
    {
        if (isset($op['id'],$op['device_id']) && Str::isUuid($op['id']) && Str::isUuid($op['device_id'])) {
            $existing = DB::table('sync_reviews')->where('id', $op['id'])->first();
            if (! $existing) {
                DB::table('sync_reviews')->insert(['id' => $op['id'], 'actor_id' => $r->user()->id, 'device_id' => $op['device_id'], 'operation' => json_encode($op), 'error' => $error, 'created_at' => now(), 'updated_at' => now()]);
            }
        }

        return ['id' => $op['id'] ?? null, 'ok' => false, 'status' => $status, 'error' => $error, 'errors' => $errors];
    }

    public function pull(Request $r): array
    {
        $r->validate(['cursor' => 'nullable|integer|min:0']);

        return DB::transaction(function () use ($r) {
            BillingFeed::lock();
            $rows = DB::table('change_log')->where('sequence', '>', (int) $r->input('cursor', 0))->orderBy('sequence')->limit(200)->get();

            return ['changes' => $rows->map(fn ($row) => [...(array) $row, 'data' => json_decode($row->data, true)]), 'cursor' => $rows->last()?->sequence ?? (int) $r->input('cursor', 0), 'has_more' => $rows->count() === 200];
        });
    }

    public function invoices(Request $r): LengthAwarePaginator
    {
        $r->validate(['status' => 'nullable|in:draft,issued,cancelled', 'from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d', 'q' => 'nullable|string|max:255', 'per_page' => ['sometimes', 'integer', Rule::in([5, 10, 20, 50, 100])]]);
        $q = Invoice::with(['items', 'creator', 'events', 'replacements']);
        if ($s = $r->input('q')) {
            $q->where(function ($q) use ($s) {
                foreach (['invoice_number', 'customer_name', 'customer_phone', 'vehicle_registration'] as $col) {
                    $q->orWhere($col, 'like', '%'.$s.'%');
                }if ($n = SyncService::normalizePhone($s)) {
                    $q->orWhere('customer_phone_normalized', 'like', '%'.$n.'%');
                    $q->orWhereRaw("REGEXP_REPLACE(customer_phone, '[^0-9]', '') LIKE ?", ['%'.$n.'%']);
                    if (str_starts_with($n, '60') && strlen($n) > 2) {
                        $q->orWhereRaw("REGEXP_REPLACE(customer_phone, '[^0-9]', '') LIKE ?", ['%'.substr($n, 2).'%']);
                    }
                }
            });
        }
        if ($s = $r->input('status')) {
            $q->where('status', $s);
        }
        if ($s = $r->input('from')) {
            $q->whereDate('invoice_date', '>=', $s);
        }
        if ($s = $r->input('to')) {
            $q->whereDate('invoice_date', '<=', $s);
        }

        return $q->orderByDesc('invoice_date')->orderByDesc('created_at')->orderByDesc('id')->paginate($r->integer('per_page', 5));
    }

    public function invoice(string $id): Invoice
    {
        return Invoice::with(['items', 'creator', 'events', 'replacements'])->findOrFail($id);
    }

    public function customers(Request $r): LengthAwarePaginator
    {
        $r->validate(['q' => 'nullable|string|max:255']);
        $q = Customer::query();
        if ($s = $r->input('q')) {
            $q->where(function ($q) use ($s) {
                $q->where('name', 'like', '%'.$s.'%')->orWhere('phone', 'like', '%'.$s.'%');
                if ($n = SyncService::normalizePhone($s)) {
                    $q->orWhere('normalized_phone', 'like', '%'.$n.'%');
                }
            });
        }

        return $q->orderBy('name')->paginate(50);
    }

    public function customer(string $id): Customer
    {
        return Customer::findOrFail($id);
    }

    public function vehicles(): LengthAwarePaginator
    {
        return Vehicle::with('customers')->orderBy('registration')->paginate(50);
    }

    public function vehicle(string $id): Vehicle
    {
        return Vehicle::with('customers')->findOrFail($id);
    }

    private function admin(Request $r): void
    {
        $actor = User::findOrFail($r->user()->id);
        abort_unless($actor->active && $actor->role === 'admin', 403, 'Administrator access required.');
    }

    public function staff(Request $r): Collection
    {
        $this->admin($r);

        return User::orderBy('name')->get();
    }

    public function saveStaff(Request $r, ?string $id = null): User
    {
        $this->admin($r);
        $p = $r->validate(['name' => 'required|string|max:255', 'email' => ['required', 'email', Rule::unique('users')->ignore($id)], 'role' => 'required|in:admin,staff', 'active' => 'required|boolean', 'simple_mode' => 'sometimes|boolean', 'password' => [$id ? 'nullable' : 'required', 'string', 'min:12', 'max:128']]);

        return DB::transaction(function () use ($p, $id, $r) {
            BillingFeed::lock();
            $this->admin($r);
            if ($id && User::findOrFail($id)->role === 'admin' && (! $p['active'] || $p['role'] !== 'admin')) {
                abort_if(User::where('role', 'admin')->where('active', true)->count() <= 1, 422, 'Keep at least one active administrator.');
            }
            if (empty($p['password'])) {
                unset($p['password']);
            }
            $u = User::updateOrCreate(['id' => $id], $p);
            if (isset($p['password']) || ! $p['active']) {
                DB::table('sessions')->where('user_id', $u->id)->delete();
            }

            return $u;
        });
    }

    public function settings(Request $r): array
    {
        return BillingFeed::settings();
    }

    public function saveSettings(Request $r): array
    {
        $this->admin($r);
        $p = $r->validate([
            'version' => 'required|integer', 'company_name' => 'required|string|max:255', 'registration_number' => 'nullable|string|max:100',
            'address' => 'nullable|string|max:2000', 'phone' => 'nullable|string|max:80', 'bank_details' => 'nullable|string|max:255', 'paper_size' => 'required|in:A4,A5',
            'margin_mm' => 'required|integer|min:5|max:25', 'footer_terms' => 'nullable|string|max:2000',
            'signature_left' => 'nullable|string|max:100', 'signature_right' => 'nullable|string|max:100',
            'logo' => 'nullable|string|max:300000',
        ]);
        if (! empty($p['logo'])) {
            abort_unless(preg_match('/^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/', $p['logo']), 422, 'Use a PNG or JPEG logo.');
        }

        return DB::transaction(function () use ($p, $r) {
            BillingFeed::lock();
            $this->admin($r);
            $row = DB::table('company_settings')->where('id', 1)->first();
            abort_if($row->version !== $p['version'], 409, 'Company settings changed. Reload before saving.');
            unset($p['version']);
            DB::table('company_settings')->where('id', 1)->update(['data' => json_encode($p), 'version' => $row->version + 1, 'updated_at' => now()]);
            $data = BillingFeed::settings();
            BillingFeed::append('company', '1', $data);

            return $data;
        });
    }

    public function reviews(Request $r): Collection
    {
        $this->admin($r);

        return DB::table('sync_reviews')->orderByDesc('created_at')->limit(200)->get()->map(fn ($x) => [...(array) $x, 'operation' => json_decode($x->operation, true)]);
    }

    public function review(Request $r, string $id): array
    {
        $this->admin($r);
        DB::table('sync_reviews')->where('id', $id)->update(['status' => 'reviewed', 'reviewed_by' => $r->user()->id, 'updated_at' => now()]);

        return ['ok' => true];
    }

    public function importReviews(Request $r): array
    {
        $this->admin($r);
        $p = $r->validate(['operations' => 'required|array|max:500', 'operations.*.id' => 'required|uuid', 'operations.*.device_id' => 'required|uuid', 'operations.*.actor_id' => 'required|integer|exists:users,id', 'operations.*.entity_id' => 'required|uuid', 'operations.*.type' => 'required|in:customer.save,vehicle.save,invoice.save,invoice.issue,invoice.cancel', 'operations.*.payload' => 'present|array']);

        return DB::transaction(function () use ($p) {
            foreach ($p['operations'] as $operation) {
                abort_unless(DB::table('devices')->where('id', $operation['device_id'])->where('user_id', $operation['actor_id'])->exists(), 422, 'Backup actor does not match the original registered device.');
                DB::table('sync_reviews')->insertOrIgnore(['id' => $operation['id'], 'actor_id' => $operation['actor_id'], 'device_id' => $operation['device_id'], 'operation' => json_encode($operation), 'error' => 'Imported from encrypted backup for administrator review. Original authorship retained; no operation was executed.', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()]);
            }

            return ['ok' => true];
        });
    }
}
