// Test-only ACE helper: leave a descendant blocked to exercise Windows Job cleanup.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class BlockedHelper {
    static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--child") {
            Thread.Sleep(120000);
            return 0;
        }
        var child = Process.Start(new ProcessStartInfo {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true
        });
        try {
            var marker = Environment.GetEnvironmentVariable("COMISCOPIO_CANCEL_MARKER");
            File.WriteAllText(marker + ".tmp", "{\"helper\":" + Process.GetCurrentProcess().Id +
                ",\"descendant\":" + child.Id + "}");
            File.Move(marker + ".tmp", marker);
            Thread.Sleep(120000);
            return 0;
        } finally {
            if (!child.HasExited) child.Kill();
            child.Dispose();
        }
    }
}
