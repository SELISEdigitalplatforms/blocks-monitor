using System;
using DomainService.Health.Models;
using DomainService.Monitor.Entity;
using FluentAssertions;

namespace XUnitTest.Health
{
    public class HealthQueueTaskTests
    {
        [Fact]
        public void Constructor_SchedulesNextExecutionUsingIntervalPlusGracePeriod()
        {
            // Health tasks wait interval + grace before considering the service unhealthy.
            var config = new MonitorConfiguration { ItemId = "x", IntervalInSeconds = 30, GracePeriodInSeconds = 15 };
            var before = DateTime.UtcNow;

            var task = new HealthQueueTask(config);

            var after = DateTime.UtcNow;
            task.NextExecutionTime.Should().BeOnOrAfter(before.AddSeconds(45))
                .And.BeOnOrBefore(after.AddSeconds(45));
        }
    }
}
