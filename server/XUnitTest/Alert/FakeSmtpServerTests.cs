using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class FakeSmtpServerTests
    {
        [Fact]
        public async Task StalledClient_IsDisconnectedWithinTheIoTimeout_AndRecordedAsAFault()
        {
            using var smtp = new FakeSmtpServer(TimeSpan.FromMilliseconds(300));
            using var client = new TcpClient();
            await client.ConnectAsync(smtp.Host, smtp.Port);
            using var reader = new StreamReader(client.GetStream(), Encoding.ASCII);
            var watch = Stopwatch.StartNew();

            (await reader.ReadLineAsync()).Should().StartWith("220");
            // Send nothing: the server must give up and close instead of waiting forever.
            var next = await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));

            next.Should().BeNull("the server closes a stalled connection");
            watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5));
            smtp.Faults.Should().ContainSingle().Which.Should().Contain("timed out").And.Contain("the first command");
            smtp.Describe().Should().Contain("timed out");
        }

        [Fact]
        public void Dispose_ReleasesThePort()
        {
            var smtp = new FakeSmtpServer();
            var port = smtp.Port;
            smtp.Dispose();

            var act = () => { using var probe = new TcpClient(); probe.Connect(smtp.Host, port); };

            act.Should().Throw<SocketException>();
        }
    }
}
