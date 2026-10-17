<?php

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Str;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('local') || ! str_starts_with(config('database.connections.mysql.database'), 'sinlink')) {
    throw new RuntimeException('Browser fixture setup is restricted to a local Sinlink database.');
}
(new DatabaseSeeder)->run();
$password = Str::password(24);
$email = 'browser-'.strtolower(Str::random(6)).'@example.test';
$user = User::create(['name' => 'Browser Administrator', 'email' => $email, 'password' => $password, 'role' => 'admin', 'active' => true]);
@mkdir(storage_path('test-artifacts'), 0700, true);
file_put_contents(storage_path('test-artifacts/login.json'), json_encode(['email' => $email, 'password' => $password, 'id' => $user->id]));
chmod(storage_path('test-artifacts/login.json'), 0600);
echo "Created a random local browser-test account. Credentials: storage/test-artifacts/login.json (ignored).\n";
