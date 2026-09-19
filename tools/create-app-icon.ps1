param(
  [string]$Source = "assets\app-icon.png",
  [string]$Destination = "assets\app-icon.ico"
)

Add-Type -AssemblyName System.Drawing

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngImages = @()

try {
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $scale = [Math]::Min($size / $sourceImage.Width, $size / $sourceImage.Height)
      $width = [int]($sourceImage.Width * $scale)
      $height = [int]($sourceImage.Height * $scale)
      $x = [int](($size - $width) / 2)
      $y = [int](($size - $height) / 2)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceImage, $x, $y, $width, $height)
    } finally {
      $graphics.Dispose()
    }
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngImages += ,@($size, $stream.ToArray())
    $stream.Dispose()
    $bitmap.Dispose()
  }

  $directory = Split-Path -Parent $Destination
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $destinationPath = [System.IO.Path]::GetFullPath($Destination)
  $output = New-Object System.IO.FileStream($destinationPath, [System.IO.FileMode]::Create)
  try {
    $writer = New-Object System.IO.BinaryWriter($output)
    $count = $sizes.Count
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$count)
    $offset = 6 + (16 * $count)
    foreach ($item in $pngImages) {
      $size = [int]$item[0]
      $bytes = [byte[]]$item[1]
      $writer.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
      $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $bytes.Length
    }
    foreach ($item in $pngImages) { $writer.Write([byte[]]$item[1]) }
    $writer.Flush()
  } finally {
    $output.Dispose()
  }
} finally {
  $sourceImage.Dispose()
}
