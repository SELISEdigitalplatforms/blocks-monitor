using System.Net;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Shared.Models;

namespace DomainService.Shared.Utilities
{
    /// <summary>
    /// Infrastructure and Blocks services monitors are run by Blocks itself: every project lists them,
    /// but nobody may pause, edit or delete them. This is the one rule and the one answer for that.
    /// </summary>
    public static class ManagedMonitors
    {
        public const string RefusedMessage =
            "Infrastructure and Blocks services monitors are managed by Blocks and cannot be changed.";

        public static bool IsManagedByBlocks(MonitorSourceTypes sourceType) =>
            sourceType is MonitorSourceTypes.Infrastructure or MonitorSourceTypes.BlocksServices;

        /// <summary>
        /// A 403 that says why, for a caller who reached a managed monitor directly (the UI never offers
        /// the action). It used to be a 200 "not found", which hid the reason and broke the client.
        /// </summary>
        public static BaseApiResponse Refused() => new()
        {
            IsSuccess = false,
            StatusCode = HttpStatusCode.Forbidden,
            Message = RefusedMessage
        };
    }
}
