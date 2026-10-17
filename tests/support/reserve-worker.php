<?php

use App\Http\Controllers\BillingController;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$r = Request::create('/api/number-allocations', 'POST', ['id' => (string) Str::uuid(), 'device_id' => $argv[1]]);
$user = User::findOrFail((int) $argv[2]);
$r->setUserResolver(fn () => $user);
echo json_encode((new BillingController)->reserve($r));
