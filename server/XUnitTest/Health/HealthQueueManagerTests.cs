using System;
using System.Linq;
using DomainService.Health.HealthWorkerService;
using DomainService.Health.Models;
using DomainService.Monitor.Entity;
using FluentAssertions;

namespace XUnitTest.Health
{
    public class HealthQueueManagerTests
    {
        private static HealthQueueTask Task(string id, DateTime next)
        {
            var task = new HealthQueueTask(new MonitorConfiguration { ItemId = id, IntervalInSeconds = 0, GracePeriodInSeconds = 0 });
            task.NextExecutionTime = next;
            return task;
        }

        [Fact]
        public void Dequeue_WhenEmpty_ReturnsNull()
        {
            var sut = new HealthQueueManager();
            sut.Dequeue().Should().BeNull();
            sut.HasTasks().Should().BeFalse();
        }

        [Fact]
        public void Enqueue_Dequeue_OrdersByExecutionTimeThenItemId()
        {
            var sut = new HealthQueueManager();
            var when = DateTime.UtcNow;
            sut.Enqueue(Task("b", when));
            sut.Enqueue(Task("a", when));
            sut.Enqueue(Task("later", when.AddMinutes(5)));

            sut.HasTasks().Should().BeTrue();
            sut.Peek().Config.ItemId.Should().Be("a");
            sut.Dequeue().Config.ItemId.Should().Be("a");
            sut.Dequeue().Config.ItemId.Should().Be("b");
            sut.Dequeue().Config.ItemId.Should().Be("later");
        }

        [Fact]
        public void RemoveByItemId_RemovesOnlyMatchingTask()
        {
            var sut = new HealthQueueManager();
            sut.Enqueue(Task("keep", DateTime.UtcNow.AddSeconds(1)));
            sut.Enqueue(Task("drop", DateTime.UtcNow.AddSeconds(2)));

            sut.RemoveByItemId("drop");

            sut.GetAll().Select(t => t.Config.ItemId).Should().Equal("keep");
        }

        [Fact]
        public void GetAll_ReturnsAllQueuedTasks()
        {
            var sut = new HealthQueueManager();
            sut.Enqueue(Task("a", DateTime.UtcNow.AddSeconds(1)));
            sut.Enqueue(Task("b", DateTime.UtcNow.AddSeconds(2)));

            sut.GetAll().Should().HaveCount(2);
        }
    }
}
