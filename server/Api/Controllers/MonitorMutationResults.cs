using System.Net;
using DomainService.Shared.Models;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers
{
    internal static class MonitorMutationResults
    {
        /// <summary>
        /// The answer to a monitor or heartbeat update/delete. A Blocks-managed monitor's refusal
        /// (<c>ManagedMonitors.Refused</c>) goes out as a real 403; every other result keeps the 200
        /// envelope the clients already read.
        /// </summary>
        public static IActionResult OkOrForbidden(this ControllerBase controller, BaseApiResponse result) =>
            result.StatusCode == HttpStatusCode.Forbidden
                ? controller.StatusCode(StatusCodes.Status403Forbidden, result)
                : controller.Ok(result);
    }
}
