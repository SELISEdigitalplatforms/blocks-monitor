using System.Globalization;

namespace DomainService.Monitor.Reports
{
    internal static class UptimeReportFormatting
    {
        public const string DateTimeFormat = "yyyy-MM-dd HH:mm:ss";
        public const string DateFormat = "yyyy-MM-dd";

        /// <summary>Same shape as the UI's <c>formatDuration</c>: the two largest units, e.g. "2d 3h", "4m 10s", "0s".</summary>
        public static string Duration(long ms)
        {
            if (ms < 0) ms = 0;
            var t = TimeSpan.FromMilliseconds(ms);
            var days = (long)t.TotalDays;
            if (days > 0) return t.Hours > 0 ? $"{days}d {t.Hours}h" : $"{days}d";
            if (t.Hours > 0) return t.Minutes > 0 ? $"{t.Hours}h {t.Minutes}m" : $"{t.Hours}h";
            if (t.Minutes > 0) return t.Seconds > 0 ? $"{t.Minutes}m {t.Seconds}s" : $"{t.Minutes}m";
            return $"{t.Seconds}s";
        }

        public static string Percent(double? value) =>
            value is null ? "n/a" : value.Value.ToString("0.00", CultureInfo.InvariantCulture) + "%";

        /// <summary>"UTC+06:00 (Asia/Dhaka)", so the reader always knows which clock the dates use.</summary>
        public static string ZoneLabel(TimeZoneInfo zone, DateTime atUtc)
        {
            var offset = zone.GetUtcOffset(atUtc);
            var sign = offset < TimeSpan.Zero ? "-" : "+";
            var label = $"UTC{sign}{offset.Duration():hh\\:mm}";
            return zone.Id == TimeZoneInfo.Utc.Id ? "UTC" : $"{label} ({zone.Id})";
        }

        /// <summary>A file-name-safe slug: letters, digits and dashes only.</summary>
        public static string Slug(string value)
        {
            var chars = value.Trim().ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) && c < 128 ? c : '-').ToArray();
            var slug = string.Join('-', new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
            if (slug.Length > 40) slug = slug[..40].TrimEnd('-');
            return slug.Length == 0 ? "monitor" : slug;
        }
    }
}
