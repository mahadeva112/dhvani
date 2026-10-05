// The "Updating DHVANI" box shown during an in-app update.
//
// desktop/installer.nsh compiles this at build time (with the C# compiler that
// ships with Windows, so nothing extra is needed), and starts it when a silent
// update begins. The installer writes the current stage (closing | installing
// | finishing | reopening) to the status file as it goes. The box stays up
// until the new version's window appears, so the screen is never blank.
//
// A native GUI program on purpose: it has no console (PowerShell opened a
// terminal window under it), and it animates on its own thread however busy
// the installer is.
//
// Like the installer's old banner it sits still in the middle of the main
// screen, on top of other windows, with no taskbar button, and can't be
// dragged. Colours follow the app's own "Installing DHVANI" dialog
// (components/UpdateControl.tsx).
//
// Written for the C# 5 compiler in .NET Framework 4: no string interpolation,
// no ?. operator.
//
// Arguments: <statusFile> <appExe> <version> <fromVersion> <installerPid>

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
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

    // Layout, in 96-dpi units; everything is scaled to the screen's DPI.
    const float W = 400, H = 303, Pad = 20, HeaderH = 78, StepsTop = 90, RowH = 32, SubH = 18;
    const float BarTop = 244, BarH = 5, BarGap = 4, FooterTop = 265;

    // Tailwind colours the app's dialog uses.
    static readonly Color Slate950 = Hex(0x0B1222), Slate900 = Hex(0x0F172A), Slate800 = Hex(0x1E293B);
    static readonly Color Slate700 = Hex(0x334155), Slate600 = Hex(0x475569), Slate500 = Hex(0x64748B);
    static readonly Color Slate400 = Hex(0x94A3B8), Slate300 = Hex(0xCBD5E1), Slate100 = Hex(0xF1F5F9);
    static readonly Color Blue950 = Hex(0x172554), Blue500 = Hex(0x3B82F6), Blue400 = Hex(0x60A5FA), Blue300 = Hex(0x93C5FD);
    static readonly Color Emerald900 = Hex(0x064E3B), Emerald400 = Hex(0x34D399);

    static Color Hex(int rgb) { return Color.FromArgb((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF); }

    // Each step: label while waiting or running, label once done.
    static readonly string[][] Steps =
    {
        new[] { "Update downloaded", "Update downloaded" },
        new[] { "Closing DHVANI", "Closed DHVANI" },
        new[] { "Installing the new version", "Installed the new version" },
        new[] { "Opening DHVANI", "Opened DHVANI" },
    };

    readonly string statusFile, appExe, appName, version, fromVersion;
    readonly int installerPid;
    readonly float scale;
    readonly Bitmap icon;
    readonly Font titleFont, bodyFont, bodyBold, smallFont, footFont;
    readonly Timer frameTimer = new Timer();
    readonly DateTime started = DateTime.UtcNow;
    DateTime? reopeningSince;
    int current = 1;          // the running step; 0 is the download the app already finished
    string detail = "Waiting for DHVANI to close";
    int frame;

    public SplashForm(string statusFile, string appExe, string version, string fromVersion, int installerPid)
    {
        this.statusFile = statusFile;
        this.appExe = appExe;
        this.appName = Path.GetFileNameWithoutExtension(appExe);
        this.version = version;
        this.fromVersion = fromVersion;
        this.installerPid = installerPid;

        Text = "Updating DHVANI";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Slate900;
        DoubleBuffered = true;
        AutoScaleMode = AutoScaleMode.None;

        using (var g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;
        ClientSize = new Size(Px(W), Px(H));

        // Fixed in the middle of the main screen, like the old banner.
        StartPosition = FormStartPosition.Manual;
        var area = Screen.PrimaryScreen.WorkingArea;
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);

        // Sizes in pixels at 96 dpi; the paint transform scales them.
        titleFont = new Font("Segoe UI Semibold", 16f, GraphicsUnit.Pixel);
        bodyFont = new Font("Segoe UI", 13.5f, GraphicsUnit.Pixel);
        bodyBold = new Font("Segoe UI Semibold", 13.5f, GraphicsUnit.Pixel);
        smallFont = new Font("Segoe UI", 12f, GraphicsUnit.Pixel);
        footFont = new Font("Segoe UI", 11.5f, GraphicsUnit.Pixel);
        icon = LoadIcon(Px(42));

        // ~30 fps for the spinner and bar; the installer is checked every 300 ms.
        frameTimer.Interval = 33;
        frameTimer.Tick += delegate
        {
            frame++;
            if (frame % 9 == 0) Poll();
            Invalidate();
        };
        frameTimer.Start();
    }

    int Px(float v) { return (int)Math.Round(v * scale); }

    // A window that never takes focus and can't be moved: no caption to drag.
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int round = 2;           // DWMWCP_ROUND: Windows 11 rounded corners
            Native.DwmSetWindowAttribute(Handle, 33, ref round, 4);
            int border = 0x004C392C; // slate-700/80 over slate-900, as BGR
            Native.DwmSetWindowAttribute(Handle, 34, ref border, 4);
            int dark = 1;            // DWMWA_USE_IMMERSIVE_DARK_MODE
            Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4);
        }
        catch { }
    }

    static Bitmap LoadIcon(int px)
    {
        try
        {
            using (var s = typeof(SplashForm).Assembly.GetManifestResourceStream("icon.png"))
            using (var source = Image.FromStream(s))
            {
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

    // --- Drawing ------------------------------------------------------------

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Slate900);

        if (icon != null)
        {
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.DrawImage(icon, Px(Pad), Px(18), icon.Width, icon.Height);
        }

        g.ScaleTransform(scale, scale);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        DrawHeader(g);
        for (int i = 0; i < Steps.Length; i++) DrawStep(g, i);
        DrawBar(g);
        DrawFooter(g);

        // Windows 10 has no DWM border; draw a hairline there.
        if (Environment.OSVersion.Version.Build < 22000)
        {
            g.ResetTransform();
            using (var pen = new Pen(Hex(0x2C394C)))
                g.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }
    }

    void DrawHeader(Graphics g)
    {
        float x = 76;
        DrawText(g, "Updating DHVANI", titleFont, Slate100, x, 19);
        if (!string.IsNullOrEmpty(fromVersion) && fromVersion != version)
        {
            x = DrawText(g, fromVersion, smallFont, Slate400, x, 44);
            x = DrawText(g, " → ", smallFont, Slate600, x, 44);
            DrawText(g, version, smallFont, Blue300, x, 44);
        }
        else
        {
            DrawText(g, "Version " + version, smallFont, Slate400, x, 44);
        }
        using (var b = new SolidBrush(Slate800)) g.FillRectangle(b, 0, HeaderH, W, 1);
    }

    void DrawStep(Graphics g, int i)
    {
        float y = StepsTop + i * RowH + (i > current ? SubH : 0);
        var dot = new RectangleF(Pad, y + 1, 20, 20);
        bool done = i < current, running = i == current;

        if (done)
        {
            Fill(g, Emerald900, dot);
            using (var pen = RoundPen(Emerald400, 1.8f))
                g.DrawLines(pen, new[] { new PointF(dot.X + 6, dot.Y + 10.5f), new PointF(dot.X + 9, dot.Y + 13.5f), new PointF(dot.X + 14.5f, dot.Y + 7) });
            DrawText(g, Steps[i][1], bodyFont, Slate300, 52, y);
        }
        else if (running)
        {
            Fill(g, Blue950, dot);
            using (var pen = RoundPen(Blue400, 1.8f))
                g.DrawArc(pen, dot.X + 5, dot.Y + 5, 10, 10, (frame * 12) % 360, 270);
            DrawText(g, Steps[i][0], bodyBold, Slate100, 52, y);
            DrawText(g, detail, smallFont, Slate400, 52, y + 19);
        }
        else
        {
            using (var pen = new Pen(Slate700, 1.5f)) g.DrawEllipse(pen, dot.X + 1.5f, dot.Y + 1.5f, 17, 17);
            DrawText(g, Steps[i][0], bodyFont, Slate500, 52, y);
        }
    }

    void DrawBar(Graphics g)
    {
        float width = (W - 2 * Pad - 3 * BarGap) / 4;
        for (int i = 0; i < 4; i++)
        {
            var seg = new RectangleF(Pad + i * (width + BarGap), BarTop, width, BarH);
            using (var path = Rounded(seg, BarH / 2))
            {
                if (i < current)
                {
                    using (var b = new SolidBrush(Blue500)) g.FillPath(b, path);
                    continue;
                }
                using (var b = new SolidBrush(Slate800)) g.FillPath(b, path);
                if (i != current) continue;

                // A chunk sweeping across the running step's segment.
                float t = (frame % 40) / 40f;
                float eased = (float)(0.5 - Math.Cos(t * Math.PI) / 2);
                float chunk = width * 0.45f;
                float cx = seg.X - chunk + eased * (width + chunk);
                var state = g.Save();
                g.SetClip(path);
                using (var b = new SolidBrush(Blue500))
                using (var c = Rounded(new RectangleF(cx, BarTop, chunk, BarH), BarH / 2))
                    g.FillPath(b, c);
                g.Restore(state);
            }
        }
    }

    void DrawFooter(Graphics g)
    {
        using (var b = new SolidBrush(Slate950)) g.FillRectangle(b, 0, FooterTop, W, H - FooterTop);
        using (var b = new SolidBrush(Slate800)) g.FillRectangle(b, 0, FooterTop, W, 1);

        // A small shield with a tick.
        float sx = Pad, sy = FooterTop + 12;
        using (var shield = new GraphicsPath())
        {
            shield.AddLines(new[]
            {
                new PointF(sx + 6, sy), new PointF(sx + 12, sy + 2.2f), new PointF(sx + 12, sy + 7),
            });
            shield.AddBezier(sx + 12, sy + 7, sx + 12, sy + 10.5f, sx + 9, sy + 12.5f, sx + 6, sy + 14);
            shield.AddBezier(sx + 6, sy + 14, sx + 3, sy + 12.5f, sx, sy + 10.5f, sx, sy + 7);
            shield.AddLines(new[] { new PointF(sx, sy + 7), new PointF(sx, sy + 2.2f) });
            shield.CloseFigure();
            using (var pen = RoundPen(Emerald400, 1.3f)) g.DrawPath(pen, shield);
        }
        using (var pen = RoundPen(Emerald400, 1.3f))
            g.DrawLines(pen, new[] { new PointF(sx + 3.6f, sy + 7), new PointF(sx + 5.4f, sy + 8.8f), new PointF(sx + 8.6f, sy + 5.2f) });

        DrawText(g, "Your projects, keys and settings are kept", footFont, Slate400, Pad + 19, FooterTop + 11);
    }

    // Draws text and returns where it ends, for runs of differently coloured text.
    float DrawText(Graphics g, string s, Font font, Color color, float x, float y)
    {
        var format = StringFormat.GenericTypographic;
        format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
        using (var b = new SolidBrush(color)) g.DrawString(s, font, b, x, y, format);
        return x + g.MeasureString(s, font, PointF.Empty, format).Width;
    }

    static void Fill(Graphics g, Color color, RectangleF r)
    {
        using (var b = new SolidBrush(color)) g.FillEllipse(b, r);
    }

    static Pen RoundPen(Color color, float width)
    {
        return new Pen(color, width) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
    }

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        float d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // --- Following the installer ------------------------------------------------

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

    void Poll()
    {
        try
        {
            string stage = ReadStage();
            int step = stage == "reopening" ? 3 : (stage == "installing" || stage == "finishing") ? 2 : 1;
            if (!InstallerAlive()) step = 3;

            // The installer has no hook between closing the app and copying
            // files, so "closing" ends once the old app's processes are gone.
            if (step == 1 && AppProcesses().Length == 0) step = 2;

            if (step > current) current = step;
            detail = current == 1 ? "Waiting for DHVANI to close"
                : current == 2 ? (stage == "finishing" ? "Adding shortcuts and settings" : "Replacing the app files")
                : "Starting the new version";

            if (current >= 3)
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
        frameTimer.Stop();
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
