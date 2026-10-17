<?php

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    public function createApplication(): Application
    {
        $app = parent::createApplication();
        $database = $app['config']->get('database.connections.mysql.database');
        if (! $app->environment('testing') || ! str_ends_with((string) $database, '_testing')) {
            throw new \RuntimeException('Tests require APP_ENV=testing and a MySQL database ending in _testing.');
        }

        return $app;
    }
}
