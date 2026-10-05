// The "Updating DHVANI" box shown during an in-app update.
//
// desktop/installer.nsh compiles this at build time (with the C# compiler that
// ships with Windows, so nothing extra is needed), and starts it when a silent
// update begins. The installer writes the current stage (closing | installing
// | finishing | reopening) to the status file as it goes. The box stays up
// until the new version's window appears, so the screen is never blank.
//
// A native GUI program on purpose: it has no console (PowerShell opened a
// terminal window under it), and the marquee bar animates on its own thread
// however busy the installer is.
//
// Written for the C# 5 compiler in .NET Framework 4: no string interpolation,
// no ?. operator.
//
// Arguments: <statusFile> <appExe> <version> <fromVersion> <installerPid>

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

    // Works across 32/64-bit, unlike Process.MainModule.
    public static string ImagePath(int pid)
    {
        IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (h == IntPtr.Zero) return null;
        try
        {
            var name = new StringBuilder(1024);
            int size = name.Capacity;
            return QueryFullProcessImageName(h, 0, name, ref size) ? name.ToString() : null;
        }
        finally { CloseHandle(h); }
    }
}

class SplashForm : Form
{
    // How long to wait for the new window once the installer is done, and an
    // outer limit so a stuck install never leaves the box up for good.
    static readonly TimeSpan ReopenTimeout = TimeSpan.FromSeconds(30);
    static readonly TimeSpan OverallTimeout = TimeSpan.FromMinutes(15);

    // Windows 11 dialog colours.
    static readonly Color Surface = Color.FromArgb(0xF3, 0xF3, 0xF3);
    static readonly Color TextPrimary = Color.FromArgb(0x1B, 0x1B, 0x1B);
    static readonly Color TextSecondary = Color.FromArgb(0x5F, 0x5F, 0x5F);

    readonly string statusFile, appExe, appName;
    readonly int installerPid;
    readonly Label status;
    readonly Timer timer = new Timer();
    readonly DateTime started = DateTime.UtcNow;
    DateTime? reopeningSince;
    int shown = -1;

    static readonly string[] StepText = { "Closing DHVANI…", "Installing the new version…", "Opening DHVANI…" };

    public SplashForm(string statusFile, string appExe, string version, string fromVersion, int installerPid)
    {
        this.statusFile = statusFile;
        this.appExe = appExe;
        this.appName = Path.GetFileNameWithoutExtension(appExe);
        this.installerPid = installerPid;

        Text = "Updating DHVANI";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = true;
        BackColor = Surface;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        Font = new Font("Segoe UI", 9F);
        ClientSize = new Size(340, 154);
        Padding = new Padding(20, 18, 20, 16);

        var icon = new PictureBox
        {
            Location = new Point(20, 18),
            Size = new Size(36, 36),
            SizeMode = PictureBoxSizeMode.Zoom,
            Image = LoadIcon(36),
        };
        var title = new Label
        {
            Text = "Updating DHVANI",
            Font = new Font("Segoe UI Semibold", 10.5F),
            ForeColor = TextPrimary,
            AutoSize = true,
            Location = new Point(66, 17),
        };
        var versions = new Label
        {
            Text = !string.IsNullOrEmpty(fromVersion) && fromVersion != version
                ? fromVersion + "  →  " + version
                : "Version " + version,
            ForeColor = TextSecondary,
            AutoSize = true,
            Location = new Point(67, 38),
        };
        status = new Label
        {
            ForeColor = TextPrimary,
            Font = new Font("Segoe UI", 9.5F),
            AutoSize = true,
            Location = new Point(19, 72),
        };
        var bar = new ProgressBar
        {
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 25,
            Location = new Point(20, 96),
            Size = new Size(300, 6),
        };
        var note = new Label
        {
            Text = "DHVANI opens again by itself. Your projects are kept.",
            ForeColor = TextSecondary,
            Font = new Font("Segoe UI", 8.5F),
            AutoSize = true,
            Location = new Point(19, 114),
        };
        Controls.AddRange(new Control[] { icon, title, versions, status, bar, note });

        // Lets the user move it out of the way.
        foreach (Control c in Controls) c.MouseDown += Drag;
        MouseDown += Drag;

        ShowStep(0);
        timer.Interval = 300;
        timer.Tick += delegate { Tick(); };
        timer.Start();
    }

    static Image LoadIcon(int size)
    {
        try
        {
            using (var s = typeof(SplashForm).Assembly.GetManifestResourceStream("icon.png"))
            using (var source = Image.FromStream(s))
            {
                int px = (int)Math.Round(size * ScreenDpi() / 96.0);
                var bmp = new Bitmap(px, px);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(source, 0, 0, px, px);
                }
                return bmp;
            }
        }
        catch { return null; }
    }

    static float ScreenDpi()
    {
        using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX;
    }

    void Drag(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        Native.ReleaseCapture();
        Native.SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int round = 2;           // DWMWCP_ROUND: Windows 11 rounded corners
            Native.DwmSetWindowAttribute(Handle, 33, ref round, 4);
            int border = 0x00CFCFCF; // a light border, as BGR
            Native.DwmSetWindowAttribute(Handle, 34, ref border, 4);
        }
        catch { }
    }

    // Windows 10 has no rounded corners or DWM border; draw a hairline there.
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (Environment.OSVersion.Version.Build < 22000)
        {
            using (var pen = new Pen(Color.FromArgb(0xCF, 0xCF, 0xCF)))
                e.Graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }
    }

    void ShowStep(int step)
    {
        if (step <= shown) return;
        shown = step;
        if (step < StepText.Length) status.Text = StepText[step];
    }

    Process[] AppProcesses()
    {
        var found = new System.Collections.Generic.List<Process>();
        foreach (var p in Process.GetProcessesByName(appName))
        {
            string path = null;
            try { path = Native.ImagePath(p.Id); } catch { }
            if (path != null && string.Equals(path, appExe, StringComparison.OrdinalIgnoreCase)) found.Add(p);
        }
        return found.ToArray();
    }

    string ReadStage()
    {
        try { return File.Exists(statusFile) ? File.ReadAllText(statusFile).Trim().ToLowerInvariant() : ""; }
        catch { return ""; }
    }

    bool InstallerAlive()
    {
        if (installerPid <= 0) return true;
        try { return !Process.GetProcessById(installerPid).HasExited; }
        catch { return false; }
    }

    void Tick()
    {
        try
        {
            string stage = ReadStage();
            int step = stage == "reopening" ? 2 : (stage == "installing" || stage == "finishing") ? 1 : 0;
            if (!InstallerAlive()) step = 2;

            // The installer has no hook between closing the app and copying
            // files, so "closing" ends once the old app's processes are gone.
            if (step == 0 && AppProcesses().Length == 0) step = 1;
            ShowStep(step);

            if (shown >= 2)
            {
                if (reopeningSince == null) reopeningSince = DateTime.UtcNow;
                foreach (var p in AppProcesses())
                {
                    if (p.MainWindowHandle != IntPtr.Zero) { Finish(); return; }
                }
                if (DateTime.UtcNow - reopeningSince.Value > ReopenTimeout) { Finish(); return; }
            }

            if (DateTime.UtcNow - started > OverallTimeout) Finish();
        }
        catch { Finish(); }
    }

    void Finish()
    {
        timer.Stop();
        Close();
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length < 3) return;
        try
        {
            // Per-monitor v2, else system-aware on older Windows 10, so the box
            // is drawn at the display's real resolution rather than stretched.
            if (!Native.SetProcessDpiAwarenessContext((IntPtr)(-4))) Native.SetProcessDPIAware();
        }
        catch { }

        int pid = 0;
        if (args.Length > 4) int.TryParse(args[4], out pid);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SplashForm(args[0], args[1], args[2], args.Length > 3 ? args[3] : "", pid));
    }
}
