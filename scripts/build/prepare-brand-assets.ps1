$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

<##
  Prepare the OsecBox brand mark for the surfaces that use native icon files.

  This script is intentionally Windows-hosted because System.Drawing is used
  only at build time. The generated PNG/ICO/ICNS files are committed/packaged
  outputs; no image library is added to the Electron runtime.
##>

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildDir = Join-Path $root 'build'
$publicDir = Join-Path $root 'client\public'
$sourcePath = Join-Path $buildDir 'brand-source.png'

Add-Type -AssemblyName System.Drawing

function New-BrandBitmap {
  param(
    [System.Drawing.Image]$Source,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 4, 4, 7))

    $cropSide = [Math]::Min($Source.Width, $Source.Height)
    $cropX = [int][Math]::Floor(($Source.Width - $cropSide) / 2)
    $cropY = [int][Math]::Floor(($Source.Height - $cropSide) / 2)
    $sourceRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSide, $cropSide)
    $targetRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $graphics.DrawImage($Source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  }
  finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Get-PngBytes {
  param([System.Drawing.Bitmap]$Bitmap)

  $stream = New-Object System.IO.MemoryStream
  try {
    $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.ToArray()
  }
  finally {
    $stream.Dispose()
  }
}

function Write-Ico {
  param(
    [string]$Path,
    [hashtable]$Frames
  )

  $orderedFrames = @($Frames.GetEnumerator() | Sort-Object { [int]$_.Key })
  $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$orderedFrames.Count)

    $offset = 6 + (16 * $orderedFrames.Count)
    foreach ($frame in $orderedFrames) {
      $size = [int]$frame.Key
      $data = [byte[]]$frame.Value
      $dimension = if ($size -ge 256) { [byte]0 } else { [byte]$size }
      $writer.Write($dimension)
      $writer.Write($dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$data.Length)
      $writer.Write([uint32]$offset)
      $offset += $data.Length
    }

    foreach ($frame in $orderedFrames) {
      $writer.Write([byte[]]$frame.Value)
    }
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

function Write-BigEndianUInt32 {
  param(
    [System.IO.BinaryWriter]$Writer,
    [uint32]$Value
  )

  $Writer.Write([byte](($Value -shr 24) -band 0xff))
  $Writer.Write([byte](($Value -shr 16) -band 0xff))
  $Writer.Write([byte](($Value -shr 8) -band 0xff))
  $Writer.Write([byte]($Value -band 0xff))
}

function Write-Ascii {
  param(
    [System.IO.BinaryWriter]$Writer,
    [string]$Value
  )

  $Writer.Write([System.Text.Encoding]::ASCII.GetBytes($Value))
}

function Write-Icns {
  param(
    [string]$Path,
    [hashtable]$Frames
  )

  $typeBySize = @{
    128 = 'ic07'
    256 = 'ic08'
    512 = 'ic09'
    1024 = 'ic10'
  }
  $orderedFrames = @($Frames.GetEnumerator() | Where-Object { $typeBySize.ContainsKey([int]$_.Key) } | Sort-Object { [int]$_.Key })
  $totalLength = 8
  foreach ($frame in $orderedFrames) {
    $totalLength += 8 + ([byte[]]$frame.Value).Length
  }

  $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    Write-Ascii $writer 'icns'
    Write-BigEndianUInt32 $writer ([uint32]$totalLength)
    foreach ($frame in $orderedFrames) {
      Write-Ascii $writer $typeBySize[[int]$frame.Key]
      Write-BigEndianUInt32 $writer ([uint32](8 + ([byte[]]$frame.Value).Length))
      $writer.Write([byte[]]$frame.Value)
    }
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Brand source not found: $sourcePath"
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
$bitmaps = @{}
$pngFrames = @{}
try {
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512, 1024)) {
    $bitmap = New-BrandBitmap -Source $source -Size $size
    $bitmaps[$size] = $bitmap
    $pngFrames[$size] = Get-PngBytes -Bitmap $bitmap
  }

  $bitmaps[1024].Save((Join-Path $buildDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmaps[512].Save((Join-Path $publicDir 'osecbox-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmaps[64].Save((Join-Path $publicDir 'favicon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $icoFrames = @{}
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $icoFrames[$size] = $pngFrames[$size]
  }
  Write-Ico -Path (Join-Path $buildDir 'icon.ico') -Frames $icoFrames
  Write-Icns -Path (Join-Path $buildDir 'icon.icns') -Frames $pngFrames
}
finally {
  foreach ($bitmap in $bitmaps.Values) {
    $bitmap.Dispose()
  }
  $source.Dispose()
}

Write-Output "Prepared OsecBox brand assets in $buildDir and $publicDir"
