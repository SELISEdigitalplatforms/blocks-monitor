using System;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Services;
using FluentAssertions;

namespace XUnitTest.Monitor
{
    public class MonitorQueueTaskTests
    {
        [Fact]
        public void Constructor_SetsNextExecutionTimeToNowPlusInterval()
        {
            var config = new MonitorConfiguration { ItemId = "x", IntervalInSeconds = 45 };
            var before = DateTime.UtcNow;

            var task = new MonitorQueueTask(config);

            var after = DateTime.UtcNow;
            task.Config.Should().BeSameAs(config);
            task.NextExecutionTime.Should().BeOnOrAfter(before.AddSeconds(45))
                .And.BeOnOrBefore(after.AddSeconds(45));
        }

        [Fact]
        public void Constructor_WithZeroInterval_SchedulesImmediately()
        {
            var config = new MonitorConfiguration { ItemId = "x", IntervalInSeconds = 0 };
            var before = DateTime.UtcNow;

            var task = new MonitorQueueTask(config);

            task.NextExecutionTime.Should().BeOnOrAfter(before).And.BeOnOrBefore(DateTime.UtcNow);
        }
    }
}
