<?php

foreach ([192, 512] as $size) {
    $im = imagecreatetruecolor($size, $size);
    $bg = imagecolorallocate($im, 15, 76, 69);
    $fg = imagecolorallocate($im, 255, 255, 255);
    imagefill($im, 0, 0, $bg);
    $s = $size / 192;
    imagefilledrectangle($im, (int) (48 * $s), (int) (55 * $s), (int) (143 * $s), (int) (72 * $s), $fg);
    imagefilledrectangle($im, (int) (48 * $s), (int) (55 * $s), (int) (65 * $s), (int) (103 * $s), $fg);
    imagefilledrectangle($im, (int) (48 * $s), (int) (87 * $s), (int) (143 * $s), (int) (104 * $s), $fg);
    imagefilledrectangle($im, (int) (126 * $s), (int) (87 * $s), (int) (143 * $s), (int) (137 * $s), $fg);
    imagefilledrectangle($im, (int) (48 * $s), (int) (120 * $s), (int) (143 * $s), (int) (137 * $s), $fg);
    imagepng($im, __DIR__.'/../resources/static/icon-'.$size.'.png');
}
