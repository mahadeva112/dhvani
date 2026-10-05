# The "Installing DHVANI" window shown during an in-app update.
#
# desktop/installer.nsh starts this when a silent update begins and writes the
# current stage (closing | installing | finishing | reopening) to -StatusFile as
# it goes. The window stays up until the new version's window appears, so there
# is no blank stretch between the old app closing and the new one opening.
#
# It continues the app's own "Installing DHVANI" dialog
# (components/UpdateControl.tsx): same slate colours, layout and wording,
# picking up the step list where the app left off. Change the two together.
#
# Keep this file ASCII: Windows PowerShell reads a BOM-less script as ANSI.

param(
  [Parameter(Mandatory = $true)][string]$StatusFile,
  [Parameter(Mandatory = $true)][string]$AppExe,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$FromVersion = '',
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
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern System.IntPtr OpenProcess(int access, bool inherit, int pid);
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern bool CloseHandle(System.IntPtr handle);
[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool QueryFullProcessImageName(System.IntPtr process, int flags, System.Text.StringBuilder name, ref int size);
public static string ImagePath(int pid) {
  System.IntPtr h = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
  if (h == System.IntPtr.Zero) return null;
  try {
    var name = new System.Text.StringBuilder(1024);
    int size = name.Capacity;
    return QueryFullProcessImageName(h, 0, name, ref size) ? name.ToString() : null;
  } finally { CloseHandle(h); }
}
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

# The Tailwind colours the app's dialog uses.
$slate100 = '#F1F5F9'; $slate300 = '#CBD5E1'; $slate500 = '#64748B'
$emerald400 = '#34D399'; $blue400 = '#60A5FA'

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Installing DHVANI" Width="416" SizeToContent="Height"
        WindowStyle="None" ResizeMode="NoResize" Background="#0F172A"
        Topmost="True" ShowInTaskbar="True" WindowStartupLocation="CenterScreen"
        UseLayoutRounding="True" SnapsToDevicePixels="True"
        TextOptions.TextFormattingMode="Display" TextOptions.TextRenderingMode="ClearType"
        RenderOptions.ClearTypeHint="Enabled">
  <StackPanel>
    <Border BorderBrush="#1E293B" BorderThickness="0,0,0,1" Padding="20,16">
      <DockPanel LastChildFill="True">
        <Border Width="38" Height="38" CornerRadius="10" Background="#2563EB" DockPanel.Dock="Left" Margin="0,0,14,0">
          <TextBlock Text="&#xE72C;" FontFamily="Segoe Fluent Icons, Segoe MDL2 Assets" FontSize="17" Foreground="#FFFFFF"
                     HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
        <StackPanel VerticalAlignment="Center">
          <TextBlock x:Name="Heading" FontFamily="Segoe UI Variable Display, Segoe UI" FontWeight="SemiBold"
                     FontSize="18" Foreground="#F1F5F9"/>
          <TextBlock x:Name="Versions" Margin="0,2,0,0" FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="12.5" Foreground="#94A3B8"/>
        </StackPanel>
      </DockPanel>
    </Border>

    <StackPanel Margin="20,16,20,16">
      <StackPanel x:Name="Steps"/>
      <Border x:Name="Track" Height="6" Margin="0,16,0,0" CornerRadius="3" Background="#1E293B" ClipToBounds="True">
        <Canvas>
          <Rectangle x:Name="Bar" Height="6" RadiusX="3" RadiusY="3" Fill="#3B82F6">
            <Rectangle.RenderTransform><TranslateTransform x:Name="BarX"/></Rectangle.RenderTransform>
          </Rectangle>
        </Canvas>
      </Border>
      <TextBlock Margin="0,12,0,0" TextWrapping="Wrap" FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="12" Foreground="#94A3B8"
                 Text="Your keys, settings and projects are kept. DHVANI opens again by itself."/>
    </StackPanel>
  </StackPanel>
</Window>
'@

$window = [Windows.Markup.XamlReader]::Parse($xaml)
$find = { param($name) $window.FindName($name) }

$middot = [char]0x00B7
(& $find 'Heading').Text = "Installing DHVANI $Version"
(& $find 'Versions').Text = if ($FromVersion -and $FromVersion -ne $Version) { "Installed $FromVersion $middot New $Version" } else { "New $Version" }

$window.Add_SourceInitialized({
  if (-not $script:native) { return }
  try {
    $hwnd = (New-Object Windows.Interop.WindowInteropHelper($window)).Handle
    $round = 2                                          # DWMWCP_ROUND
    [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 33, [ref]$round, 4)
    $border = 0x004C392C                                # slate-700/80 over slate-900, as BGR
    [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 34, [ref]$border, 4)
    $dark = 1                                           # DWMWA_USE_IMMERSIVE_DARK_MODE
    [void][DhvaniSplash.Native]::DwmSetWindowAttribute($hwnd, 20, [ref]$dark, 4)
  } catch { }
})

# --- Steps -------------------------------------------------------------------

# Each step's label while pending or running, and once done. The first is the
# step the app's dialog already ticked off.
$labels = @(
  @('Update downloaded', 'Update downloaded'),
  @('Closing DHVANI', 'Closed DHVANI'),
  @('Installing the new version', 'Installed the new version'),
  @('Opening the new version', 'Opened the new version')
)
$brush = { param($hex) (New-Object Windows.Media.BrushConverter).ConvertFromString($hex) }
$geometry = { param($data) [Windows.Media.Geometry]::Parse($data) }

# Drawn like the app's lucide icons (16 px box, thin round stroke) rather than
# taken from an icon font, so they match.
$iconCheck = 'M 13.33,4 L 6,11.33 L 2.67,8'
$iconCircle = 'M 8,1.5 A 6.5,6.5 0 1 1 7.99,1.5'
$iconSpinner = 'M 8,3 A 5,5 0 1 1 3,8'   # three quarters of a ring, like the app's spinner

$rows = @()
$stepsPanel = & $find 'Steps'
for ($n = 0; $n -lt $labels.Count; $n++) {
  $row = New-Object Windows.Controls.StackPanel
  $row.Orientation = 'Horizontal'
  $row.Margin = if ($n -eq 0) { '0' } else { '0,10,0,0' }

  $icon = New-Object Windows.Controls.Grid
  $icon.Width = 16; $icon.Height = 16
  $icon.Margin = '0,0,10,0'
  $icon.VerticalAlignment = 'Center'
  $icon.RenderTransformOrigin = '0.5,0.5'
  $icon.RenderTransform = New-Object Windows.Media.RotateTransform
  $path = New-Object Windows.Shapes.Path
  $path.StrokeThickness = 1.5
  $path.StrokeStartLineCap = 'Round'; $path.StrokeEndLineCap = 'Round'; $path.StrokeLineJoin = 'Round'
  [void]$icon.Children.Add($path)

  $text = New-Object Windows.Controls.TextBlock
  $text.FontFamily = 'Segoe UI Variable Text, Segoe UI'
  $text.FontSize = 13
  $text.VerticalAlignment = 'Center'

  [void]$row.Children.Add($icon)
  [void]$row.Children.Add($text)
  [void]$stepsPanel.Children.Add($row)
  $rows += , @($icon, $path, $text)
}

$spin = New-Object Windows.Media.Animation.DoubleAnimation(0, 360, [TimeSpan]::FromSeconds(1))
$spin.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever

$script:shown = -1
function Show-Step([int]$current) {
  if ($current -le $script:shown) { return }
  $script:shown = $current
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $icon, $path, $text = $rows[$i]
    $icon.RenderTransform.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $null)
    if ($i -lt $current) {
      $path.Data = & $geometry $iconCheck
      $path.Stroke = & $brush $emerald400
      $text.Text = $labels[$i][1]
      $text.Foreground = & $brush $slate300
      $text.FontWeight = 'Normal'
    } elseif ($i -eq $current) {
      $path.Data = & $geometry $iconSpinner
      $path.Stroke = & $brush $blue400
      $text.Text = $labels[$i][0]
      $text.Foreground = & $brush $slate100
      $text.FontWeight = 'Medium'
      $icon.RenderTransform.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $spin)
    } else {
      $path.Data = & $geometry $iconCircle
      $path.Stroke = & $brush $slate500
      $text.Text = $labels[$i][0]
      $text.Foreground = & $brush $slate500
      $text.FontWeight = 'Normal'
    }
  }
}
Show-Step 1

# --- Progress bar ------------------------------------------------------------
# The installer doesn't report a real percentage, so, like the app's dialog, a
# third-width bar sweeps across; the steps carry the actual progress.

$window.Add_Loaded({
  $width = (& $find 'Track').ActualWidth
  (& $find 'Bar').Width = $width / 3
  $slide = New-Object Windows.Media.Animation.DoubleAnimation((-$width / 3), $width, [TimeSpan]::FromSeconds(1.4))
  $slide.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
  $ease = New-Object Windows.Media.Animation.SineEase
  $ease.EasingMode = 'EaseInOut'
  $slide.EasingFunction = $ease
  (& $find 'BarX').BeginAnimation([Windows.Media.TranslateTransform]::XProperty, $slide)
})

# Lets the user move it out of the way.
$window.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch { } })

# --- Following the installer -------------------------------------------------

# Rows: 0 downloaded (already done), 1 closing, 2 installing, 3 opening.
$stageIndex = @{ closing = 1; installing = 2; finishing = 2; reopening = 3 }
$started = [DateTime]::UtcNow
$script:reopeningSince = $null

$appName = [IO.Path]::GetFileNameWithoutExtension($AppExe)
# Process.Path can't see a 64-bit process from a 32-bit PowerShell (it comes
# back empty), so ask Windows for the image path directly when we can.
function Get-ProcessPath($process) {
  if ($script:native) {
    try { return [DhvaniSplash.Native]::ImagePath($process.Id) } catch { }
  }
  try { return $process.Path } catch { return $null }
}
function Get-AppProcesses {
  Get-Process -Name $appName -ErrorAction SilentlyContinue |
    Where-Object { (Get-ProcessPath $_) -eq $AppExe }
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
    $step = if ($stageIndex.ContainsKey($stage)) { $stageIndex[$stage] } else { 1 }
    if (-not $installerAlive) { $step = 3 }

    # The installer has no hook between closing the app and copying files, so
    # "closing" ends once the old app's processes are gone.
    if ($step -eq 1) {
      if (-not (Get-AppProcesses)) { $step = 2 }
    }
    Show-Step $step

    if ($script:shown -ge 3) {
      if (-not $script:reopeningSince) { $script:reopeningSince = [DateTime]::UtcNow }
      $opened = Get-AppProcesses | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
      if ($opened) {
        Show-Step 4
        (& $find 'Heading').Text = "Installed DHVANI $Version"
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
