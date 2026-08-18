using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
// The release driver namespace is deliberately NOT imported wholesale: it also defines a
// `BaseApiResponse`, and importing it would make every existing `BaseApiResponse` in this file
// ambiguous with DomainService.Shared.Models. Only the service interface is aliased in.
using IReleaseDriverService = ReleaseDriver.IReleaseDriverService;

namespace Api.Controllers
{
    /// <summary>
    /// Controller for managing monitor configurations, incidents, and response times.
    /// </summary>
    [ApiController]
    [Route("[controller]/[action]")]
    public class MonitorController : ControllerBase
    {
        private readonly IMonitorConfigurationService _monitorConfigurationService;
        private readonly IMonitorConfigurationRepoService _monitorConfigurationRepoService;
        private readonly IMonitorIncidentService _monitorIncidentService;
        private readonly IMonitorPingService _monitorPingService;
        private readonly IReleaseDriverService _releaseDriverService;
        private readonly ILogger<MonitorController> _logger;

        /// <summary>
        /// Initializes a new instance of the <see cref="MonitorController"/> class.
        /// </summary>
        /// <param name="monitorConfigurationService">Service for monitor configuration operations.</param>
        /// <param name="monitorPingService">Service for monitor ping operations.</param>
        /// <param name="monitorIncidentService">Service for monitor incident operations.</param>
        public MonitorController(
            IMonitorConfigurationService monitorConfigurationService,
            IMonitorPingService monitorPingService,
            IMonitorConfigurationRepoService monitorConfigurationRepoService,
            IMonitorIncidentService monitorIncidentService,
            IReleaseDriverService releaseDriverService,
            ILogger<MonitorController> logger)
        {
            _monitorConfigurationService = monitorConfigurationService;
            _monitorPingService = monitorPingService;
            _monitorConfigurationRepoService = monitorConfigurationRepoService;
            _monitorIncidentService = monitorIncidentService;
            _releaseDriverService = releaseDriverService;
            _logger = logger;
        }

        /// <summary>
        /// Retrieves a list of monitor configurations for a given project.
        /// </summary>
        /// <param name="projectKey">The project key to filter monitor configurations.</param>
        /// <returns>A list of monitor configurations.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorList([FromQuery] string projectKey, [FromQuery] string? monitorSourceType, [FromQuery] int pageNumber = 0, [FromQuery] int pageSize = 10, [FromQuery] string? sortProperty = null, [FromQuery] bool sortIsDescending = false, [FromQuery] string? monitorSourcetype = null)
        {
            // The correctly-cased `monitorSourceType` takes precedence; the legacy misspelled
            // `monitorSourcetype` query parameter is still accepted for backward compatibility.
            var effectiveMonitorSourceType = monitorSourceType ?? monitorSourcetype;
            var result = await _monitorConfigurationService.GetConfigurationListAsync(projectKey, effectiveMonitorSourceType, pageNumber, pageSize, sortProperty, sortIsDescending);
            return Ok(result);
        }


        /// <summary>
        /// Retrieves a list of monitor configurations for a given project.
        /// </summary>
        /// <param name="projectKey">The project key to filter monitor configurations.</param>
        /// <returns>A list of monitor configurations.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorListByRepoId([FromQuery] string projectKey, string repoId)
        {
            var result = await _monitorConfigurationService.GetConfigurationListWithDowntimeByRepoIdAsync(projectKey, repoId);
            return Ok(result);
        }

        /// <summary>
        /// Retrieves a list of monitor configurations for a given project.
        /// </summary>
        /// <param name="projectKey">The project key to filter monitor configurations.</param>
        /// <returns>A list of monitor configurations.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorById([FromQuery] string monitorId)
        {
            var result = await _monitorConfigurationService.GetConfigurationByIdAsync(monitorId);
            return Ok(result);
        }

        /// <summary>
        /// Saves a new monitor configuration.
        /// </summary>
        /// <param name="request">The request containing monitor configuration details.</param>
        /// <returns>The result of the save operation.</returns>
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> SaveMonitor([FromBody] SaveMonitorConfigurationRequest request)
        {
            var result = await _monitorConfigurationService.SaveConfigurationAsync(request);
            return Ok(result);
        }

        /// <summary>
        /// Updates an existing monitor configuration.
        /// </summary>
        /// <param name="request">The request containing updated monitor configuration details.</param>
        /// <returns>The result of the update operation.</returns>
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> UpdateMonitor([FromBody] UpdateMonitorConfigurationRequest request)
        {
            var result = await _monitorConfigurationService.UpdateConfigurationAsync(request);
            return Ok(result);
        }

        /// <summary>
        /// Deletes a monitor configuration by its ID.
        /// </summary>
        /// <param name="itemId">The ID of the monitor configuration to delete.</param>
        /// <returns>The result of the delete operation.</returns>
        [Authorize]
        [HttpDelete]
        public async Task<IActionResult> DeleteMonitor([FromQuery] string itemId)
        {
            var result = await _monitorConfigurationService.DeleteConfigurationAsync(itemId);
            return Ok(result);
        }

        /// <summary>
        /// Retrieves a paginated list of incidents for a specific monitor.
        /// </summary>
        /// <param name="monitorId">The ID of the monitor.</param>
        /// <param name="pageNumber">The page number for pagination.</param>
        /// <param name="pageSize">The number of items per page.</param>
        /// <returns>A paginated list of incidents.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetIncidentList([FromQuery] string monitorId, int pageNumber = 0, int pageSize = 10, [FromQuery] string? sortProperty = null, [FromQuery] bool sortIsDescending = true)
        {
            var result = await _monitorIncidentService.GetIncidentsByMonitorIdAsync(monitorId, pageNumber, pageSize, sortProperty, sortIsDescending);
            return Ok(result);
        }

        /// <summary>
        /// Retrieves details of incidents for a specific monitor.
        /// </summary>
        /// <param name="monitorId">The ID of the monitor.</param>
        /// <returns>Details of incidents for the monitor.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorDetails([FromQuery] string monitorId)
        {
            var result = await _monitorIncidentService.GetIncidentsDurationByDateRangeAsync(monitorId);
            return Ok(result);
        }

        /// <summary>
        /// Retrieves the response time logs for a monitor within a specified date range.
        /// </summary>
        /// <param name="monitorId">The ID of the monitor.</param>
        /// <param name="startDate">The start date of the range (optional).</param>
        /// <param name="endDate">The end date of the range (optional).</param>
        /// <returns>The response time logs for the monitor.</returns>
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorResponseTime([FromQuery] string monitorId, string? startDate, string? endDate)
        {
            var result = await _monitorPingService.GetPingLogsByDateRangeAsync(monitorId, startDate, endDate);
            return Ok(result);
        }

        [Authorize]
        [HttpGet]
        public async Task<IActionResult> GetMonitorDownTime([FromQuery] string monitorId, string? startDate, string? endDate)
        {
            var result = await _monitorIncidentService.GetDownTimeLogsByDateRangeAsync(monitorId, startDate, endDate);
            return Ok(result);
        }

        [Authorize]
        [HttpGet]
        public async Task<IActionResult> IsExternalServiceConfigured([FromQuery] string externalServiceId)
        {
            var result = await _monitorConfigurationRepoService.GetExternalServiceConfigurationAsync(externalServiceId);

            return Ok(new BaseApiResponse()
            {
                Data = result,
                IsSuccess = true
            });
        }

        /// <summary>
        /// Retrieves the deployed repository list for the caller, sourced from this API rather than
        /// from the browser calling blocks-logic.
        /// </summary>
        /// <returns>The repository list, or a failure response if the release driver rejects it.</returns>
        /// <remarks>
        /// The route escapes the controller's "[controller]/[action]" template with "~/" on purpose.
        /// A relative "repos-list" template would COMBINE with it and yield
        /// Monitor/GetReposList/repos-list, which is not the documented contract; the route test in
        /// MonitorControllerTests reads the generated route so this cannot regress silently.
        /// </remarks>
        [Authorize]
        [HttpGet("~/Monitor/repos-list")]
        public async Task<IActionResult> GetReposList()
        {
            try
            {
                var result = await _releaseDriverService.GetReposListAsync();

                if (result is null || !result.IsSuccess)
                {
                    _logger.LogError("Release driver reported failure retrieving the repository list.");
                    return BadRequest(new BaseApiResponse
                    {
                        IsSuccess = false,
                        StatusCode = HttpStatusCode.BadRequest,
                        Message = FailedToGetRepos
                    });
                }

                // Returned as-is: re-mapping into this repo's BaseApiResponse would risk silently
                // dropping fields the driver adds to its own envelope.
                return Ok(result);
            }
            catch (OperationCanceledException)
            {
                // Cancellation is not a server fault - let it surface rather than reporting a
                // failure the caller never caused.
                throw;
            }
            catch (Exception ex)
            {
                // GlobalExceptionHandlerMiddleware would already stop this from crashing the
                // process; the catch exists to return the { isSuccess, message } shape the contract
                // specifies instead of the middleware's generic body.
                _logger.LogError(ex, "Unhandled failure retrieving the repository list.");
                return StatusCode(StatusCodes.Status500InternalServerError, new BaseApiResponse
                {
                    IsSuccess = false,
                    StatusCode = HttpStatusCode.InternalServerError,
                    Message = FailedToGetRepos
                });
            }
        }

        /// <summary>
        /// The failure message the contract specifies. Public so the tests assert the exact string
        /// rather than restating it and drifting from it.
        /// </summary>
        public const string FailedToGetRepos = "Failed to get repos.";
    }
}
