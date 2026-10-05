# The "Updating DHVANI" window shown during an in-app update.
#
# desktop/installer.nsh starts this when a silent update begins and writes the
# current stage (closing | installing | finishing | reopening) to -StatusFile as
# it goes. The window stays up until the new version's window appears, so there
# is no blank stretch between the old app closing and the new one opening.
#
# Keep this file ASCII: Windows PowerShell reads a BOM-less script as ANSI.

param(
  [Parameter(Mandatory = $true)][string]$StatusFile,
  [Parameter(Mandatory = $true)][string]$AppExe,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$FromVersion = '',
  [string]$Icon = '',
  [int]$InstallerPid = 0
)

$ErrorActionPreference = 'Stop'

# Native helpers: DPI awareness (without it Windows stretches the window on a
# scaled display and everything goes soft) and the Windows 11 rounded corners,
# border and shadow, which DWM draws so the content can stay a plain opaque
# window with crisp ClearType text.
try {
  Add-Type -Namespace DhvaniSplash -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("dwmapi.dll")]
public static extern int DwmSetWindowAttribute(System.IntPtr hwnd, int attribute, ref int value, int size);
'@
  # Per-monitor v2, else system-aware on older Windows 10.
  if (-not [DhvaniSplash.Native]::SetProcessDpiAwarenessContext([IntPtr]-4)) {
    [void][DhvaniSplash.Native]::SetProcessDPIAware()
  }
  $script:native = $true
} catch {
  $script:native = $false
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# How long to wait for the new window once the installer is done, and an outer
# limit so a stuck install never leaves the window up for good.
$reopenTimeout = [TimeSpan]::FromSeconds(30)
$overallTimeout = [TimeSpan]::FromMinutes(15)

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Updating DHVANI" Width="420" SizeToContent="Height"
        WindowStyle="None" ResizeMode="NoResize" Background="#16171D"
        Topmost="True" ShowInTaskbar="True" WindowStartupLocation="CenterScreen"
        UseLayoutRounding="True" SnapsToDevicePixels="True"
        TextOptions.TextFormattingMode="Display" TextOptions.TextRenderingMode="ClearType"
        RenderOptions.ClearTypeHint="Enabled">
  <Grid>
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <StackPanel Grid.Row="0" Margin="24,22,24,18">
      <DockPanel LastChildFill="True">
        <Image x:Name="AppIcon" Width="44" Height="44" DockPanel.Dock="Left" Margin="0,0,14,0"
               RenderOptions.BitmapScalingMode="Fant"/>
        <StackPanel VerticalAlignment="Center">
          <TextBlock x:Name="Heading" Text="Updating DHVANI" FontFamily="Segoe UI Variable Display Semibold, Segoe UI Semibold"
                     FontSize="16" Foreground="#F1F2F7"/>
          <TextBlock x:Name="Versions" Margin="0,3,0,0" FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="12.5" Foreground="#9A9EB2"/>
        </StackPanel>
      </DockPanel>

      <Border x:Name="Track" Height="4" Margin="0,18,0,14" CornerRadius="2" Background="#262833" ClipToBounds="True">
        <Canvas>
          <Rectangle Width="110" Height="4" RadiusX="2" RadiusY="2" Fill="#7C6CF2">
            <Rectangle.RenderTransform><TranslateTransform x:Name="ShimmerX" X="-110"/></Rectangle.RenderTransform>
          </Rectangle>
        </Canvas>
      </Border>

      <StackPanel x:Name="Steps"/>
    </StackPanel>

    <Border Grid.Row="1" Background="#1B1C23" BorderBrush="#262833" BorderThickness="0,1,0,0" Padding="24,11">
      <DockPanel>
        <TextBlock DockPanel.Dock="Right" Text="Keep your PC on" FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="11.5" Foreground="#7A7E90"/>
        <StackPanel Orientation="Horizontal">
          <TextBlock Text="&#xE72E;" FontFamily="Segoe Fluent Icons, Segoe MDL2 Assets" FontSize="11" Foreground="#7A7E90" VerticalAlignment="Center" Margin="0,1,7,0"/>
          <TextBlock Text="Your projects and API keys stay as they are" FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="11.5" Foreground="#7A7E90"/>
        </StackPanel>
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

$window = [Windows.Markup.XamlReader]::Parse($xaml)
$find = { param($name) $window.FindName($name) }

$arrow = [char]0x2192
(& $find 'Versions').Text = if ($FromVersion -and $FromVersion -ne $Version) { "Version $FromVersion  $arrow  $Version" } else { "Version $Version" }

$window.Add_SourceInitialized({
  $hwnd = (New-Object Windows.Interop.WindowInteropHelper($window)).Handle
  if ($script:native) {
    try {
      $round = 2                                        # DWMWCP_ROUND
      [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 33, [ref]$round, 4)
      $border = 0x00362C2A                              # #2A2C36 as COLORREF (BGR)
      [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 34, [ref]$border, 4)
      $dark = 1                                         # DWMWA_USE_IMMERSIVE_DARK_MODE
      [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 20, [ref]$dark, 4)
    } catch { }
  }

  # Decode the icon at exactly the pixel size it's drawn at, so it isn't
  # resampled twice. OnLoad reads the file now and lets it go, so the installer
  # can clean up its temp folder while the window is still open.
  if ($Icon -and (Test-Path -LiteralPath $Icon)) {
    try {
      $scale = [Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformToDevice.M11
      $bitmap = New-Object Windows.Media.Imaging.BitmapImage
      $bitmap.BeginInit()
      $bitmap.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bitmap.DecodePixelWidth = [int][Math]::Round(44 * $scale)
      $bitmap.UriSource = New-Object Uri($Icon)
      $bitmap.EndInit()
      (& $find 'AppIcon').Source = $bitmap
    } catch { }
  }
})

# --- Steps -------------------------------------------------------------------

$labels = @(
  'Closing DHVANI',
  'Installing the new version',
  'Keeping your projects and settings',
  'Reopening DHVANI'
)
$brush = { param($hex) (New-Object Windows.Media.BrushConverter).ConvertFromString($hex) }
$rows = @()
$stepsPanel = & $find 'Steps'
foreach ($label in $labels) {
  $row = New-Object Windows.Controls.StackPanel
  $row.Orientation = 'Horizontal'
  $row.Margin = '0,5,0,5'

  $glyph = New-Object Windows.Controls.TextBlock
  $glyph.FontFamily = 'Segoe Fluent Icons, Segoe MDL2 Assets'
  $glyph.FontSize = 13
  $glyph.Width = 16
  $glyph.TextAlignment = 'Center'
  $glyph.VerticalAlignment = 'Center'
  $glyph.Margin = '0,0,10,0'
  $glyph.RenderTransformOrigin = '0.5,0.5'
  $glyph.RenderTransform = New-Object Windows.Media.RotateTransform

  $text = New-Object Windows.Controls.TextBlock
  $text.Text = $label
  $text.FontFamily = 'Segoe UI Variable Text, Segoe UI'
  $text.FontSize = 13
  $text.VerticalAlignment = 'Center'

  [void]$row.Children.Add($glyph)
  [void]$row.Children.Add($text)
  [void]$stepsPanel.Children.Add($row)
  $rows += , @($glyph, $text)
}

$spin = New-Object Windows.Media.Animation.DoubleAnimation(0, 360, [TimeSpan]::FromSeconds(1))
$spin.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever

$script:shown = -1
function Show-Step([int]$current) {
  if ($current -le $script:shown) { return }
  $script:shown = $current
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $glyph, $text = $rows[$i]
    $rotate = $glyph.RenderTransform
    $rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $null)
    if ($i -lt $current) {
      $glyph.Text = [string][char]0xE73E   # CheckMark
      $glyph.Foreground = & $brush '#4ADE80'
      $text.Foreground = & $brush '#9AA0B4'
    } elseif ($i -eq $current) {
      $glyph.Text = [string][char]0xE895   # Sync
      $glyph.Foreground = & $brush '#8B7CF6'
      $text.Foreground = & $brush '#ECEEF5'
      $rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $spin)
    } else {
      $glyph.Text = [string][char]0xEA3A   # CircleRing
      $glyph.Foreground = & $brush '#4A4D5C'
      $text.Foreground = & $brush '#6F7385'
    }
  }
}
Show-Step 0

# --- Progress shimmer --------------------------------------------------------
# The installer doesn't report a real percentage, so the bar only shows that
# work is happening; the steps carry the actual progress.

$window.Add_Loaded({
  $width = (& $find 'Track').ActualWidth
  $slide = New-Object Windows.Media.Animation.DoubleAnimation(-110, $width, [TimeSpan]::FromSeconds(1.4))
  $slide.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
  $slide.EasingFunction = New-Object Windows.Media.Animation.SineEase
  (& $find 'ShimmerX').BeginAnimation([Windows.Media.TranslateTransform]::XProperty, $slide)
})

# Lets the user move it out of the way.
$window.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch { } })

# --- Following the installer -------------------------------------------------

$stageIndex = @{ closing = 0; installing = 1; finishing = 2; reopening = 3 }
$started = [DateTime]::UtcNow
$script:reopeningSince = $null
$script:closingDone = $false

$appName = [IO.Path]::GetFileNameWithoutExtension($AppExe)
function Get-AppProcesses {
  Get-Process -Name $appName -ErrorAction SilentlyContinue |
    Where-Object { try { $_.Path -and $_.Path -eq $AppExe } catch { $false } }
}

function Read-Stage {
  try {
    if (Test-Path -LiteralPath $StatusFile) {
      return ([IO.File]::ReadAllText($StatusFile)).Trim().ToLowerInvariant()
    }
  } catch { }
  return ''
}

$finish = {
  $timer.Stop()
  $window.Close()
}

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(300)
$timer.Add_Tick({
  try {
    $installerAlive = $InstallerPid -le 0 -or [bool](Get-Process -Id $InstallerPid -ErrorAction SilentlyContinue)
    $stage = Read-Stage
    $step = if ($stageIndex.ContainsKey($stage)) { $stageIndex[$stage] } else { 0 }
    if (-not $installerAlive) { $step = 3 }

    # The installer has no hook between closing the app and copying files, so
    # "closing" ends once the old app's processes are gone.
    if ($step -eq 0) {
      if (-not (Get-AppProcesses)) { $step = 1 }
    }
    Show-Step $step

    if ($script:shown -ge 3) {
      if (-not $script:reopeningSince) { $script:reopeningSince = [DateTime]::UtcNow }
      $opened = Get-AppProcesses | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
      if ($opened) {
        Show-Step 4
        (& $find 'Heading').Text = 'DHVANI is up to date'
        $timer.Stop()
        $script:hold = New-Object Windows.Threading.DispatcherTimer
        $script:hold.Interval = [TimeSpan]::FromMilliseconds(700)
        $script:hold.Add_Tick({ $script:hold.Stop(); & $finish })
        $script:hold.Start()
        return
      }
      if (([DateTime]::UtcNow - $script:reopeningSince) -gt $reopenTimeout) { & $finish; return }
    }

    if (([DateTime]::UtcNow - $started) -gt $overallTimeout) { & $finish }
  } catch {
    & $finish
  }
})
$timer.Start()

[void]$window.ShowDialog()
