<?php

namespace App\Services;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class Money
{
    public static function calculate(array $items): array
    {
        Validator::make(['items' => $items], [
            'items' => 'required|array|min:1|max:500', 'items.*.id' => 'required|uuid|distinct',
            'items.*.description' => 'required|string|max:4000',
            'items.*.quantity' => ['required', 'regex:/^\d{1,7}(\.\d{1,3})?$/'],
            'items.*.unit' => 'required|string|max:20',
            'items.*.unit_price' => ['required', 'regex:/^\d{1,7}(\.\d{1,2})?$/'],
        ])->validate();
        $total = 0;
        $quantity = '0.000';
        $lines = [];
        foreach ($items as $index => $item) {
            if (bccomp($item['quantity'], '0', 3) <= 0) {
                throw ValidationException::withMessages(['quantity' => 'Quantity must be greater than zero.']);
            }
            // Positive MYR, round half up to a sen for each line, then sum integer sen.
            $cents = (int) bcadd(bcmul(bcmul($item['quantity'], $item['unit_price'], 5), '100', 3), '0.5', 0);
            $total += $cents;
            $quantity = bcadd($quantity, $item['quantity'], 3);
            $lines[] = ['id' => $item['id'], 'sort_order' => $index, 'description' => $item['description'], 'quantity' => $item['quantity'], 'unit' => $item['unit'], 'unit_price' => $item['unit_price'], 'amount_cents' => $cents];
        }
        if ($total > 9999999999) {
            throw ValidationException::withMessages(['total' => 'Invoice exceeds MYR 99,999,999.99.']);
        }

        return ['items' => $lines, 'total_cents' => $total, 'subtotal_cents' => $total, 'total_quantity' => $quantity];
    }
}
