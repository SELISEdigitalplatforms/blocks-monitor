using DomainService.Shared.Utilities;
using FluentAssertions;

namespace XUnitTest.Shared
{
    public class LogValueTests
    {
        [Theory]
        [InlineData("p1", "p1")]
        [InlineData("p1\r\nINFO forged", "p1INFO forged")]
        [InlineData("\n\r", "")]
        [InlineData(null, "")]
        public void Clean_RemovesCarriageReturnsAndLineFeeds(string? value, string expected)
        {
            LogValue.Clean(value).Should().Be(expected);
        }
    }
}
