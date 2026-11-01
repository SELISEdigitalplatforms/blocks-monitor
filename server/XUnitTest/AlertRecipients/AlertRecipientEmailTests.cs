using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using DomainService.AlertRecipients.Models;
using FluentAssertions;

namespace XUnitTest.AlertRecipients
{
    /// <summary>
    /// The email rule shared with the client (decision Q12). alert-recipient-emails.json is a byte-for-byte copy of
    /// client/app/__tests__/__fixtures__/alert-recipient-emails.json, so both sides run the same cases and an address
    /// the UI accepts is never refused by the API, or the other way round.
    /// </summary>
    public class AlertRecipientEmailTests
    {
        private sealed record Case(string Input, bool Valid, string? Normalized, string? Reason);
        private sealed record Fixture(string Description, int MaxLength, List<Case> Cases);

        private static readonly Lazy<Fixture> Shared = new(() => JsonSerializer.Deserialize<Fixture>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AlertRecipients", "alert-recipient-emails.json")),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!);

        public static IEnumerable<object?[]> Cases() =>
            Shared.Value.Cases.Select(c => new object?[] { c.Input, c.Valid, c.Normalized });

        [Fact]
        public void SharedList_MatchesTheServerLimit_AndHasBothKindsOfCases()
        {
            Shared.Value.MaxLength.Should().Be(AlertRecipientEmail.MaxLength);
            Shared.Value.Cases.Should().Contain(c => c.Valid).And.Contain(c => !c.Valid);
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void SharedCase_GetsTheSameAnswerAsTheClient(string input, bool valid, string? normalized)
        {
            // H16 for the valid cases: trimmed and lower-case.
            AlertRecipientEmail.IsValid(input).Should().Be(valid);
            AlertRecipientEmail.TryNormalize(input).Should().Be(valid ? normalized : null);
            if (valid)
                AlertRecipientEmail.Normalize(input).Should().Be(normalized);
        }

        // Server-only edge cases, each checked against zod 4.6.7 with String.prototype.trim() on the client side.
        [Theory]
        [InlineData(" nbsp@example.org ", "nbsp@example.org")] // JS trims NBSP
        [InlineData("﻿bom@example.org", "bom@example.org")]        // JS trims U+FEFF; .NET's Trim() alone would not
        public void JavaScriptTrimSet_IsUsed(string input, string normalized)
        {
            AlertRecipientEmail.TryNormalize(input).Should().Be(normalized);
        }

        [Theory]
        [InlineData("\u0085rina@x.com")] // .NET's Trim() removes U+0085, JS trim() does not: invalid on both sides
        [InlineData("İnfo@x.com")]  // validated before lower-casing, so .NET's "i" mapping can't make it valid
        [InlineData("rina@x.com\nbcc@y.com")]
        public void NonAsciiAndEmbeddedLines_AreRefused(string input)
        {
            AlertRecipientEmail.IsValid(input).Should().BeFalse();
        }

        [Fact]
        public void Null_IsRefused_AndNormalizesToEmpty()
        {
            AlertRecipientEmail.TryNormalize(null).Should().BeNull();
            AlertRecipientEmail.Normalize(null).Should().BeEmpty();
        }

        [Fact]
        public void LengthLimit_AppliesAfterTrimming()
        {
            var at254 = new string('a', 248) + "@x.com";
            at254.Length.Should().Be(254);
            AlertRecipientEmail.IsValid("  " + at254 + "  ").Should().BeTrue();
            AlertRecipientEmail.IsValid("b" + at254).Should().BeFalse();
        }
    }
}
