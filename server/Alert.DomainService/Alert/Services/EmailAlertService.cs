using DomainService.Alert.Entities;
using DomainService.Monitor.Entity;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Net.Mail;
using MailKit.Net.Smtp;
using MimeKit;

namespace DomainService.Alert.Services
{
    public class EmailAlertService
    {
        private readonly ILogger<EmailAlertService> _logger;
        private readonly AlertRepoService _alertRepo;

        public EmailAlertService(
            ILogger<EmailAlertService> logger,
            AlertRepoService alertRepo)
        {
            _logger = logger;
            _alertRepo = alertRepo;
        }

        public async Task<bool> HandleEmailAlertAsync(MonitorConfiguration monitorConfiguration, MonitorIncident incident)
        {
            try
            {
                _logger.LogInformation(
                    "Preparing email delivery for monitor {MonitorName} ({MonitorUrl})",
                    monitorConfiguration.Name,
                    monitorConfiguration.Url);

                _logger.LogInformation("Sending email to: {Emails}",
                    string.Join(", ", monitorConfiguration.Emails));

                string templateName = incident.IsResolved ?
                    "AlertResolved" : "AlertIncident";

                var template = await _alertRepo.GetAlertMailTemplateByNameAsync(templateName);
                if (template == null)
                {
                    _logger.LogWarning("Mail template {TemplateName} not found", templateName);
                    return false;
                }

                var variables = BuildVariables(monitorConfiguration, incident);

                var mailConfig = await _alertRepo.GetMailServerConfigurationByIdAsync(template.MailConfigurationId);

                if (mailConfig == null)
                {
                    _logger.LogWarning("Mail config {ConfigId} not found", template.MailConfigurationId);
                    return false;
                }

                bool allSuccess = true;

                foreach (string email in monitorConfiguration.Emails)
                {
                    bool sent = false;

                    _logger.LogInformation(
                        "Sending {TemplateName} email to {Email} for monitor {MonitorName}",
                        templateName,
                        email,
                        monitorConfiguration.Name);

                    if (mailConfig.SmtpClient == 0)
                    {
                        sent = await SendUsingMailKitAsync(template, mailConfig, email, variables);
                    }
                    else
                    {
                        sent = await SendUsingSystemSmtpAsync(template, mailConfig, email, variables);
                    }

                    if (!sent)
                        allSuccess = false;

                    _logger.LogInformation(
                        "Finished {TemplateName} email delivery to {Email} for monitor {MonitorName} with result {Result}",
                        templateName,
                        email,
                        monitorConfiguration.Name,
                        sent);
                }

                _logger.LogInformation(
                    "Completed email delivery for monitor {MonitorName} with overall result {Result}",
                    monitorConfiguration.Name,
                    allSuccess);

                return allSuccess;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error executing alert email for monitor {MonitorName}",
                    monitorConfiguration.Name);
                return false;
            }
        }

        private static Dictionary<string, string> BuildVariables(MonitorConfiguration monitor, MonitorIncident incident)
        {
            var dict = new Dictionary<string, string>
            {
                { "MonitorName", monitor.Name },
                { "MonitorUrl", monitor.Url },
                { "DetectedAt", incident.StartTime.ToString("yyyy-MM-dd HH:mm:ss 'UTC'") },
                { "FailureReason", incident.FailureReason ?? "" },
                { "DowntimeSeconds", incident.DowntimeDurationSeconds?.ToString("F2") ?? "0" },
                { "StatusCode", incident.LastStatusCode.ToString() },
                { "ErrorMessage", incident.FailureReason ?? "" }
            };

            if (incident.IsResolved && incident.EndTime.HasValue)
            {
                dict["ResolvedAt"] = incident.EndTime.Value.ToString("yyyy-MM-dd HH:mm:ss 'UTC'");
            }

            return dict;
        }

        private static string ApplyVariables(string body, Dictionary<string, string> variables)
        {
            foreach (var kv in variables)
            {
                body = body.Replace($"{{{{{kv.Key}}}}}", kv.Value);
            }
            return body;
        }


        private async Task<bool> SendUsingSystemSmtpAsync(
            AlertMailTemplate template,
            MailServerConfiguration config,
            string toEmail,
            Dictionary<string, string> variables)
        {
            try
            {
                string body = ApplyVariables(template.TemplateBody ?? "", variables);

                using var client = new System.Net.Mail.SmtpClient
                {
                    Host = config.Host,
                    Port = config.Port,
                    EnableSsl = config.EnableSSL,
                    DeliveryMethod = SmtpDeliveryMethod.Network,
                    UseDefaultCredentials = config.UseDefaultCredentials
                };

                if (!config.UseDefaultCredentials)
                {
                    client.Credentials = new NetworkCredential(
                        config.SenderUserName,
                        config.AccountPassword
                    );
                }

                using var mail = new MailMessage
                {
                    From = new MailAddress(config.SenderAddress, config.SenderName),
                    Subject = template.TemplateSubject,
                    Body = body,
                    IsBodyHtml = true
                };

                mail.To.Add(toEmail);

                await client.SendMailAsync(mail);

                _logger.LogInformation("Sent using System.Net SMTP → {Email}", toEmail);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "System SMTP failed for {Email}",
                    toEmail);

                return false;
            }
        }

        private async Task<bool> SendUsingMailKitAsync(
            AlertMailTemplate template,
            MailServerConfiguration config,
            string toEmail,
            Dictionary<string, string> variables)
        {
            try
            {
                string subject = ApplyVariables(template.TemplateSubject ?? "", variables);
                string body = ApplyVariables(template.TemplateBody ?? "", variables);

                var message = new MimeMessage();
                message.From.Add(new MailboxAddress(config.SenderName, config.SenderAddress));
                message.To.Add(new MailboxAddress(toEmail, toEmail));
                message.Subject = subject;
                message.Body = new TextPart("html") { Text = body };

                using var smtp = new MailKit.Net.Smtp.SmtpClient();

                var socketOptions = config.EnableSSL
                    ? (config.Port == 465
                        ? MailKit.Security.SecureSocketOptions.SslOnConnect
                        : MailKit.Security.SecureSocketOptions.StartTls)
                    : MailKit.Security.SecureSocketOptions.None;

                await smtp.ConnectAsync(config.Host, config.Port, socketOptions);

                if (!config.UseDefaultCredentials && !string.IsNullOrWhiteSpace(config.SenderUserName))
                {
                    await smtp.AuthenticateAsync(config.SenderUserName, config.AccountPassword);
                }

                await smtp.SendAsync(message);
                await smtp.DisconnectAsync(true);

                _logger.LogInformation("Sent using MailKit → {Email}", toEmail);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "MailKit failed for {Email}",
                    toEmail);

                return false;
            }
        }
    }
}
