using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Api.Controllers;
using Blocks.Genesis.Entities.Monitor;
using ClosedXML.Excel;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Reports;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;

namespace XUnitTest.Monitor
{
    public class UptimeReportCalculatorTests
    {
        private static readonly DateTime From = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        private static readonly DateTime To = new(2026, 10, 11, 0, 0, 0, DateTimeKind.Utc); // 10 days
        private static readonly DateTime Now = new(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);

        private static MonitorConfiguration Monitor(string id = "m1", DateTime? created = null) => new()
        {
            ItemId = id,
            Name = id,
            Url = "https://x",
            IsActive = true,
            CurrentStatus = true,
            CreatedDate = created ?? new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        };

        private static MonitorIncident Incident(DateTime start, DateTime? end, string monitorId = "m1") => new()
        {
            ItemId = Guid.NewGuid().ToString(),
            MonitorId = monitorId,
            StartTime = start,
            EndTime = end,
            IsResolved = end is not null,
            LastStatusCode = 503,
        };

        [Fact]
        public void NoIncidents_IsFullUptime()
        {
            var (rows, incidents) = UptimeReportCalculator.Calculate(new[] { Monitor() }, Array.Empty<MonitorIncident>(), From, To, Now);

            rows.Single().UptimePercent.Should().Be(100d);
            rows.Single().DowntimeMs.Should().Be(0);
            rows.Single().MeanTimeToRecoveryMs.Should().BeNull();
            incidents.Should().BeEmpty();
        }

        [Fact]
        public void OutageInsidePeriod_CountsFully()
        {
            var start = From.AddDays(2);
            var (rows, incidents) = UptimeReportCalculator.Calculate(
                new[] { Monitor() }, new[] { Incident(start, start.AddHours(24)) }, From, To, Now);

            var row = rows.Single();
            row.DowntimeMs.Should().Be((long)TimeSpan.FromHours(24).TotalMilliseconds);
            row.UptimePercent.Should().Be(90d); // 1 of 10 days
            row.IncidentCount.Should().Be(1);
            row.MeanTimeToRecoveryMs.Should().Be((long)TimeSpan.FromHours(24).TotalMilliseconds);
            incidents.Single().DowntimeInPeriodMs.Should().Be(row.DowntimeMs);
        }

        [Fact]
        public void OutageStartedBeforePeriod_IsClippedNotMissed()
        {
            // Began a day before the period and ended 12h into it: the details-page cards would miss it entirely.
            var (rows, incidents) = UptimeReportCalculator.Calculate(
                new[] { Monitor() }, new[] { Incident(From.AddDays(-1), From.AddHours(12)) }, From, To, Now);

            rows.Single().DowntimeMs.Should().Be((long)TimeSpan.FromHours(12).TotalMilliseconds);
            rows.Single().LongestOutageMs.Should().Be((long)TimeSpan.FromHours(36).TotalMilliseconds);
            incidents.Single().DurationMs.Should().Be((long)TimeSpan.FromHours(36).TotalMilliseconds);
        }

        [Fact]
        public void OngoingOutage_CountsToPeriodEnd_AndHasNoEnd()
        {
            var (rows, incidents) = UptimeReportCalculator.Calculate(
                new[] { Monitor() }, new[] { Incident(To.AddDays(-1), null) }, From, To, Now);

            rows.Single().DowntimeMs.Should().Be((long)TimeSpan.FromDays(1).TotalMilliseconds);
            rows.Single().MeanTimeToRecoveryMs.Should().BeNull();
            incidents.Single().IsOngoing.Should().BeTrue();
        }

        [Fact]
        public void PeriodEndingInTheFuture_ObservesOnlyUntilNow()
        {
            // Period 10 days, but "now" is 5 days in: the monitor has only been observable for 5 days.
            var now = From.AddDays(5);
            var (rows, _) = UptimeReportCalculator.Calculate(
                new[] { Monitor() }, new[] { Incident(From.AddDays(1), From.AddDays(1).AddHours(12)) }, From, To, now);

            rows.Single().ObservedMs.Should().Be((long)TimeSpan.FromDays(5).TotalMilliseconds);
            rows.Single().UptimePercent.Should().Be(90d);
        }

        [Fact]
        public void MonitorCreatedMidPeriod_IsJudgedFromCreation()
        {
            var created = To.AddDays(-2);
            var (rows, _) = UptimeReportCalculator.Calculate(
                new[] { Monitor(created: created) }, new[] { Incident(created, created.AddDays(1)) }, From, To, Now);

            rows.Single().ObservedMs.Should().Be((long)TimeSpan.FromDays(2).TotalMilliseconds);
            rows.Single().UptimePercent.Should().Be(50d);
        }

        [Fact]
        public void MonitorCreatedAfterPeriod_HasNoUptime()
        {
            var (rows, _) = UptimeReportCalculator.Calculate(
                new[] { Monitor(created: To.AddDays(1)) }, Array.Empty<MonitorIncident>(), From, To, Now);

            rows.Single().UptimePercent.Should().BeNull();
            rows.Single().ObservedMs.Should().Be(0);
        }

        [Fact]
        public void OverlappingIncidents_AreNotDoubleCounted()
        {
            var a = Incident(From.AddDays(1), From.AddDays(1).AddHours(10));
            var b = Incident(From.AddDays(1).AddHours(5), From.AddDays(1).AddHours(15));
            var (rows, _) = UptimeReportCalculator.Calculate(new[] { Monitor() }, new[] { a, b }, From, To, Now);

            rows.Single().DowntimeMs.Should().Be((long)TimeSpan.FromHours(15).TotalMilliseconds);
            rows.Single().IncidentCount.Should().Be(2);
        }

        [Fact]
        public void IncidentsOfOtherMonitorsOrOutsidePeriod_AreIgnored()
        {
            var (rows, incidents) = UptimeReportCalculator.Calculate(
                new[] { Monitor("m1"), Monitor("m2") },
                new[]
                {
                    Incident(From.AddDays(1), From.AddDays(1).AddHours(1), "m2"),
                    Incident(From.AddDays(-5), From.AddDays(-4), "m1"),
                    Incident(To.AddDays(1), To.AddDays(2), "m1"),
                },
                From, To, Now);

            rows.Single(r => r.MonitorId == "m1").IncidentCount.Should().Be(0);
            rows.Single(r => r.MonitorId == "m2").IncidentCount.Should().Be(1);
            incidents.Should().ContainSingle();
        }

        [Fact]
        public void Rows_AreOrderedWorstFirst()
        {
            var (rows, _) = UptimeReportCalculator.Calculate(
                new[] { Monitor("healthy"), Monitor("flaky") },
                new[] { Incident(From.AddDays(1), From.AddDays(2), "flaky") },
                From, To, Now);

            rows.Select(r => r.MonitorId).Should().Equal("flaky", "healthy");
        }

        [Theory]
        [InlineData(1000, 0, 100d)]
        [InlineData(1000, 1, 99.9d)]
        [InlineData(1_000_000, 1, 99.99d)] // 99.9999 floors, never rounds up to 100.00
        [InlineData(100, 71, 29d)]          // float error guard: 28.999999999999996 must read 29.00
        [InlineData(0, 0, null)]
        public void UptimePercent_FloorsToTwoDecimals(long observed, long down, double? expected)
        {
            UptimeReportCalculator.UptimePercent(observed, down).Should().Be(expected);
        }
    }

    public class UptimeReportRendererTests
    {
        private static UptimeReport Report(int incidents = 2)
        {
            var from = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
            var to = from.AddDays(30);
            var monitor = new MonitorConfiguration
            {
                ItemId = "m1", Name = "=HYPERLINK(\"http://evil\")", Url = "https://api", IsActive = true,
                CreatedDate = from.AddYears(-1),
            };
            var list = Enumerable.Range(0, incidents)
                .Select(i => new MonitorIncident
                {
                    ItemId = $"i{i}", MonitorId = "m1", StartTime = from.AddHours(i + 1), EndTime = from.AddHours(i + 1).AddMinutes(10),
                    IsResolved = true, LastStatusCode = 500, FailureReason = "Service Unavailable",
                })
                .ToList();
            var (rows, reportIncidents) = UptimeReportCalculator.Calculate(new[] { monitor }, list, from, to, to);
            return new UptimeReport
            {
                Title = "Uptime report",
                ScopeLabel = "All monitors",
                FromUtc = from,
                ToUtc = to,
                GeneratedAtUtc = to,
                TimeZone = TimeZoneInfo.Utc,
                Monitors = rows,
                Incidents = reportIncidents,
            };
        }

        [Fact]
        public void Excel_HasSummaryAndIncidentSheets_WithFormulaLikeNamesAsText()
        {
            var bytes = UptimeReportExcelRenderer.Render(Report());

            using var workbook = new XLWorkbook(new MemoryStream(bytes));
            workbook.Worksheets.Select(w => w.Name).Should().Equal("Summary", "Incidents");

            var incidents = workbook.Worksheet("Incidents");
            incidents.Cell(1, 1).GetString().Should().Be("Monitor");
            incidents.Cell(2, 7).GetValue<int>().Should().Be(500);
            incidents.RowsUsed().Count().Should().Be(3);

            var summary = workbook.Worksheet("Summary");
            var nameCell = summary.CellsUsed().First(c => c.GetString().StartsWith("=HYPERLINK", StringComparison.Ordinal));
            nameCell.HasFormula.Should().BeFalse();
        }

        [Fact]
        public void Excel_WithNoIncidents_SaysSo()
        {
            using var workbook = new XLWorkbook(new MemoryStream(UptimeReportExcelRenderer.Render(Report(incidents: 0))));
            workbook.Worksheet("Incidents").Cell(2, 1).GetString().Should().Be("No incidents in this period.");
        }

        [Fact]
        public void Pdf_IsAPdfDocument()
        {
            var bytes = UptimeReportPdfRenderer.Render(Report());
            Encoding.ASCII.GetString(bytes, 0, 5).Should().Be("%PDF-");
        }

        [Fact]
        public void Pdf_ManyIncidents_PaginatesAndCapsTheLog()
        {
            var bytes = UptimeReportPdfRenderer.Render(Report(incidents: UptimeReportPdfRenderer.MaxPdfIncidents + 20));
            using var doc = PdfSharp.Pdf.IO.PdfReader.Open(new MemoryStream(bytes), PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
            doc.PageCount.Should().BeGreaterThan(5);
        }
    }

    public class UptimeReportServiceTests
    {
        private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

        private readonly Mock<IMonitorConfigurationService> _configService = new();
        private readonly Mock<IMonitorConfigurationRepoService> _configRepo = new();
        private readonly Mock<IMonitorIncidentRepoService> _incidentRepo = new();

        private UptimeReportService Sut() => new(
            _configService.Object, _configRepo.Object, _incidentRepo.Object,
            new Mock<ILogger<UptimeReportService>>().Object, new FixedTime(Now));

        public UptimeReportServiceTests()
        {
            _incidentRepo
                .Setup(r => r.GetIncidentsOverlappingRangeAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<DateTime>(), It.IsAny<DateTime>()))
                .ReturnsAsync(new List<MonitorIncident>());
        }

        [Theory]
        [InlineData("doc", null, null, "format")]
        [InlineData("pdf", "not-a-date", null, "from")]
        [InlineData("pdf", "2026-11-05T00:00:00Z", "2026-11-01T00:00:00Z", "earlier")]
        [InlineData("pdf", "2025-01-01T00:00:00Z", "2026-11-01T00:00:00Z", "366")]
        public async Task InvalidQueries_AreRejected(string format, string? from, string? to, string messagePart)
        {
            var result = await Sut().ExportAsync(new UptimeReportQuery { ProjectKey = "p", Format = format, From = from, To = to });

            result.File.Should().BeNull();
            result.NotFound.Should().BeFalse();
            result.Error.Should().Contain(messagePart);
        }

        [Fact]
        public async Task MissingScope_IsRejected()
        {
            var result = await Sut().ExportAsync(new UptimeReportQuery { Format = "pdf" });
            result.Error.Should().Contain("projectKey or monitorId");
        }

        [Fact]
        public async Task SingleMonitor_NotVisible_IsNotFound()
        {
            // GetConfigurationByIdAsync hands back an empty entity for a missing or cross-tenant monitor.
            _configService.Setup(s => s.GetConfigurationByIdAsync("m1"))
                .ReturnsAsync(new BaseApiResponse { IsSuccess = true, Data = new MonitorConfiguration() });

            var result = await Sut().ExportAsync(new UptimeReportQuery { MonitorId = "m1", Format = "xlsx" });

            result.NotFound.Should().BeTrue();
        }

        [Fact]
        public async Task SingleMonitor_ExportsXlsx_NamedAfterTheMonitor()
        {
            _configService.Setup(s => s.GetConfigurationByIdAsync("m1")).ReturnsAsync(new BaseApiResponse
            {
                IsSuccess = true,
                Data = new MonitorConfiguration { ItemId = "m1", Name = "Payments API", CreatedDate = Now.UtcDateTime.AddYears(-1) },
            });

            var result = await Sut().ExportAsync(new UptimeReportQuery
            {
                MonitorId = "m1", Format = "xlsx", From = "2026-10-10T00:00:00Z", To = "2026-11-09T00:00:00Z",
            });

            result.File!.FileName.Should().Be("uptime-report_payments-api_20261010-20261109.xlsx");
            result.File.ContentType.Should().Be(UptimeReportService.XlsxContentType);
            _incidentRepo.Verify(r => r.GetIncidentsOverlappingRangeAsync(
                It.Is<IReadOnlyCollection<string>>(ids => ids.Single() == "m1"),
                new DateTime(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc),
                new DateTime(2026, 11, 9, 0, 0, 0, DateTimeKind.Utc)), Times.Once);
        }

        [Fact]
        public async Task ProjectExport_PagesThroughEveryMonitor_AndClampsAFutureEnd()
        {
            var page0 = Enumerable.Range(0, 200).Select(i => new MonitorConfiguration { ItemId = $"m{i}", Name = $"m{i}" }).ToList();
            var page1 = new List<MonitorConfiguration> { new() { ItemId = "last", Name = "last" } };
            _configRepo.Setup(r => r.GetConfigurationListAsync("p", "2", 0, 200, null, false)).ReturnsAsync((page0, 201));
            _configRepo.Setup(r => r.GetConfigurationListAsync("p", "2", 1, 200, null, false)).ReturnsAsync((page1, 201));

            var result = await Sut().ExportAsync(new UptimeReportQuery
            {
                ProjectKey = "p", MonitorSourceType = "2", Format = "pdf",
                From = "2026-11-02T12:00:00Z", To = "2099-01-01T00:00:00Z",
            });

            result.File!.FileName.Should().StartWith("uptime-report_blocks-services-monitors_").And.EndWith(".pdf");
            _incidentRepo.Verify(r => r.GetIncidentsOverlappingRangeAsync(
                It.Is<IReadOnlyCollection<string>>(ids => ids.Count == 201),
                It.IsAny<DateTime>(),
                Now.UtcDateTime), Times.Once);
        }

        [Fact]
        public async Task ProjectExport_TooManyMonitors_IsRejected()
        {
            _configRepo.Setup(r => r.GetConfigurationListAsync("p", null, 0, 200, null, false))
                .ReturnsAsync((new List<MonitorConfiguration>(), UptimeReportService.MaxMonitors + 1));

            var result = await Sut().ExportAsync(new UptimeReportQuery { ProjectKey = "p", Format = "pdf" });

            result.Error.Should().Contain("one tab at a time");
        }

        [Fact]
        public async Task UnknownTimeZone_FallsBackToUtc()
        {
            _configRepo.Setup(r => r.GetConfigurationListAsync("p", null, 0, 200, null, false))
                .ReturnsAsync((new List<MonitorConfiguration>(), 0));

            var result = await Sut().ExportAsync(new UptimeReportQuery { ProjectKey = "p", Format = "xlsx", TimeZone = "Mars/Olympus" });

            using var workbook = new XLWorkbook(new MemoryStream(result.File!.Content));
            workbook.Worksheet("Summary").CellsUsed().Should().Contain(c => c.GetString() == "UTC");
        }
    }

    public class MonitorControllerExportTests
    {
        private static MonitorController Sut() => new(
            new Mock<IMonitorConfigurationService>().Object, new Mock<IMonitorPingService>().Object,
            new Mock<IMonitorConfigurationRepoService>().Object, new Mock<IMonitorIncidentService>().Object,
            new Mock<ReleaseDriver.IReleaseDriverService>().Object, new Mock<IConfiguration>().Object,
            new Mock<ILogger<MonitorController>>().Object);

        private static Mock<IUptimeReportService> Service(UptimeReportResult result)
        {
            var mock = new Mock<IUptimeReportService>();
            mock.Setup(s => s.ExportAsync(It.IsAny<UptimeReportQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
            return mock;
        }

        [Fact]
        public async Task Xlsx_IsSentAsOctetStream_SoTheUiClientReturnsABlob()
        {
            var service = Service(UptimeReportResult.Ok(new UptimeReportFile(new byte[] { 1 }, UptimeReportService.XlsxContentType, "r.xlsx")));

            var result = await Sut().ExportUptimeReport(new UptimeReportQuery(), service.Object, CancellationToken.None);

            var file = result.Should().BeOfType<FileContentResult>().Subject;
            file.ContentType.Should().Be("application/octet-stream");
            file.FileDownloadName.Should().Be("r.xlsx");
        }

        [Fact]
        public async Task Pdf_KeepsItsContentType()
        {
            var service = Service(UptimeReportResult.Ok(new UptimeReportFile(new byte[] { 1 }, "application/pdf", "r.pdf")));

            var result = await Sut().ExportUptimeReport(new UptimeReportQuery(), service.Object, CancellationToken.None);

            result.Should().BeOfType<FileContentResult>().Which.ContentType.Should().Be("application/pdf");
        }

        [Fact]
        public async Task Invalid_IsBadRequest_AndMissing_IsNotFound()
        {
            var bad = await Sut().ExportUptimeReport(new UptimeReportQuery(), Service(UptimeReportResult.Invalid("nope")).Object, CancellationToken.None);
            bad.Should().BeOfType<BadRequestObjectResult>().Which.Value.As<BaseApiResponse>().Message.Should().Be("nope");

            var missing = await Sut().ExportUptimeReport(new UptimeReportQuery(), Service(UptimeReportResult.Missing("gone")).Object, CancellationToken.None);
            missing.Should().BeOfType<NotFoundObjectResult>();
        }
    }
}

namespace XUnitTest.Monitor
{
    internal sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
