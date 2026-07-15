using System;
using System.Linq;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Services;
using FluentAssertions;

namespace XUnitTest.Monitor
{
    public class MonitorQueueManagerTests
    {
        private static MonitorQueueTask Task(string id, DateTime next)
        {
            var task = new MonitorQueueTask(new MonitorConfiguration { ItemId = id, Url = "http://" + id, IntervalInSeconds = 0 });
            task.NextExecutionTime = next;
            return task;
        }

        [Fact]
        public void HasTasks_WhenEmpty_ReturnsFalse()
        {
            var sut = new MonitorQueueManager();
            sut.HasTasks().Should().BeFalse();
        }

        [Fact]
        public void Enqueue_ThenPeekAndHasTasks_ReflectsAddedTask()
        {
            var sut = new MonitorQueueManager();
            var task = Task("a", DateTime.UtcNow);

            sut.Enqueue(task);

            sut.HasTasks().Should().BeTrue();
            sut.Peek().Should().BeSameAs(task);
        }

        [Fact]
        public void Peek_DoesNotRemoveTask()
        {
            var sut = new MonitorQueueManager();
            sut.Enqueue(Task("a", DateTime.UtcNow));

            sut.Peek();

            sut.HasTasks().Should().BeTrue();
        }

        [Fact]
        public void Dequeue_WhenEmpty_ReturnsNull()
        {
            var sut = new MonitorQueueManager();
            sut.Dequeue().Should().BeNull();
        }

        [Fact]
        public void Dequeue_ReturnsEarliestExecutionTimeFirst()
        {
            var sut = new MonitorQueueManager();
            var later = Task("later", DateTime.UtcNow.AddMinutes(10));
            var sooner = Task("sooner", DateTime.UtcNow.AddMinutes(1));
            sut.Enqueue(later);
            sut.Enqueue(sooner);

            sut.Dequeue().Should().BeSameAs(sooner);
            sut.Dequeue().Should().BeSameAs(later);
            sut.HasTasks().Should().BeFalse();
        }

        [Fact]
        public void Ordering_WhenSameExecutionTime_BreaksTieByItemId()
        {
            var sut = new MonitorQueueManager();
            var when = DateTime.UtcNow;
            sut.Enqueue(Task("b", when));
            sut.Enqueue(Task("a", when));

            sut.Dequeue().Config.ItemId.Should().Be("a");
            sut.Dequeue().Config.ItemId.Should().Be("b");
        }

        [Fact]
        public void RemoveByItemId_RemovesMatchingTask()
        {
            var sut = new MonitorQueueManager();
            sut.Enqueue(Task("keep", DateTime.UtcNow.AddMinutes(1)));
            sut.Enqueue(Task("drop", DateTime.UtcNow.AddMinutes(2)));

            sut.RemoveByItemId("drop");

            sut.GetAll().Select(t => t.Config.ItemId).Should().ContainSingle().Which.Should().Be("keep");
        }

        [Fact]
        public void RemoveByItemId_WhenNotPresent_DoesNothing()
        {
            var sut = new MonitorQueueManager();
            sut.Enqueue(Task("keep", DateTime.UtcNow));

            sut.RemoveByItemId("missing");

            sut.HasTasks().Should().BeTrue();
        }

        [Fact]
        public void GetAll_ReturnsSnapshotOfAllTasks()
        {
            var sut = new MonitorQueueManager();
            sut.Enqueue(Task("a", DateTime.UtcNow.AddSeconds(1)));
            sut.Enqueue(Task("b", DateTime.UtcNow.AddSeconds(2)));

            sut.GetAll().Should().HaveCount(2);
        }
    }
}
