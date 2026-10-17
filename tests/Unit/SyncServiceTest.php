<?php

namespace Tests\Unit;

use App\Services\SyncService;
use PHPUnit\Framework\Attributes\TestWith;
use PHPUnit\Framework\TestCase;

class SyncServiceTest extends TestCase
{
    #[TestWith(['162726866', '+60162726866'])]
    #[TestWith(['60162726866', '+60162726866'])]
    #[TestWith(['0162726866', '+60162726866'])]
    #[TestWith(['+60 16-272 6866', '+60162726866'])]
    #[TestWith(['0060 (16) 272.6866', '+60162726866'])]
    #[TestWith(['+60 (0)16 2726866', '+60162726866'])]
    #[TestWith(['01123456789', '+601123456789'])]
    #[TestWith(['1123456789', '+601123456789'])]
    #[TestWith(['03-1234 5678', '+60312345678'])]
    #[TestWith(['312345678', '+60312345678'])]
    #[TestWith(['04-123 4567', '+6041234567'])]
    #[TestWith(['41234567', '+6041234567'])]
    #[TestWith(['+65 8123 4567', '+6581234567'])]
    #[TestWith(['0044 7777 123456', '+447777123456'])]
    #[TestWith(['447777123456', '+447777123456'])]
    #[TestWith(['+1 (202) 555-0123', '+12025550123'])]
    #[TestWith(['+2471234', '+2471234'])]
    #[TestWith(['+123456789012345', '+123456789012345'])]
    public function test_formats_customer_phone_numbers_in_international_format(string $input, string $expected): void
    {
        $this->assertSame($expected, SyncService::formatPhone($input));
        $this->assertSame(substr($expected, 1), SyncService::normalizePhone($input));
    }

    #[TestWith([''])]
    #[TestWith(['   '])]
    #[TestWith(['0123'])]
    #[TestWith(['123'])]
    #[TestWith(['016272686'])]
    #[TestWith(['16272686'])]
    #[TestWith(['601627268'])]
    #[TestWith(['+6031234567'])]
    #[TestWith(['+60412345678'])]
    #[TestWith(['0000000000'])]
    #[TestWith(['+060162726866'])]
    #[TestWith(['++60162726866'])]
    #[TestWith(['60+162726866'])]
    #[TestWith(['0162726866 ext 9'])]
    #[TestWith(['call 0162726866'])]
    #[TestWith(['0162726866 / 0123456789'])]
    #[TestWith(['+1234567890123456'])]
    public function test_identifies_invalid_customer_phone_numbers(string $input): void
    {
        $this->assertNull(SyncService::formatPhone($input));
    }
}
