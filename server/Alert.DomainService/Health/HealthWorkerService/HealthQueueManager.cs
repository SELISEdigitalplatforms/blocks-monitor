using DomainService.Health.Models;

namespace DomainService.Health.HealthWorkerService
{
    public class HealthQueueManager
    {
        private readonly SortedSet<HealthQueueTask> _taskQueue;
        private readonly object _lock = new object();

        public HealthQueueManager()
        {
            _taskQueue = new SortedSet<HealthQueueTask>(Comparer<HealthQueueTask>.Create(
                (a, b) => a.NextExecutionTime == b.NextExecutionTime
                          ? a.Config.ItemId.CompareTo(b.Config.ItemId)
                          : a.NextExecutionTime.CompareTo(b.NextExecutionTime)
            ));
        }

        public void Enqueue(HealthQueueTask task)
        {
            lock (_lock)
            {
                _taskQueue.Add(task);
            }
        }

        public HealthQueueTask Peek()
        {
            lock (_lock)
            {
                return _taskQueue.FirstOrDefault();
            }
        }

        public HealthQueueTask Dequeue()
        {
            lock (_lock)
            {
                var task = _taskQueue.FirstOrDefault();
                if (task != null)
                    _taskQueue.Remove(task);
                return task;
            }
        }

        public bool HasTasks()
        {
            lock (_lock)
            {
                return _taskQueue.Count > 0;
            }
        }


        public void RemoveByItemId(string itemId)
        {
            lock (_lock)
            {
                var taskToRemove = _taskQueue.FirstOrDefault(t => t.Config.ItemId == itemId);
                if (taskToRemove != null)
                {
                    _taskQueue.Remove(taskToRemove);
                }
            }
        }

        public IEnumerable<HealthQueueTask> GetAll()
        {
            return _taskQueue.ToList();
        }

    }
}
