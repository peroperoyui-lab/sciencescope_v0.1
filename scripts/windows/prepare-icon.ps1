$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputDir = Join-Path $root '.sciencescope-local\desktop-assets'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'reference\ScienceScope_Logo.png'))
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $rounded = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
        $rounded.AddArc(0,0,56,56,180,90)
        $rounded.AddArc(200,0,56,56,270,90)
        $rounded.AddArc(200,200,56,56,0,90)
        $rounded.AddArc(0,200,56,56,90,90)
        $rounded.CloseFigure()
        $graphics.SetClip($rounded)
        $graphics.FillPath([System.Drawing.Brushes]::White,$rounded)
    } finally { $rounded.Dispose() }
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scale = [Math]::Min(216.0 / $source.Width,216.0 / $source.Height)
    $width = [int]($source.Width * $scale)
    $height = [int]($source.Height * $scale)
    $graphics.DrawImage($source,[int]((256-$width)/2),[int]((256-$height)/2),$width,$height)
    $png = New-Object System.IO.MemoryStream
    try {
        $bitmap.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $png.ToArray()
        $stream = [System.IO.File]::Create((Join-Path $outputDir 'icon.ico'))
        $writer = New-Object System.IO.BinaryWriter($stream)
        try {
            $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
            $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22)
            $writer.Write($bytes)
        } finally { $writer.Dispose(); $stream.Dispose() }
    } finally { $png.Dispose() }
} finally { $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose() }
