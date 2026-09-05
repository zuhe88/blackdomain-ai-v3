param(
  [Parameter(Mandatory = $true)][string]$PrimarySheet,
  [Parameter(Mandatory = $true)][string]$GemSheet,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

Add-Type -AssemblyName System.Drawing

function Export-Symbol {
  param(
    [System.Drawing.Bitmap]$Source,
    [string]$Name,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  $canvas = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $padding = 14
  $available = 256 - ($padding * 2)
  $scale = [Math]::Min($available / $Width, $available / $Height)
  $drawWidth = [int]($Width * $scale)
  $drawHeight = [int]($Height * $scale)
  $destination = New-Object System.Drawing.Rectangle ([int]((256 - $drawWidth) / 2)), ([int]((256 - $drawHeight) / 2)), $drawWidth, $drawHeight
  $sourceRect = New-Object System.Drawing.Rectangle $X, $Y, $Width, $Height
  $graphics.DrawImage($Source, $destination, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()

  for ($py = 0; $py -lt $canvas.Height; $py++) {
    for ($px = 0; $px -lt $canvas.Width; $px++) {
      $color = $canvas.GetPixel($px, $py)
      $brightness = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
      if ($brightness -le 18) {
        $canvas.SetPixel($px, $py, [System.Drawing.Color]::Transparent)
      } elseif ($brightness -lt 48) {
        $alpha = [int](255 * (($brightness - 18) / 30))
        $canvas.SetPixel($px, $py, [System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B))
      }
    }
  }

  # The source tables contain thin horizontal chart borders. They span nearly
  # the full crop, unlike any symbol, so remove those rows without erasing the
  # original blue and purple details inside the artwork.
  for ($py = 0; $py -lt $canvas.Height; $py++) {
    $darkRun = 0
    for ($px = 0; $px -lt $canvas.Width; $px++) {
      $color = $canvas.GetPixel($px, $py)
      if ($color.A -gt 0 -and $color.R -lt 100 -and $color.G -lt 125 -and $color.B -lt 155) {
        $darkRun++
      }
    }
    if ($darkRun -gt 140) {
      for ($px = 0; $px -lt $canvas.Width; $px++) {
        $canvas.SetPixel($px, $py, [System.Drawing.Color]::Transparent)
      }
    }
  }

  $path = Join-Path $OutputDirectory "$Name.png"
  $canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
  Write-Output $path
}

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$primary = [System.Drawing.Bitmap]::FromFile($PrimarySheet)
$gems = [System.Drawing.Bitmap]::FromFile($GemSheet)

try {
  Export-Symbol $primary "eye" 118 218 126 108
  Export-Symbol $primary "staff" 478 218 132 108
  Export-Symbol $primary "bow" 830 218 138 108
  Export-Symbol $primary "blade" 120 642 124 108
  Export-Symbol $primary "seth" 474 642 128 110
  Export-Symbol $primary "goddess" 838 642 128 110

  Export-Symbol $gems "yellow" 154 190 84 84
  Export-Symbol $gems "red" 512 190 84 84
  Export-Symbol $gems "purple" 872 190 84 84
  Export-Symbol $gems "blue" 152 610 84 84
  Export-Symbol $gems "green" 512 610 84 84
} finally {
  $primary.Dispose()
  $gems.Dispose()
}
