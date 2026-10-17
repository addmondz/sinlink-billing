<?php

use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Validator;

// Artisan::command('sinlink:admin {email?} {--name=Administrator}', function () {
//     $email = $this->argument('email') ?: $this->ask('Administrator email');
//     $password = $this->secret('Password (at least 12 characters)');
//     Validator::make(['email' => $email, 'password' => $password], ['email' => 'required|email|unique:users,email', 'password' => 'required|string|min:12|max:128'])->validate();
//     User::create(['name' => $this->option('name'), 'email' => $email, 'password' => $password, 'role' => 'admin', 'active' => true]);
//     $this->info('Administrator created. No default credentials are shipped.');
// })->purpose('Create an administrator using a hidden password prompt');
