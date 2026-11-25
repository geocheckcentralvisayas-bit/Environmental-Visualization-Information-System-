# Generates desktop\assets\envis.ico from code, so the app has a real icon
# without adding binary art to the repository.
#
# The mark is three rising bars (the dashboard's growth/chart motif) in the
# ENVIS emerald palette on the app's dark background.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path $here 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$icoPath = Join-Path $assets 'envis.ico'

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [single]($r * 2)
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $inset = [single]($size * 0.03)
    $side = [single]($size - ($inset * 2))
    $radius = [single]([math]::Max(2, $size * 0.22))
    $tile = New-RoundedPath $inset $inset $side $side $radius

    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 12, 34, 27),
        [System.Drawing.Color]::FromArgb(255, 3, 9, 7),
        90.0)
    $g.FillPath($bg, $tile)
    $bg.Dispose()

    $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 110, 231, 183)), ([single][math]::Max(0.6, $size * 0.012))
    $g.DrawPath($edge, $tile)
    $edge.Dispose()

    # Three rising bars, mirrored from the dashboard's accent colors.
    $colors = @(
        [System.Drawing.Color]::FromArgb(255, 52, 211, 153),
        [System.Drawing.Color]::FromArgb(255, 110, 231, 183),
        [System.Drawing.Color]::FromArgb(255, 16, 185, 129)
    )
    $heights = @(0.30, 0.46, 0.62)
    $barWidth = [single]($size * 0.135)
    $gap = [single]($size * 0.070)
    $groupWidth = ($barWidth * 3) + ($gap * 2)
    $x = [single](($size - $groupWidth) / 2)
    $baseline = [single]($size * 0.755)

    for ($i = 0; $i -lt 3; $i++) {
        $barHeight = [single]($size * $heights[$i])
        $barRadius = [single]([math]::Max(0.5, $barWidth * 0.34))
        $bar = New-RoundedPath $x ($baseline - $barHeight) $barWidth $barHeight $barRadius
        $brush = New-Object System.Drawing.SolidBrush $colors[$i]
        $g.FillPath($brush, $bar)
        $brush.Dispose()
        $bar.Dispose()
        $x += $barWidth + $gap
    }

    # Baseline under the bars.
    $line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(160, 110, 231, 183)), ([single][math]::Max(0.6, $size * 0.014))
    $g.DrawLine($line, [single]($size * 0.20), [single]($size * 0.80), [single]($size * 0.80), [single]($size * 0.80))
    $line.Dispose()

    $tile.Dispose()
    $g.Dispose()
    return $bmp
}

# Classic 32-bit DIB frames (not PNG-compressed). Every Windows version and
# every .NET Icon reader understands these, including the 256 px frame.
function Get-IconFrameBytes([System.Drawing.Bitmap]$bmp) {
    $size = $bmp.Width
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)

    # BITMAPINFOHEADER: height is doubled to reserve room for the AND mask.
    $writer.Write([uint32]40)
    $writer.Write([int32]$size)
    $writer.Write([int32]($size * 2))
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]0)
    $writer.Write([uint32]($size * $size * 4))
    $writer.Write([int32]0)
    $writer.Write([int32]0)
    $writer.Write([uint32]0)
    $writer.Write([uint32]0)

    # XOR bitmap: BGRA, bottom-up.
    for ($y = $size - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $size; $x++) {
            $color = $bmp.GetPixel($x, $y)
            $writer.Write([byte]$color.B)
            $writer.Write([byte]$color.G)
            $writer.Write([byte]$color.R)
            $writer.Write([byte]$color.A)
        }
    }

    # AND mask: 1 bit per pixel, rows padded to 32 bits. A set bit is transparent.
    $rowBytes = [int]([math]::Ceiling($size / 32.0) * 4)
    for ($y = $size - 1; $y -ge 0; $y--) {
        $row = New-Object byte[] $rowBytes
        for ($x = 0; $x -lt $size; $x++) {
            if ($bmp.GetPixel($x, $y).A -lt 128) {
                $index = [int][math]::Floor($x / 8)
                $row[$index] = $row[$index] -bor ([byte](0x80 -shr ($x % 8)))
            }
        }
        $writer.Write($row)
    }

    $writer.Flush()
    $bytes = $stream.ToArray()
    $writer.Dispose()
    $stream.Dispose()
    return $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
    $bmp = New-IconBitmap $size
    $frames.Add((Get-IconFrameBytes $bmp))
    $bmp.Dispose()
}

$file = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
for ($i = 0; $i -lt $frames.Count; $i++) {
    $size = $sizes[$i]
    $dimension = if ($size -ge 256) { 0 } else { $size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frames[$i].Length)
    $writer.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
$writer.Flush()
$writer.Close()

# Prove the file is readable before handing it to the build.
$icon = New-Object System.Drawing.Icon($icoPath)
Write-Output ("icon written: {0} ({1:N0} bytes, {2}x{3})" -f $icoPath, (Get-Item $icoPath).Length, $icon.Width, $icon.Height)
$icon.Dispose()
