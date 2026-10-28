using DomainService.AlertRecipients.Models;
using FluentValidation;

namespace DomainService.Validators
{
    /// <summary>
    /// The request-only rules of SaveAlertRecipient, in the order the spec lists them. The rules that need the
    /// project's monitors and people ("Monitor not found", the "All monitors" limit) run in the service.
    /// </summary>
    public class SaveAlertRecipientRequestValidator : AbstractValidator<SaveAlertRecipientRequest>
    {
        public SaveAlertRecipientRequestValidator()
        {
            ClassLevelCascadeMode = CascadeMode.Stop;
            RuleLevelCascadeMode = CascadeMode.Stop;

            RuleFor(x => x.Email)
                .Must(AlertRecipientEmail.IsValid).WithMessage(AlertRecipientRules.InvalidEmail);

            RuleFor(x => x.MonitorIds)
                .Must(ids => ids is { Count: > 0 }).When(x => !x.AllMonitors).WithMessage(AlertRecipientRules.ChooseMonitor);

            RuleFor(x => x.MonitorIds)
                .Must(ids => ids is null || ids.Count <= AlertRecipientRules.MaxMonitorIdsPerRequest)
                .WithMessage(AlertRecipientRules.TooManyMonitors);
        }
    }
}
