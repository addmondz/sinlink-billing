<?php

use Illuminate\Support\Facades\Route;

// Serve the exact same cacheable shell as Vite. No embedded user or CSRF data.
Route::get('/{path?}', function (string $path = '') {
    abort_if(str_starts_with($path, 'api/') || str_starts_with($path, 'sanctum/'), 404);
    $file = public_path('app/'.$path);
    if ($path !== '' && ! str_contains($path, '..') && is_file($file)) {
        $ext = pathinfo($file, PATHINFO_EXTENSION);
        $types = ['js' => 'application/javascript', 'css' => 'text/css', 'webmanifest' => 'application/manifest+json', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'ttf' => 'font/ttf', 'woff2' => 'font/woff2', 'html' => 'text/html'];

        return response()->file($file, ['Content-Type' => $types[$ext] ?? 'application/octet-stream', 'Service-Worker-Allowed' => '/', 'Cache-Control' => str_starts_with($path, 'assets/') ? 'public, max-age=31536000, immutable' : 'no-cache']);
    }
    abort_unless(is_file(public_path('app/index.html')), 503, 'Run npm run build, or use the Vite development server.');

    return response()->file(public_path('app/index.html'), ['Cache-Control' => 'no-cache']);
})->where('path', '.*');
