<?php

use App\Http\Controllers\BillingController as B;
use App\Http\Middleware\ActiveAccount;
use Illuminate\Support\Facades\Route;

Route::prefix('api')->group(function () {
    Route::get('/csrf', fn () => response()->json(['token' => csrf_token()])->header('Cache-Control', 'no-store'));
    Route::post('/login', [B::class, 'login'])->middleware('throttle:8,1,login-');
    Route::middleware(['auth:sanctum', ActiveAccount::class])->group(function () {
        Route::get('/me', [B::class, 'me']);
        Route::put('/preferences', [B::class, 'savePreferences']);
        Route::post('/logout', [B::class, 'logout']);
        Route::post('/devices', [B::class, 'registerDevice']);
        Route::post('/number-allocations', [B::class, 'reserve'])->middleware('throttle:20,1,reserve-');
        Route::post('/sync/push', [B::class, 'push'])->middleware('throttle:120,1,sync-');
        Route::get('/sync/pull', [B::class, 'pull']);
        Route::get('/invoices', [B::class, 'invoices']);
        Route::get('/invoices/{id}', [B::class, 'invoice']);
        Route::get('/customers', [B::class, 'customers']);
        Route::get('/customers/{id}', [B::class, 'customer']);
        Route::get('/vehicles', [B::class, 'vehicles']);
        Route::get('/vehicles/{id}', [B::class, 'vehicle']);
        Route::get('/staff', [B::class, 'staff']);
        Route::post('/staff', [B::class, 'saveStaff']);
        Route::put('/staff/{id}', [B::class, 'saveStaff']);
        Route::get('/settings', [B::class, 'settings']);
        Route::put('/settings', [B::class, 'saveSettings']);
        Route::get('/sync/reviews', [B::class, 'reviews']);
        Route::post('/sync/reviews/import', [B::class, 'importReviews']);
        Route::post('/sync/reviews/{id}', [B::class, 'review']);
    });
});
