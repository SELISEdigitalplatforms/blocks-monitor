using DomainService.Health.Models;
using DomainService.Health.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers
{
    /// <summary>
    /// Controller for managing health check configurations.
    /// </summary>
    [ApiController]
    [Route("[controller]/[action]")]
    public class HealthController : ControllerBase
    {
        private readonly HealthConfigurationService _healthConfigurationService;
        private readonly HealthCheckService _healthCheckService;

        /// <summary>
        /// Initializes a new instance of the <see cref="HealthController"/> class.
        /// </summary>
        /// <param name="healthConfigurationService">Service for health configuration operations.</param>
        public HealthController(HealthConfigurationService healthConfigurationService, HealthCheckService healthCheckService)
        {
            _healthConfigurationService = healthConfigurationService;
            _healthCheckService = healthCheckService;
        }
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> SaveHealth([FromBody] SaveHealthConfigurationRequest request)
        {
            var result = await _healthConfigurationService.SaveConfigurationAsync(request);
            return Ok(result);
        }

        /// <summary>
        /// Updates an existing health configuration.
        /// </summary>
        /// <param name="request">The request containing updated health configuration details.</param>
        /// <returns>The result of the update operation.</returns>
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> UpdateHealth([FromBody] UpdateHealthConfigurationRequest request)
        {
            var result = await _healthConfigurationService.UpdateConfigurationAsync(request);
            return Ok(result);
        }

        [HttpGet("{itemId}")]
        public async Task<IActionResult> Ping([FromRoute] string itemId)
        {
            await _healthCheckService.HandlePingEventAsync(itemId);
            return Ok(new { message = $"Received ping for {itemId}" });
        }

        [Authorize]
        [HttpDelete]
        public async Task<IActionResult> DeleteHealth([FromQuery] string itemId)
        {
            var result = await _healthConfigurationService.DeleteConfigurationAsync(itemId);
            return Ok(result);
        }
    }
}
