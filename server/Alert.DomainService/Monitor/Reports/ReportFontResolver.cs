using System.Collections.Concurrent;
using PdfSharp.Fonts;

namespace DomainService.Monitor.Reports
{
    /// <summary>
    /// PDFsharp 6 has no built-in fonts: on Linux it throws at the first <c>XFont</c> unless a resolver is registered.
    /// This maps every family onto one sans-serif face found on the host: Liberation Sans in the container image
    /// (<c>ttf-liberation</c> in the Dockerfile), Arial or Segoe UI on a Windows developer machine, DejaVu as a last
    /// resort. Same approach as blocks-utilities' PdfFontResolver, reduced to the one family the report uses.
    /// </summary>
    internal sealed class ReportFontResolver : IFontResolver
    {
        private static readonly string[] FontRoots =
        {
            "/app/fonts",
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "/Library/Fonts",
            "/System/Library/Fonts",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts"),
        };

        private static readonly Dictionary<string, string[]> Candidates = new()
        {
            ["regular"] = new[] { "LiberationSans-Regular.ttf", "arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "FreeSans.ttf" },
            ["bold"] = new[] { "LiberationSans-Bold.ttf", "arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf", "FreeSansBold.ttf" },
        };

        private readonly ConcurrentDictionary<string, byte[]> _cache = new();

        public FontResolverInfo ResolveTypeface(string familyName, bool bold, bool italic) =>
            new(bold ? "bold" : "regular");

        public byte[] GetFont(string faceName) => _cache.GetOrAdd(faceName, Load);

        private static byte[] Load(string faceName)
        {
            foreach (var file in Candidates[faceName])
            {
                var path = Find(file);
                if (path is not null) return File.ReadAllBytes(path);
            }

            if (faceName == "bold") return Load("regular");

            throw new FileNotFoundException(
                "No TrueType font found for the uptime report PDF. Install Liberation Sans (Alpine: ttf-liberation).");
        }

        private static string? Find(string fileName)
        {
            foreach (var root in FontRoots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                try
                {
                    var match = Directory.EnumerateFiles(root, fileName, SearchOption.AllDirectories).FirstOrDefault();
                    if (match is not null) return match;
                }
                catch (UnauthorizedAccessException)
                {
                    // Skip unreadable directories.
                }
                catch (IOException)
                {
                    // Skip directories that vanish or cannot be enumerated.
                }
            }
            return null;
        }

        private static readonly object Gate = new();

        /// <summary>Registers the resolver once per process, unless something else already registered one.</summary>
        public static void EnsureRegistered()
        {
            if (GlobalFontSettings.FontResolver is not null) return;
            lock (Gate)
            {
                GlobalFontSettings.FontResolver ??= new ReportFontResolver();
            }
        }
    }
}
