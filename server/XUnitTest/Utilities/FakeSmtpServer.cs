using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace XUnitTest.Utilities
{
    /// <summary>
    /// A minimal plaintext SMTP server on 127.0.0.1 for tests. It offers AUTH PLAIN and LOGIN,
    /// records every decoded credential and counts accepted connections, so a test can see exactly
    /// which password reached the wire (MailKit and System.Net.Mail alike) or that no connection
    /// was opened at all. Every command is accepted; mail content is discarded.
    /// </summary>
    public sealed class FakeSmtpServer : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly CancellationTokenSource _cts = new();
        private readonly ConcurrentQueue<(string User, string Password)> _credentials = new();
        private int _connections;

        public FakeSmtpServer()
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            _ = AcceptLoopAsync();
        }

        public string Host => "127.0.0.1";
        public int Port { get; }
        public int Connections => Volatile.Read(ref _connections);
        public IReadOnlyList<(string User, string Password)> Credentials => _credentials.ToList();

        private async Task AcceptLoopAsync()
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient client;
                try
                {
                    client = await _listener.AcceptTcpClientAsync(_cts.Token);
                }
                catch (Exception)
                {
                    return;
                }

                Interlocked.Increment(ref _connections);
                _ = Task.Run(() => ServeAsync(client));
            }
        }

        private async Task ServeAsync(TcpClient client)
        {
            using (client)
            {
                try
                {
                    var stream = client.GetStream();
                    using var reader = new StreamReader(stream, Encoding.ASCII);
                    await using var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };

                    await writer.WriteLineAsync("220 fake.smtp ESMTP");
                    string? line;
                    while ((line = await reader.ReadLineAsync(_cts.Token)) != null)
                    {
                        var verb = line.Split(' ')[0].ToUpperInvariant();
                        switch (verb)
                        {
                            case "EHLO":
                                await writer.WriteLineAsync("250-fake.smtp");
                                await writer.WriteLineAsync("250-AUTH PLAIN LOGIN");
                                await writer.WriteLineAsync("250 OK");
                                break;
                            case "AUTH":
                                await AuthenticateAsync(line, reader, writer);
                                break;
                            case "DATA":
                                await writer.WriteLineAsync("354 End data with <CR><LF>.<CR><LF>");
                                while ((line = await reader.ReadLineAsync(_cts.Token)) != null && line != ".")
                                {
                                }
                                await writer.WriteLineAsync("250 OK queued");
                                break;
                            case "QUIT":
                                await writer.WriteLineAsync("221 Bye");
                                return;
                            default:
                                await writer.WriteLineAsync("250 OK");
                                break;
                        }
                    }
                }
                catch (Exception)
                {
                    // The client went away; nothing to record.
                }
            }
        }

        private async Task AuthenticateAsync(string line, StreamReader reader, StreamWriter writer)
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var mechanism = parts.Length > 1 ? parts[1].ToUpperInvariant() : string.Empty;

            if (mechanism == "PLAIN")
            {
                var payload = parts.Length > 2 ? parts[2] : null;
                if (payload is null)
                {
                    await writer.WriteLineAsync("334 ");
                    payload = await reader.ReadLineAsync(_cts.Token) ?? string.Empty;
                }

                // authzid \0 authcid \0 password
                var fields = Decode(payload).Split('\0');
                _credentials.Enqueue((fields.ElementAtOrDefault(1) ?? string.Empty, fields.ElementAtOrDefault(2) ?? string.Empty));
            }
            else if (mechanism == "LOGIN")
            {
                string user;
                if (parts.Length > 2)
                {
                    user = Decode(parts[2]);
                }
                else
                {
                    await writer.WriteLineAsync("334 VXNlcm5hbWU6");
                    user = Decode(await reader.ReadLineAsync(_cts.Token) ?? string.Empty);
                }

                await writer.WriteLineAsync("334 UGFzc3dvcmQ6");
                var password = Decode(await reader.ReadLineAsync(_cts.Token) ?? string.Empty);
                _credentials.Enqueue((user, password));
            }
            else
            {
                await writer.WriteLineAsync("504 Unrecognized authentication type");
                return;
            }

            await writer.WriteLineAsync("235 Authentication successful");
        }

        private static string Decode(string base64) => Encoding.UTF8.GetString(Convert.FromBase64String(base64.Trim()));

        public void Dispose()
        {
            _cts.Cancel();
            _listener.Stop();
            _cts.Dispose();
        }
    }
}
